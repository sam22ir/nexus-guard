import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../vault";
import { type Project } from "../store";
import { nexusHttpUrlFor, claudeHttpCommand, codexHttpCommand } from "../onboarding";
import { type AgentConfigEdit, type AgentTestStep } from "../app/types";
import { primaryBtn, secondaryBtn, ghostLink, inputClass, selectClass, badgeStyle } from "../app/styles";
import { Note, Modal } from "../app/common";

export function ConnectAgentModal({ project, initialAgentId, onClose }: { project: Project; initialAgentId: string | null; onClose: () => void }) {
  const agentOptions = [
    { id: "claude", name: "Claude Code", file: ".mcp.json" },
    { id: "pi", name: "Pi agent", file: ".mcp.json" },
    { id: "opencode", name: "OpenCode", file: "opencode.json" },
    { id: "codex", name: "Codex", file: ".codex/config.toml" },
    { id: "other", name: "Other agent (manual)", file: "your agent's MCP config" },
  ];
  const [agentId, setAgentId] = useState(initialAgentId ?? "claude");
  const isManual = agentId === "other";
  const [copied, setCopied] = useState("");
  // Bridge/keychain paths: no absolute defaults are baked in — a personal
  // checkout path would break every other machine. Resolution order:
  //   1. the developer's explicit override, persisted in localStorage;
  //   2. empty = unresolved: pick via Browse below (dev checkout:
  //      <repo>/mcp/nexus-server.mjs with the helper at
  //      target/debug/nexus-keyring; packaged app: both next to app
  //      resources) or type the path. The backend re-validates presence and
  //      the readiness check reports a missing bridge per project.
  // Node itself is resolved at runtime via the backend `node_binary_path`
  // command (PATH search + nvm fallback), never a baked-in path.
  const [bridgePath, setBridgePath] = useState(() => window.localStorage.getItem("nexus-guard.bridge-path") ?? "");
  const [keyringPath, setKeyringPath] = useState(() => window.localStorage.getItem("nexus-guard.keyring-path") ?? "");
  const [picking, setPicking] = useState<"bridge" | "keyring" | null>(null);
  const [busy, setBusy] = useState(false);
  const [writtenEdit, setWrittenEdit] = useState<AgentConfigEdit | null>(null);
  const [steps, setSteps] = useState<AgentTestStep[]>([]);
  const [error, setError] = useState("");
  const [nodeBin, setNodeBin] = useState("node");
  const desktop = desktopAvailable();
  const agent = agentOptions.find((a) => a.id === agentId)!;
  // CLI-first (single HTTP instance): workspace-bound via the shared
  // onboarding helpers. One server, one registration per project.
  const httpUrl = nexusHttpUrlFor(project.path);
  const claudeCmd = claudeHttpCommand(project.path);
  const codexCmd = codexHttpCommand(project.path);

  useEffect(() => {
    if (!desktop) return;
    invoke<string>("node_binary_path").then(setNodeBin).catch(() => undefined);
  }, [desktop]);

  async function browseFor(kind: "bridge" | "keyring") {
    setPicking(kind);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, title: kind === "bridge" ? "Locate nexus-server.mjs" : "Locate the Nexus keychain helper" });
      if (typeof selected === "string" && selected) {
        if (kind === "bridge") setBridgePath(selected); else setKeyringPath(selected);
      }
    } catch { /* keep the typed path */ }
    finally { setPicking(null); }
  }

  async function retestOnly() {
    if (!desktop) { setError("Open the desktop app to write agent configs."); return; }
    setBusy(true); setError("");
    try {
      const results = await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, bridgePath });
      setSteps(results);
    } catch {
      setError("Could not check this project. Check the project folder path, then try again.");
    } finally {
      setBusy(false);
    }
  }

  async function writeAndTest() {
    if (!desktop) { setError("Open the desktop app to write agent configs."); return; }
    if (isManual) {
      await retestOnly();
      return;
    }
    if (!bridgePath.trim() || !keyringPath.trim()) {
      setError("Pick the bridge script and keychain helper under “Bridge paths” first — Nexus assumes no default until you point it at this install.");
      return;
    }
    // Pre-write confirm: the fallback writer merges into the agent's project
    // config, backs up first, and the backend returns the diff + backup path.
    if (!window.confirm(`Write the Nexus fallback entry into ${agent.file} in “${project.path}”?\n\nNexus backs up the existing file first and shows the diff + backup path afterwards. Prefer the CLI commands above (HTTP-only); this file fallback writes a stdio bridge.`)) return;
    setBusy(true); setError(""); setSteps([]); setWrittenEdit(null);
    try {
      window.localStorage.setItem("nexus-guard.bridge-path", bridgePath);
      window.localStorage.setItem("nexus-guard.keyring-path", keyringPath);
      const result = await invoke<string | AgentConfigEdit>("connect_agent_to_project", { workspacePath: project.path, agentId, bridgePath, keyringPath, nodePath: null, httpUrl });
      const edit: AgentConfigEdit = typeof result === "string" ? { path: result, backup: "", diff: "" } : result;
      setWrittenEdit(edit);
      const results = await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, bridgePath });
      setSteps(results);
    } catch {
      setError("Could not connect that agent. Check the project folder path, then try again.");
    } finally {
      setBusy(false);
    }
  }

  // Manual snippets reflect the same fields; unresolved paths render as
  // placeholders the developer must replace before pasting.
  const manualBridge = bridgePath.trim() || "<path-to>/nexus-server.mjs";
  const manualKeyring = keyringPath.trim() || "<path-to>/nexus-keyring";
  const manualJson = JSON.stringify({ mcpServers: { nexus: { command: nodeBin, args: [manualBridge], env: { NEXUS_KEYRING_BIN: manualKeyring } } } }, null, 2);
  const manualToml = `# Nexus Guard MCP bridge for ${project.name}\n[mcp_servers.nexus]\ncommand = "${nodeBin}"\nargs = ["${manualBridge}"]\ncwd = "${project.path}"\ntool_timeout_sec = 30\nenv = { NEXUS_KEYRING_BIN = "${manualKeyring}" }`;

  function copyText(kind: string, text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(kind);
        window.setTimeout(() => setCopied(""), 1500);
      }).catch(() => undefined);
    }
  }

  const allOk = steps.length > 0 && steps.every((s) => s.ok);
  const anyFail = steps.some((s) => !s.ok);
  return (
    <Modal title={`Connect ${agent.name} to ${project.name}`} description="Register the agent CLI against the single Nexus HTTP instance first; the file writer below is a legacy fallback." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-[8px] border border-(--line)">
          <div className="border-b border-(--line) bg-(--canvas) px-3 py-2">
            <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">Preferred · CLI-first over HTTP (bound to {project.name})</strong>
          </div>
          <ul className="divide-y divide-(--line-soft)">
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-(--text)">{claudeCmd}</span>
              <button type="button" onClick={() => copyText("cli-claude", claudeCmd)} className={ghostLink}>{copied === "cli-claude" ? "Copied" : "Copy"}</button>
            </li>
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-(--text)">{codexCmd}</span>
              <button type="button" onClick={() => copyText("cli-codex", codexCmd)} className={ghostLink}>{copied === "cli-codex" ? "Copied" : "Copy"}</button>
            </li>
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-(--text)">{httpUrl}</span>
              <button type="button" onClick={() => copyText("cli-url", httpUrl)} className={ghostLink}>{copied === "cli-url" ? "Copied" : "Copy"}</button>
            </li>
          </ul>
          <p className="border-t border-(--line) bg-(--canvas) px-3 py-2 text-[12px] leading-[1.6] text-(--muted)">
            HTTP-only: run one command per project — the workspace in the URL is what pins the agent to {project.name}. A registration without a workspace is refused, never guessed.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Agent (legacy file fallback)</span>
          <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setSteps([]); setWrittenEdit(null); }} disabled={busy} className={selectClass}>
            {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name} → {a.file}</option>)}
          </select>
        </label>
        <Note>
          {isManual
            ? <>Copy the snippet into your agent&apos;s MCP settings, pointed at <strong>{project.path}</strong> as its working directory. Then run the readiness check below, mint a session (<kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">POST /session</kbd> with this workspace), and call <kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">nexus.context</kbd> with that session from the agent — it must answer {project.name}.</>
            : <>Fallback writes <strong>{agent.file}</strong> in <strong>{project.path}</strong> as a stdio bridge — that defeats the single-HTTP-instance lock, so prefer the CLI commands above. The fallback still checks the project file, bridge script, saved approval, and the written config. Restart {agent.name} in that folder afterwards.</>}
        </Note>
        {isManual && (
          <>
            <div className="overflow-hidden rounded-[8px] border border-(--line)">
              <div className="flex items-center justify-between border-b border-(--line) bg-(--canvas) px-3 py-2">
                <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">JSON style (Claude / Pi / Cursor / Windsurf)</strong>
                <button type="button" onClick={() => copyText("json", manualJson)} className={ghostLink}>{copied === "json" ? "Copied" : "Copy"}</button>
              </div>
              <pre className="m-0 overflow-x-auto whitespace-pre bg-(--panel) px-3 py-3 font-mono text-[11px] leading-[1.6] tabular-nums">{manualJson}</pre>
            </div>
            <div className="overflow-hidden rounded-[8px] border border-(--line)">
              <div className="flex items-center justify-between border-b border-(--line) bg-(--canvas) px-3 py-2">
                <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">TOML style (Codex)</strong>
                <button type="button" onClick={() => copyText("toml", manualToml)} className={ghostLink}>{copied === "toml" ? "Copied" : "Copy"}</button>
              </div>
              <pre className="m-0 overflow-x-auto whitespace-pre bg-(--panel) px-3 py-3 font-mono text-[11px] leading-[1.6] tabular-nums">{manualToml}</pre>
            </div>
            <Note>
              Launch the agent with {project.path} as its working directory — that folder is what pins it to {project.name}. A different working directory resolves a different project (or none).
            </Note>
          </>
        )}
        <details className="rounded-[8px] border border-(--line) px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-(--muted)">Bridge paths (advanced)</summary>
          <div className="flex flex-col gap-3 py-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Bridge script</span>
              <span className="flex gap-2">
                <input value={bridgePath} onChange={(e) => setBridgePath(e.target.value)} placeholder="…/mcp/nexus-server.mjs" className={inputClass} />
                {desktop && <button type="button" onClick={() => void browseFor("bridge")} disabled={picking !== null} className={secondaryBtn}>{picking === "bridge" ? "…" : "Browse"}</button>}
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Keychain helper</span>
              <span className="flex gap-2">
                <input value={keyringPath} onChange={(e) => setKeyringPath(e.target.value)} placeholder="…/nexus-keyring" className={inputClass} />
                {desktop && <button type="button" onClick={() => void browseFor("keyring")} disabled={picking !== null} className={secondaryBtn}>{picking === "keyring" ? "…" : "Browse"}</button>}
              </span>
            </label>
            <small className="text-[12px] leading-[1.6] text-(--muted)">No default is assumed: in a dev checkout the bridge is {"<repo>/mcp/nexus-server.mjs"} and the helper is {"target/debug/nexus-keyring"}; in a packaged app both sit next to app resources. Browse once and Nexus remembers.</small>
          </div>
        </details>
        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
        {!isManual && writtenEdit && (
          <div className="rounded-[8px] border border-(--line) bg-(--canvas) px-3 py-2.5 text-[12px] leading-[1.6] tabular-nums text-(--muted)">
            <p className="font-medium text-(--text)">Wrote {writtenEdit.path}</p>
            {writtenEdit.diff && <p>Diff: {writtenEdit.diff}</p>}
            {writtenEdit.backup
              ? <p>Backup: {writtenEdit.backup} — existing entries for other servers were kept.</p>
              : <p>No backup — new file; existing entries for other servers were kept.</p>}
          </div>
        )}
        {steps.length > 0 && (
          <div className="flex flex-col gap-2">
          <ul className="divide-y divide-(--line-soft) rounded-[8px] border border-(--line)">
            {steps.map((step) => (
              <li key={step.step} className="flex items-center gap-3 px-3 py-2.5">
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(step.ok ? "green" : "red")}>
                  {step.ok ? "Pass" : "Fail"}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                  {step.step}
                  <small className="block text-[12px] font-normal tabular-nums text-(--muted)">{step.detail}</small>
                </span>
              </li>
            ))}
          </ul>
          {anyFail && (
            <button type="button" onClick={() => void retestOnly()} disabled={busy || !desktop} className={secondaryBtn} style={{ alignSelf: "flex-start" }}>
              {busy ? "Retrying…" : "Retry failed checks"}
            </button>
          )}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>Close</button>
          <button type="button" onClick={() => void writeAndTest()} disabled={busy || !desktop} className={primaryBtn}>
            {busy ? "Working…" : isManual ? "Check project readiness" : writtenEdit ? "Re-run test" : "Write fallback config and test"}
          </button>
        </div>
        {allOk && !isManual && <Note>All Nexus-side checks pass. Restart {agent.name} in the project folder; its Supabase calls now go through guard.</Note>}
        {allOk && isManual && <Note>Project side is ready. Paste a snippet above, restart your agent in the project folder, mint a session via <kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">POST /session</kbd>, and confirm <kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">nexus.context</kbd> answers {project.name}.</Note>}
      </div>
    </Modal>
  );
}

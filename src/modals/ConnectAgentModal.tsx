import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../keychain";
import { type Project } from "../store";
import { nexusHttpUrlFor, claudeHttpCommand, codexHttpCommand } from "../onboarding";
import { type AgentConfigEdit, type AgentTestStep } from "../app/types";
import { Button } from "@heroui/react";
import { Icon as NxIcon, Segmented } from "../ui";
import { Modal } from "../app/common";

const AGENTS = [
  { id: "claude", name: "Claude Code", file: ".mcp.json" },
  { id: "codex", name: "Codex", file: ".codex/config.toml" },
  { id: "opencode", name: "OpenCode", file: "opencode.json" },
  { id: "pi", name: "Pi", file: ".mcp.json" },
  { id: "other", name: "Other", file: "your agent's MCP config" },
] as const;

/** Connect one agent to one project over the single Nexus HTTP endpoint:
 *  run the agent's own command, or let Nexus write the entry (confirm, diff,
 *  backup), then check the connection. No stdio bridges (paper §6, §8). */
export function ConnectAgentModal({ project, initialAgentId, onClose }: { project: Project; initialAgentId: string | null; onClose: () => void }) {
  const [agentId, setAgentId] = useState<string>(AGENTS.some((a) => a.id === initialAgentId) ? (initialAgentId as string) : "claude");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [writtenEdit, setWrittenEdit] = useState<AgentConfigEdit | null>(null);
  const [steps, setSteps] = useState<AgentTestStep[]>([]);
  const [error, setError] = useState("");
  const desktop = desktopAvailable();
  const agent = AGENTS.find((a) => a.id === agentId) ?? AGENTS[0];
  const isManual = agentId === "other";
  const httpUrl = nexusHttpUrlFor(project.path);

  const command = agentId === "claude" ? claudeHttpCommand(project.path) : agentId === "codex" ? codexHttpCommand(project.path) : httpUrl;
  const commandNote = agentId === "claude" || agentId === "codex"
    ? "Uses the agent's own CLI, so it keeps its validation."
    : "No official command. Point the agent's MCP config at this URL.";
  const manualJson = JSON.stringify({ mcpServers: { nexus: { type: "http", url: httpUrl, headers: { "X-Nexus-Workspace": project.path } } } }, null, 2);

  function copyText(kind: string, text: string) {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).then(() => { setCopied(kind); window.setTimeout(() => setCopied(""), 1500); }).catch(() => undefined);
  }
  function pickAgent(id: string) { setAgentId(id); setSteps([]); setWrittenEdit(null); setError(""); }

  async function runChecks() {
    if (!desktop) { setError("Open the desktop app to check the connection."); return; }
    setBusy(true); setError("");
    try {
      setSteps(await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, httpUrl }));
    } catch {
      setError("Could not check this project. Check the project folder path, then try again.");
    } finally {
      setBusy(false);
    }
  }

  async function writeConfig() {
    if (!desktop) { setError("Open the desktop app to write agent configs."); return; }
    // The writer merges one entry into the agent's project config, backs the file up first, and returns the diff.
    if (!window.confirm(`Write the Nexus entry into ${agent.file} in “${project.path}”?\n\nNexus keeps your other servers, backs up the existing file first, and shows the diff and backup path afterwards.`)) return;
    setBusy(true); setError(""); setSteps([]); setWrittenEdit(null);
    try {
      const result = await invoke<string | AgentConfigEdit>("connect_agent_to_project", { workspacePath: project.path, agentId, httpUrl });
      setWrittenEdit(typeof result === "string" ? { path: result, backup: "", diff: "" } : result);
      setSteps(await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, httpUrl }));
    } catch {
      setError("Could not write that config. Check the project folder path and that the file is valid, then try again.");
    } finally {
      setBusy(false);
    }
  }

  const allOk = steps.length > 0 && steps.every((s) => s.ok);
  const anyFail = steps.some((s) => !s.ok);
  const numberDot = (n: number) => <span className="nx-tile text-[11px] font-semibold" style={{ width: 22, height: 22, borderRadius: 9999 }} aria-hidden="true">{n}</span>;

  return (
    <Modal title={`Connect ${agent.name} to ${project.name}`} description="Adds one Nexus entry over HTTP, bound to this project." onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Segmented label="Agent" value={agentId} onChange={pickAgent} options={AGENTS.map((a) => ({ value: a.id, label: a.name }))} />

        <section className="rounded-[12px] border border-(--line) px-3.5 py-3">
          <div className="mb-2 flex items-center gap-2">{numberDot(1)}<strong className="text-[13px] font-medium text-(--text)">{isManual ? "Add this to your agent's MCP config" : "Run this command"}</strong><span className="ml-auto text-[11.5px] text-(--muted-2)">{isManual ? "Manual" : "Preferred"}</span></div>
          {isManual ? (
            <div className="rounded-[10px] bg-(--raised) px-3 py-2">
              <pre className="nx-mono m-0 overflow-x-auto whitespace-pre text-(--text)">{manualJson}</pre>
              <div className="mt-1 flex items-center justify-between gap-3 text-[11.5px] text-(--muted)">
                <span>Launch the agent in {project.path} so it resolves this project.</span>
                <Button size="sm" variant="outline" onPress={() => copyText("json", manualJson)}>{copied === "json" ? "Copied" : "Copy"}</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-[10px] bg-(--raised) px-3 py-2">
                <span className="nx-mono min-w-0 flex-1 break-all text-(--text)" style={{ whiteSpace: "normal" }}>{command}</span>
                <Button size="sm" variant="outline" onPress={() => copyText("cmd", command)}>{copied === "cmd" ? "Copied" : "Copy"}</Button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-(--muted)">{commandNote}</p>
            </>
          )}
        </section>

        {!isManual && (
          <section className="rounded-[12px] border border-(--line) px-3.5 py-3">
            <div className="mb-1.5 flex items-center gap-2">{numberDot(2)}<strong className="text-[13px] font-medium text-(--text)">Or let Nexus write it</strong></div>
            <p className="text-[12px] leading-[1.55] text-(--muted)">Edits <span className="nx-mono">{agent.file}</span> in {project.path}. Keeps your other servers and backs the file up first.</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <Button size="sm" isDisabled={busy || !desktop} onPress={() => void writeConfig()}>{busy && !writtenEdit ? "Writing…" : writtenEdit ? "Write again" : "Write config"}</Button>
              <span className="text-[12px] text-(--muted)">{desktop ? "You confirm before anything is written." : "Needs the desktop app."}</span>
            </div>
            {writtenEdit && (
              <div className="mt-2.5 rounded-[10px] bg-(--green-bg) px-3 py-2 text-[12px] leading-[1.55] text-(--green)">
                Wrote <span className="nx-mono">{writtenEdit.path}</span>{writtenEdit.diff ? ` · ${writtenEdit.diff}` : ""}.{" "}
                {writtenEdit.backup ? <>Backup kept at <span className="nx-mono">{writtenEdit.backup}</span>.</> : "New file, so there was nothing to back up."}
              </div>
            )}
          </section>
        )}

        <section className="rounded-[12px] border border-(--line) px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2">
            {numberDot(isManual ? 2 : 3)}<strong className="text-[13px] font-medium text-(--text)">Check the connection</strong>
            <span className="ml-auto flex gap-2">
              {anyFail && <Button size="sm" variant="outline" isDisabled={busy || !desktop} onPress={() => void runChecks()}>{busy ? "Retrying…" : "Retry failed"}</Button>}
              {!anyFail && <Button size="sm" variant="outline" isDisabled={busy || !desktop} onPress={() => void runChecks()}>{busy && steps.length === 0 ? "Checking…" : steps.length ? "Run again" : "Run checks"}</Button>}
            </span>
          </div>
          {steps.length === 0 ? (
            <p className="text-[12px] text-(--muted)">Checks the project file, that Nexus is answering, and that the agent's config points at it.</p>
          ) : (
            <ul>
              {steps.map((step, index) => (
                <li key={step.step} className="flex items-start gap-2.5 py-1.5" style={index > 0 ? { borderTop: "1px solid var(--line-soft)" } : undefined}>
                  <span className="nx-check mt-0.5" data-state={step.ok ? "done" : "failed"} style={{ width: 18, height: 18 }} aria-label={step.ok ? "Pass" : "Fail"}><NxIcon name={step.ok ? "check" : "x"} size={11} /></span>
                  <span className="flex min-w-0 flex-1 flex-col"><span className="text-[12.5px] font-medium text-(--text)">{step.step}</span><span className="text-[11.5px] text-(--muted)">{step.detail}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-(--muted)">
            {allOk ? `All checks pass. Restart ${agent.name} in the project folder and its calls show up in Activity.` : `Then restart ${agent.name} in the project folder. Its calls show up in Activity.`}
          </span>
          <Button size="sm" variant="outline" isDisabled={busy} onPress={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

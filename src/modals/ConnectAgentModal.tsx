import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../keychain";
import { type Project } from "../store";
import { nexusHttpUrlFor, claudeHttpCommand, codexHttpCommand } from "../onboarding";
import { type AgentConfigEdit, type AgentTestStep } from "../app/types";
import { AGENTS, agentById, manualSnippet } from "../agents";
import { Button } from "@heroui/react";
import { Icon as NxIcon, Segmented } from "../ui";
import { Modal } from "../app/common";

/** Connect one agent to one project over the single Nexus HTTP endpoint.
 *  Agents with a native writer get a write button (confirm, diff, backup);
 *  the rest get a snippet to paste. Then the connection is checked. No stdio bridges (paper §6, §8). */
export function ConnectAgentModal({ project, initialAgentId, onClose }: { project: Project; initialAgentId: string | null; onClose: () => void }) {
  const [agentId, setAgentId] = useState<string>(agentById(initialAgentId) ? (initialAgentId as string) : AGENTS[0].id);
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [writtenEdit, setWrittenEdit] = useState<AgentConfigEdit | null>(null);
  const [steps, setSteps] = useState<AgentTestStep[]>([]);
  const [error, setError] = useState("");
  const desktop = desktopAvailable();
  const agent = agentById(agentId) ?? AGENTS[0];
  const isManual = agent.connect === "manual";
  const httpUrl = nexusHttpUrlFor(project.path);
  const restartLower = agent.restart.charAt(0).toLowerCase() + agent.restart.slice(1);

  const cliCommand = agentId === "claude" ? claudeHttpCommand(project.path) : agentId === "codex" ? codexHttpCommand(project.path) : httpUrl;
  const commandNote = agentId === "claude"
    ? "Adds the entry to .mcp.json in this project, the same file Nexus writes."
    : agentId === "codex"
      ? "Codex's own command may save to your user config instead of this project, so the check here might not see it."
      : "No official command. Point the agent's MCP config at this URL.";
  const snippet = manualSnippet(agentId, project.path);

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
  const nextStep = allOk ? `All checks pass. ${agent.restart}` : `Then ${restartLower}`;
  const numberDot = (n: number) => <span className="nx-tile text-[11px] font-semibold" style={{ width: 22, height: 22, borderRadius: 9999 }} aria-hidden="true">{n}</span>;

  return (
    <Modal title={`Connect ${agent.name} to ${project.name}`} description="Adds Nexus to this project's agent config." onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Segmented label="Agent" value={agentId} onChange={pickAgent} options={AGENTS.map((a) => ({ value: a.id, label: a.name }))} />

        {isManual ? (
          <section className="rounded-[12px] border border-(--line) px-3.5 py-3">
            <div className="mb-2 flex items-center gap-2">{numberDot(1)}<strong className="text-[13px] font-medium text-(--text)">Add it by hand</strong></div>
            <p className="mb-2 text-[12px] leading-[1.55] text-(--muted)">Add this to <span className="nx-mono">{agent.file}</span> in your project folder:</p>
            <div className="rounded-[10px] bg-(--raised) px-3 py-2">
              <pre className="nx-mono m-0 overflow-x-auto whitespace-pre text-(--text)">{snippet}</pre>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-(--muted)">
              <span>Then {restartLower}</span>
              <Button size="sm" variant="outline" onPress={() => copyText("json", snippet)}>{copied === "json" ? "Copied" : "Copy"}</Button>
            </div>
          </section>
        ) : (
          <section className="rounded-[12px] border border-(--line) px-3.5 py-3">
            <div className="mb-1.5 flex items-center gap-2">{numberDot(1)}<strong className="text-[13px] font-medium text-(--text)">Let Nexus write it</strong></div>
            <p className="text-[12px] leading-[1.55] text-(--muted)">Edits <span className="nx-mono">{agent.file}</span> in {project.path}. Keeps your other servers and backs the file up first.</p>
            {agent.note && <p className="mt-1.5 text-[11.5px] leading-[1.5] text-(--muted)">{agent.note}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <Button size="sm" isDisabled={busy || !desktop} onPress={() => void writeConfig()}>{busy && !writtenEdit ? "Writing…" : `Connect ${agent.name}`}</Button>
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

        {(agentId === "claude" || agentId === "codex") && (
          <details className="rounded-[12px] border border-(--line) px-3.5 py-2.5">
            <summary className="cursor-pointer text-[12.5px] font-medium text-(--text)">Advanced: run the agent's own command</summary>
            <div className="mt-2.5 flex items-center gap-3 rounded-[10px] bg-(--raised) px-3 py-2">
              <span className="nx-mono min-w-0 flex-1 break-all text-(--text)" style={{ whiteSpace: "normal" }}>{cliCommand}</span>
              <Button size="sm" variant="outline" onPress={() => copyText("cmd", cliCommand)}>{copied === "cmd" ? "Copied" : "Copy"}</Button>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-(--muted)">{commandNote}</p>
          </details>
        )}

        <section className="rounded-[12px] border border-(--line) px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2">
            {numberDot(2)}<strong className="text-[13px] font-medium text-(--text)">Check the connection</strong>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" isDisabled={busy || !desktop} onPress={() => void runChecks()}>{busy ? "Checking…" : steps.length ? "Run again" : "Run checks"}</Button>
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
          {agent.trustPrompt && (
            <p className="mt-2.5 rounded-[10px] bg-(--raised) px-3 py-2 text-[12px] leading-[1.55] text-(--text)">One more step: {agent.trustPrompt}</p>
          )}
        </section>

        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-(--muted)">{nextStep} Its calls show up in Activity.</span>
          <Button size="sm" variant="outline" isDisabled={busy} onPress={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

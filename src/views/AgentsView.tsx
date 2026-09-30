import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../vault";
import { type Project } from "../store";
import { nexusHttpUrlFor, claudeHttpCommand, codexHttpCommand } from "../onboarding";
import { Button } from "@heroui/react";
import { Badge, Empty } from "../ui";
import { type AgentConfigEdit, type UnmanagedMcpEntry, type DetectedAgent } from "../app/types";
import { smallBtn } from "../app/styles";
import { PageTitle, Card, CardHeading, Note } from "../app/common";

export function ConnectAgentPicker({ projects, agentId, onConnect }: { projects: Project[]; agentId: string; onConnect: (projectId: string, agentId: string | null) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  useEffect(() => { if (!projects.some((p) => p.id === projectId) && projects[0]) setProjectId(projects[0].id); }, [projects, projectId]);
  return (
    <span className="flex items-center gap-2">
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project to connect" className="h-8 max-w-[140px] rounded-[6px] border border-(--line) bg-(--panel) px-2 text-[12px] tabular-nums text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" onClick={() => projectId && onConnect(projectId, agentId)} className={smallBtn}>Connect</button>
    </span>
  );
}

export function AgentsView({ projects, onConnect }: { projects: Project[]; onConnect: (projectId: string, agentId: string | null) => void }) {
  const [agents, setAgents] = useState<DetectedAgent[] | null>(null);
  const [cliCopied, setCliCopied] = useState("");
  const [entryBusy, setEntryBusy] = useState<string | null>(null);
  const [entryMsg, setEntryMsg] = useState<Record<string, string>>({});
  // Registration is per project: the endpoint is shared, but the workspace is
  // what tells Nexus which project an agent is in. A command without one is
  // refused by the bridge, so the snippets bind to a chosen project.
  const [cliProjectId, setCliProjectId] = useState(projects[0]?.id ?? "");
  const cliProject = projects.find((p) => p.id === cliProjectId) ?? projects[0];
  const boundHttpUrl = nexusHttpUrlFor(cliProject?.path ?? "");
  const claudeHttpCmd = claudeHttpCommand(cliProject?.path ?? "");
  const codexHttpCmd = codexHttpCommand(cliProject?.path ?? "");
  // Project-level scan (scan_project_mcp): direct entries living in this
  // project's workspace configs (.mcp.json, opencode.json,
  // .codex/config.toml), listed alongside the global unmanaged[] that
  // detect_agents reports per agent below. Read-only until Import/Remove.
  const [projectEntries, setProjectEntries] = useState<UnmanagedMcpEntry[] | null>(null);
  const cliWorkspace = cliProject?.path ?? "";
  function refreshProjectEntries(workspace: string) {
    if (!desktopAvailable() || !workspace) { setProjectEntries(null); return; }
    invoke<UnmanagedMcpEntry[]>("scan_project_mcp", { workspacePath: workspace })
      .then(setProjectEntries)
      .catch(() => setProjectEntries([]));
  }
  function copyCli(kind: string, text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCliCopied(kind);
        window.setTimeout(() => setCliCopied(""), 1500);
      }).catch(() => undefined);
    }
  }
  function refreshAgents() {
    if (!desktopAvailable()) return;
    invoke<DetectedAgent[]>("detect_agents").then(setAgents).catch(() => setAgents([]));
  }
  async function importEntry(agentId: string, entry: UnmanagedMcpEntry) {
    if (!cliProject) return;
    if (!window.confirm(`Import “${entry.name}” (${entry.source}) onto Nexus for “${cliProject.name}”?\n\nNexus backs up the agent config first, then points this entry at the workspace-bound HTTP URL. Unknown entries are never silently re-routed.`)) return;
    setEntryBusy(`${agentId}:${entry.name}:import`); setEntryMsg((m) => ({ ...m }));
    try {
      const edit = await invoke<AgentConfigEdit>("import_agent_entry", { workspacePath: cliProject.path, agentId, name: entry.name, url: boundHttpUrl });
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: `Imported at ${edit.path}. Diff: ${edit.diff}${edit.backup ? ` Backup: ${edit.backup}` : " (new file, no backup)"}` }));
      refreshAgents();
      refreshProjectEntries(cliProject.path);
    } catch (e) {
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: e instanceof Error ? e.message : "Could not import that entry." }));
    } finally {
      setEntryBusy(null);
    }
  }
  async function removeEntry(agentId: string, entry: UnmanagedMcpEntry) {
    if (!cliProject) return;
    if (!window.confirm(`Remove direct entry “${entry.name}” (${entry.source}) for “${cliProject.name}”?\n\nNexus backs up the agent config first and shows the removed value + backup path afterwards. This deletes the direct route — the agent loses that provider until re-added.`)) return;
    setEntryBusy(`${agentId}:${entry.name}:remove`); setEntryMsg((m) => ({ ...m }));
    try {
      const edit = await invoke<AgentConfigEdit>("remove_agent_entry", { workspacePath: cliProject.path, agentId, name: entry.name });
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: `Removed from ${edit.path}. Diff: ${edit.diff}${edit.backup ? ` Backup: ${edit.backup}` : ""}` }));
      refreshAgents();
      refreshProjectEntries(cliProject.path);
    } catch (e) {
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: e instanceof Error ? e.message : "Could not remove that entry." }));
    } finally {
      setEntryBusy(null);
    }
  }
  /** Workspace config file → owning agent for import/remove.
   *  Claude and Pi share .mcp.json, so either id writes the same file. */
  function agentForProjectEntry(entry: UnmanagedMcpEntry): string {
    const source = entry.source.toLowerCase();
    if (source.includes("opencode")) return "opencode";
    if (source.includes("codex") || source.includes("config.toml")) return "codex";
    return "claude";
  }
  const desktop = desktopAvailable();
  useEffect(() => {
    if (!desktop) return;
    refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);
  useEffect(() => {
    refreshProjectEntries(cliWorkspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, cliWorkspace]);
  const found = (agents ?? []).filter((a) => a.found);

  /** One direct (unmanaged) MCP entry with Import / Remove, shared by the
   *  project scan and each detected agent. */
  function entryRow(entry: UnmanagedMcpEntry, agentId: string, where: string) {
    const key = `${agentId}:${entry.name}`;
    const busy = entryBusy === `${key}:import` || entryBusy === `${key}:remove`;
    return (
      <li key={`${entry.source}:${entry.name}`} className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <Badge tone="warning">Unmanaged</Badge>
        <span className="nx-row-body min-w-[160px]">
          <span className="nx-mono text-(--text)">{entry.name}</span>
          <span className="nx-row-sub">{where} · bypasses Nexus until imported</span>
        </span>
        <Button size="sm" variant="outline" isDisabled={busy || !desktop || !cliProject} onPress={() => void importEntry(agentId, entry)}>{entryBusy === `${key}:import` ? "Importing…" : "Import onto Nexus"}</Button>
        <Button size="sm" variant="danger-soft" isDisabled={busy || !desktop || !cliProject} onPress={() => void removeEntry(agentId, entry)}>{entryBusy === `${key}:remove` ? "Removing…" : "Remove direct"}</Button>
        {entryMsg[key] && <small className="w-full text-[11.5px] leading-[1.6] text-(--muted)">{entryMsg[key]}</small>}
      </li>
    );
  }

  function commandRow(kind: string, text: string, label: string) {
    return (
      <li className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="nx-row-body">
          <span className="nx-mono break-all text-(--text)" style={{ whiteSpace: "normal" }}>{text}</span>
          <span className="nx-row-sub" style={{ whiteSpace: "normal" }}>{label}</span>
        </span>
        <Button size="sm" variant="outline" onPress={() => copyCli(kind, text)}>{cliCopied === kind ? "Copied" : "Copy"}</Button>
      </li>
    );
  }

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle description="Coding agents detected on this machine. Detection is not registration: an agent only goes through Nexus once it is registered against the single HTTP instance for its project." />
      <Card flush>
        <div className="px-5 pt-4">
          <CardHeading
            eyebrow="Recommended · CLI over HTTP"
            title="Point the agent at Nexus, not the provider"
            action={
              projects.length > 0 ? (
                <label className="flex items-center gap-2 text-[12px] text-(--muted)">
                  <span>Register for</span>
                  <select value={cliProject?.id ?? ""} onChange={(event) => setCliProjectId(event.target.value)} aria-label="Project these commands register" className="h-8 rounded-[10px] border border-(--line) bg-(--panel) px-2 text-[12px] text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
                    {projects.map((project) => (<option key={project.id} value={project.id}>{project.name}</option>))}
                  </select>
                </label>
              ) : (
                <Badge tone="warning">Register a project first</Badge>
              )
            }
          />
        </div>
        <ul>
          {commandRow("url", boundHttpUrl, `Nexus HTTP endpoint · port 3939 by default · ${cliProject ? `bound to ${cliProject.name}. Register each project separately; a request with no workspace is refused, never guessed.` : "add a project to get a registration command."}`)}
          {commandRow("claude", claudeHttpCmd, "Claude Code · HTTP transport, bound to this project")}
          {commandRow("codex", codexHttpCmd, "Codex · URL registration, bound to this project")}
        </ul>
        <p className="border-t border-(--line-soft) px-5 py-3 text-[12px] leading-[1.6] text-(--muted)">
          Register with the CLI commands above. The per-folder fallback below writes a stdio bridge, which defeats the single-instance lock, so prefer the CLI. A direct <span className="nx-mono">supabase-direct-unmanaged</span> entry bypasses Nexus entirely: calls there are not guarded and never appear in Activity.
        </p>
      </Card>

      {desktop && cliProject && projectEntries !== null && projectEntries.length > 0 && (
        <Card flush>
          <div className="px-5 pt-4"><CardHeading eyebrow={`Project scan · ${cliProject.name}`} title={`${projectEntries.length} direct ${projectEntries.length === 1 ? "entry" : "entries"} in workspace configs`} /></div>
          <ul>{projectEntries.map((entry) => entryRow(entry, agentForProjectEntry(entry), `${entry.source} · ${agentForProjectEntry(entry)}`))}</ul>
        </Card>
      )}

      {!desktop && (
        <Card><Empty title="Open the desktop app">Agent detection needs local machine access. The browser preview cannot see installed agents.</Empty></Card>
      )}
      {desktop && agents === null && (
        <Card>
          <div className="mx-auto flex max-w-[420px] flex-col gap-2 py-4" aria-label="Scanning for agents">
            <div className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />
            <div className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />
            <p className="mt-2 text-center text-[13px] text-(--muted)">Looking for known agent commands and configs.</p>
          </div>
        </Card>
      )}
      {desktop && agents !== null && agents.length === 0 && (
        <Card><Empty title="No agents detected">None of the known agent commands or configs were found. An agent appearing later still bypasses Nexus until its project config points at the bridge.</Empty></Card>
      )}
      {desktop && found.length > 0 && (
        <Card flush>
          <div className="px-5 pt-4"><CardHeading eyebrow="Detected on this machine" title={`${found.length} agent${found.length === 1 ? "" : "s"} found`} /></div>
          <ul>
            {found.map((agent) => {
              const unmanaged = agent.unmanaged ?? [];
              return (
                <li key={agent.id} style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="nx-tile text-[11px] font-semibold" data-tone="success" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
                    <span className="nx-row-body min-w-[140px]">
                      <span className="nx-row-title">{agent.name}</span>
                      <span className="nx-row-sub">{agent.detail}</span>
                    </span>
                    <span className="nx-row-body min-w-[140px]">
                      <span className="nx-row-sub">Route via Nexus</span>
                      <span className="nx-row-sub nx-mono" title={agent.nexus_config}>{agent.nexus_config}</span>
                    </span>
                    <ConnectAgentPicker projects={projects} agentId={agent.id} onConnect={onConnect} />
                  </div>
                  {unmanaged.length > 0 && <ul className="bg-(--raised)">{unmanaged.map((entry) => entryRow(entry, agent.id, entry.source))}</ul>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {desktop && <Note>Live traffic lives on Home. This tab only sets agents up and shows whether each one is connected.{agents !== null && agents.some((a) => !a.found) ? ` Not seen: ${agents.filter((a) => !a.found).map((a) => a.name).join(", ")}.` : ""} A detected agent with a direct provider setup bypasses Nexus until its project config points at the bridge.</Note>}
    </div>
  );
}

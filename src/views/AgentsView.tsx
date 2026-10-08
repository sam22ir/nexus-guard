import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../keychain";
import { type Project } from "../store";
import { nexusHttpUrlFor, claudeHttpCommand, codexHttpCommand } from "../onboarding";
import { agentDisplayName } from "../topology";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon, type Tone } from "../ui";
import { type AgentConfigEdit, type UnmanagedMcpEntry, type DetectedAgent } from "../app/types";
import { Card, CardHeading } from "../app/common";
import { timeAgo, useAuditLog } from "../app/audit";

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
  const { entries } = useAuditLog(projects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const found = (agents ?? []).filter((a) => a.found);
  const missing = (agents ?? []).filter((a) => !a.found);

  /** Calls this agent has made through Nexus, matched by the name it declares. */
  function seenBy(agent: DetectedAgent) {
    const mine = entries.filter((entry) => entry.agent && agent.name.toLowerCase().startsWith(agentDisplayName(entry.agent).toLowerCase()));
    return { calls: mine.length, last: mine.length ? mine[mine.length - 1].ts : null };
  }
  /** Direct entries for one agent: its own scan plus the project's workspace configs. */
  function directFor(agent: DetectedAgent): { entry: UnmanagedMcpEntry; where: string }[] {
    const own = (agent.unmanaged ?? []).map((entry) => ({ entry, where: entry.source }));
    const fromProject = (projectEntries ?? []).filter((entry) => agentForProjectEntry(entry) === agent.id).map((entry) => ({ entry, where: `${entry.source} · project` }));
    const seen = new Set<string>();
    return [...own, ...fromProject].filter(({ entry }) => { const key = `${entry.source}:${entry.name}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  const statusOf = (agent: DetectedAgent): { tone: Tone; label: string; sub: string } => {
    const direct = directFor(agent).length;
    const seen = seenBy(agent);
    if (direct > 0) return { tone: "warning", label: "Unmanaged", sub: `${direct} direct ${direct === 1 ? "entry bypasses" : "entries bypass"} Nexus` };
    if (seen.calls > 0) return { tone: "success", label: "Seen calling", sub: `${seen.calls} call${seen.calls === 1 ? "" : "s"} · last ${timeAgo(seen.last)}` };
    return { tone: "neutral", label: "Detected", sub: "Not seen calling Nexus yet" };
  };
  const bypassing = found.filter((a) => directFor(a).length > 0).length;
  const calling = found.filter((a) => seenBy(a).calls > 0).length;
  const current = (agents ?? []).find((a) => a.id === selectedId) ?? found.find((a) => directFor(a).length > 0) ?? found[0] ?? missing[0];

  /** One direct (unmanaged) MCP entry with Import and Remove. */
  function entryRow(entry: UnmanagedMcpEntry, agentId: string, where: string) {
    const key = `${agentId}:${entry.name}`;
    const busy = entryBusy === `${key}:import` || entryBusy === `${key}:remove`;
    return (
      <li key={`${where}:${entry.name}`} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <span className="nx-mono font-medium text-(--text)">{entry.name}</span>
          <span className="text-[12px] text-(--muted)">{where} · calls here are not guarded</span>
        </span>
        <Button size="sm" variant="outline" isDisabled={busy || !desktop || !cliProject} onPress={() => void importEntry(agentId, entry)}>{entryBusy === `${key}:import` ? "Importing…" : "Import onto Nexus"}</Button>
        <Button size="sm" variant="danger-soft" isDisabled={busy || !desktop || !cliProject} onPress={() => void removeEntry(agentId, entry)}>{entryBusy === `${key}:remove` ? "Removing…" : "Remove direct"}</Button>
        {entryMsg[key] && <small className="w-full text-[11.5px] leading-[1.6] text-(--muted)">{entryMsg[key]}</small>}
      </li>
    );
  }

  const commandFor = (agent: DetectedAgent): { text: string; label: string } =>
    agent.id === "claude" ? { text: claudeHttpCmd, label: "Official command · HTTP transport, bound to this project" }
    : agent.id === "codex" ? { text: codexHttpCmd, label: "Official command · URL registration, bound to this project" }
    : { text: boundHttpUrl, label: "Point this agent's MCP config at the endpoint, bound to this project" };

  const loading = desktop && agents === null;
  const empty = desktop && agents !== null && agents.length === 0;

  return (
    <div className="app-view flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[12.5px] text-(--muted)">
          {desktop && agents !== null
            ? <><strong className="font-medium text-(--text)">{found.length}</strong> detected · <strong className="font-medium text-(--text)">{calling}</strong> seen calling · <strong className="font-medium text-(--text)">{bypassing}</strong> bypassing Nexus</>
            : "Coding agents detected on this machine. Detection is not registration."}
        </p>
        {projects.length > 0 ? (
          <label className="flex items-center gap-2 text-[12px] text-(--muted)">
            Register for
            <select value={cliProject?.id ?? ""} onChange={(event) => setCliProjectId(event.target.value)} aria-label="Project these commands register" className="h-9 rounded-[10px] border border-(--line) bg-(--panel) px-2 text-[12.5px] text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
              {projects.map((project) => (<option key={project.id} value={project.id}>{project.name}</option>))}
            </select>
          </label>
        ) : <Badge tone="warning">Register a project first</Badge>}
      </div>

      {!desktop && <Card><Empty title="Open the desktop app">Agent detection needs local machine access. The browser preview cannot see installed agents.</Empty></Card>}
      {loading && (
        <Card>
          <div className="mx-auto flex max-w-[420px] flex-col gap-2 py-4" aria-label="Scanning for agents">
            <div className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />
            <div className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />
            <p className="mt-2 text-center text-[13px] text-(--muted)">Looking for known agent commands and configs.</p>
          </div>
        </Card>
      )}
      {empty && <Card><Empty title="No agents detected">None of the known agent commands or configs were found. An agent appearing later bypasses Nexus until its config points at it.</Empty></Card>}

      {desktop && agents !== null && agents.length > 0 && current && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]" style={{ minHeight: 320 }}>
          <Card flush className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Agents">
              {found.length > 0 && <div className="px-4 pb-2 pt-4"><span className="nx-eyebrow">On this machine</span></div>}
              {found.map((agent) => {
                const status = statusOf(agent);
                return (
                  <button key={agent.id} type="button" role="option" aria-selected={current.id === agent.id} className="nx-row" data-active={current.id === agent.id} style={{ borderTop: "1px solid var(--line-soft)" }} onClick={() => setSelectedId(agent.id)}>
                    <span className="nx-tile text-[11px] font-semibold" data-tone={status.tone === "neutral" ? undefined : status.tone} aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
                    <span className="nx-row-body"><span className="nx-row-title">{agent.name}</span><span className="nx-row-sub">{status.sub}</span></span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </button>
                );
              })}
              {missing.length > 0 && <div className="px-4 pb-2 pt-4"><span className="nx-eyebrow">Not found</span></div>}
              {missing.map((agent) => (
                <button key={agent.id} type="button" role="option" aria-selected={current.id === agent.id} className="nx-row" data-active={current.id === agent.id} style={{ borderTop: "1px solid var(--line-soft)", opacity: 0.7 }} onClick={() => setSelectedId(agent.id)}>
                  <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
                  <span className="nx-row-body"><span className="nx-row-title">{agent.name}</span><span className="nx-row-sub">Not installed</span></span>
                </button>
              ))}
            </div>
            <p className="shrink-0 border-t border-(--line-soft) px-4 py-2.5 text-[11.5px] leading-[1.5] text-(--muted-2)">Detection is not registration. An agent is guarded only once it goes through Nexus.</p>
          </Card>

          <Card flush className="flex min-h-0 flex-col">
            {(() => {
              const status = statusOf(current);
              const direct = directFor(current);
              const command = commandFor(current);
              return (
                <>
                  <div className="flex shrink-0 items-center gap-3 px-5 pt-4">
                    <span className="nx-tile text-[12px] font-semibold" data-tone={current.found && status.tone !== "neutral" ? status.tone : undefined} style={{ width: 38, height: 38 }} aria-hidden="true">{current.name.slice(0, 2).toUpperCase()}</span>
                    <span className="flex min-w-0 flex-1 flex-col"><strong className="text-[15px] font-semibold text-(--text)">{current.name}</strong><span className="truncate text-[12px] text-(--muted)">{current.detail}</span></span>
                    {current.found && <Badge tone={status.tone}>{status.label}</Badge>}
                  </div>
                  {!current.found ? (
                    <Empty title="Not detected">Install {current.name} and it will appear here, ready to connect.</Empty>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
                      <CardHeading eyebrow={`Connect to Nexus · ${cliProject?.name ?? "no project"}`} title="Point it at Nexus, not the provider" action={<Badge tone={current.http_reachable ? "success" : "warning"} dot>{current.http_reachable ? "Nexus reachable" : "Nexus not running"}</Badge>} />
                      <div className="rounded-[12px] border border-(--line) px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="nx-mono min-w-0 flex-1 break-all text-(--text)" style={{ whiteSpace: "normal" }}>{cliProject ? command.text : "Register a project to get a command."}</span>
                          <Button size="sm" variant="outline" isDisabled={!cliProject} onPress={() => copyCli(current.id, command.text)}>{cliCopied === current.id ? "Copied" : "Copy"}</Button>
                        </div>
                        <p className="mt-1 text-[11.5px] text-(--muted)">{command.label}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button size="sm" isDisabled={!cliProject} onPress={() => cliProject && onConnect(cliProject.id, current.id)}>Connect for me</Button>
                        <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-(--muted)">Shows the config diff first, keeps a backup, then tests the connection. Config: <span className="nx-mono">{current.nexus_config}</span></span>
                      </div>

                      <div className="mt-5">
                        <CardHeading eyebrow="Direct entries" title={direct.length === 0 ? "None. Nothing bypasses Nexus here." : `${direct.length} ${direct.length === 1 ? "entry bypasses" : "entries bypass"} Nexus`} />
                        {direct.length > 0 && <ul className="-mx-4 -mt-1">{direct.map(({ entry, where }) => entryRow(entry, current.id, where))}</ul>}
                      </div>
                    </div>
                  )}
                  <div className="shrink-0 border-t border-(--line-soft) px-5 py-3 text-[12px] leading-[1.5] text-(--muted)">
                    <NxIcon name="shield" size={13} className="mr-1.5 inline" />Import and Remove both back up the config first and show the diff afterwards. Live traffic lives on Home and Activity.
                  </div>
                </>
              );
            })()}
          </Card>
        </div>
      )}
    </div>
  );
}

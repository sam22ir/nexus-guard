import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../keychain";
import { starterProjects, type Project } from "../store";
import { ThemeButton, nexusHttpUrlFor } from "../onboarding";
import { AGENTS, agentById, errorText, manualSnippet, type AgentInfo } from "../agents";
import { agentDisplayName } from "../topology";
import { type AgentConfigEdit, type AgentTestStep, type AuditEntry, type DetectedAgent, type FolderInspection, type GlobalAgentStatus } from "../app/types";
import { Button } from "@heroui/react";
import { Icon as NxIcon } from "../ui";
import { inputClass } from "../app/styles";
import type { NexusStatus } from "../useNexusStatus";

const STEPS = ["Agents", "Project", "Connection"] as const;
const ALL_SERVICES = ["Supabase", "GitHub"] as const;
const FIRST_PROMPT = "Which Nexus project am I in?";
/** How long to wait on the checklist before saying what usually goes wrong. */
const STUCK_MS = 60_000;

type RowState = "pending" | "ok" | "failed";
/** Outcome of one connect action, shown next to the agent it was for. */
type RowResult = { ok: boolean; text: string };

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** First run, per paper §12: connect your agents, register one real project, then
 *  watch the agent's first real call arrive. Claude Code and OpenCode connect once for
 *  every project; other agents are written per project. Linking a service is optional
 *  and comes after the proof, so the first value needs no accounts.
 *  The graph on the right gains a node per step. */
export function FirstRun({ server, projects, resumeProject, onRegister, onOpenAddBinding, onOpenConnectAgent, onSkip, onFinish }: {
  /** The one shared check of Nexus's local server (see useNexusStatus). */
  server: NexusStatus;
  projects: Project[];
  /** A project registered earlier whose setup was skipped: the wizard reopens at the agents step. */
  resumeProject?: Project | null;
  onRegister: (input: { name: string; path: string; repo: string; branch: string }) => string | null;
  onOpenAddBinding: (projectId: string) => void;
  onOpenConnectAgent: (projectId: string, agentId: string | null) => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(resumeProject?.name ?? "");
  const [nameTouched, setNameTouched] = useState(!!resumeProject);
  const [path, setPath] = useState(resumeProject?.path ?? "");
  const [registeredId, setRegisteredId] = useState<string | null>(resumeProject?.id ?? null);
  const [existing, setExisting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [service, setService] = useState<(typeof ALL_SERVICES)[number]>("Supabase");
  // GitHub only connects when this build has the Nexus GitHub App set up; otherwise hide it so nobody hits a dead end.
  const [githubReady, setGithubReady] = useState(false);
  const SERVICES = githubReady ? ALL_SERVICES : ALL_SERVICES.filter((s) => s !== "GitHub");
  // The agents on this machine, all ticked when found. Without a detection, the common list is shown unticked.
  const [agents, setAgents] = useState<readonly AgentInfo[]>(AGENTS);
  const [agentsFound, setAgentsFound] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // Whether Claude Code / OpenCode already have the one user-level entry.
  const [globalStatus, setGlobalStatus] = useState<Record<string, GlobalAgentStatus>>({});
  const [globalResults, setGlobalResults] = useState<Record<string, RowResult>>({});
  const [connectingGlobal, setConnectingGlobal] = useState(false);
  // Per-project writes for agents that have no global entry, made when the project is registered.
  const [projectResults, setProjectResults] = useState<Record<string, RowResult>>({});
  // Results of test_agent_setup, per agent. These describe Nexus's side only, never the agent's first call.
  const [checks, setChecks] = useState<Record<string, AgentTestStep[]>>({});
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  // Items the user ticks off on the checklist. Only the agent's own steps are ticked by hand.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [stuck, setStuck] = useState(false);
  const [liveCall, setLiveCall] = useState<AuditEntry | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { running, detail, restart, needsNode, starting } = server;
  const desktop = desktopAvailable();

  const project = projects.find((p) => p.id === registeredId) ?? null;
  const nameUsed = !registeredId && projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const canRegister = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;
  // Only the agent's real first call proves it works. The setup check only shows Nexus's own side is fine.
  const proven = !!liveCall;
  const pickedAgents = agents.filter((a) => ticked[a.id]);
  const globalPicked = pickedAgents.filter((a) => a.global);
  const projectPicked = pickedAgents.filter((a) => !a.global && a.connect === "auto");
  const hintAgent = pickedAgents.find((a) => !a.global) ?? pickedAgents[0] ?? null;
  const agentLabel = pickedAgents.length === 1 ? pickedAgents[0].name : "your agent";
  const callerName = liveCall ? agentDisplayName(liveCall.agent ?? agentLabel) : agentLabel;
  const connectedAgents = agents.filter((a) => (a.global ? globalStatus[a.id]?.connected === true : projectResults[a.id]?.ok === true));
  const connectedAny = connectedAgents.length > 0;
  const configPaths = globalPicked.map((a) => globalStatus[a.id]?.config_path).filter((p): p is string => !!p);

  // Spot an existing Nexus project in the chosen folder and offer to reuse its name.
  useEffect(() => {
    if (!desktop || registeredId || !path.trim()) { setExisting(null); return; }
    const timer = window.setTimeout(() => {
      invoke<FolderInspection>("inspect_project_folder", { workspacePath: path.trim() })
        .then((result) => setExisting(result.exists && result.is_dir && result.nexus_project ? result.nexus_project : null))
        .catch(() => setExisting(null));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [path, desktop, registeredId]);

  useEffect(() => {
    if (!desktop) return;
    invoke<{ configured: boolean }>("github_status").then((status) => setGithubReady(status.configured)).catch(() => undefined);
  }, [desktop]);

  // Show the agents found on this machine, all ticked. Ids the shared list does not know are ignored.
  useEffect(() => {
    if (!desktop) return;
    invoke<DetectedAgent[]>("detect_agents").then((found) => {
      const list = found
        .filter((a) => a.found)
        .map((a) => agentById(a.id))
        .filter((a): a is AgentInfo => a !== null);
      if (list.length > 0) {
        setAgents(list);
        setAgentsFound(true);
        setTicked(Object.fromEntries(list.map((a) => [a.id, true])));
      }
    }).catch(() => undefined);
  }, [desktop]);

  useEffect(() => { refreshGlobalStatus(); }, [desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 3: note the newest audit line already on disk, then wait for a newer one from the agent.
  useEffect(() => {
    if (step !== 2 || !project || !desktop) return;
    let cancelled = false;
    let base: string | null = null;
    const read = () => invoke<AuditEntry[]>("read_audit_log", { workspacePath: project.path, limit: 20 }).catch(() => [] as AuditEntry[]);
    void read().then((entries) => {
      if (cancelled) return;
      base = entries.reduce<string>((latest, e) => (String(e.ts ?? "") > latest ? String(e.ts) : latest), "");
    });
    const timer = window.setInterval(() => {
      if (base === null) return;
      void read().then((entries) => {
        if (cancelled) return;
        const fresh = entries.filter((e) => e.agent && String(e.ts ?? "") > (base ?? "")).pop();
        if (fresh) setLiveCall(fresh);
      });
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [step, project, desktop]);

  // Re-check global entries and run the Nexus-side checks whenever step 3 opens.
  useEffect(() => {
    if (step === 2 && desktop) { refreshGlobalStatus(); void runSetupChecks(); }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // After 60 seconds on step 3 with no call, say what usually causes it.
  useEffect(() => {
    setStuck(false);
    if (step !== 2 || liveCall) return;
    const timer = window.setTimeout(() => setStuck(true), STUCK_MS);
    return () => window.clearTimeout(timer);
  }, [step, liveCall]);

  function refreshGlobalStatus() {
    if (!desktop) return;
    invoke<GlobalAgentStatus[]>("global_agent_status")
      .then((list) => setGlobalStatus(Object.fromEntries(list.map((s) => [s.agent_id, s]))))
      .catch(() => undefined);
  }

  function changePath(value: string) {
    setPath(value);
    if (!nameTouched) setName(folderName(value));
  }

  async function browse() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose the project folder" });
      if (typeof selected === "string" && selected) changePath(selected);
    } catch { /* keep the typed path */ }
  }

  async function openNodeDownload() {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://nodejs.org/en/download");
    } catch { /* the message already names nodejs.org */ }
  }

  function toggleAgent(id: string) {
    setTicked((current) => ({ ...current, [id]: !current[id] }));
  }

  /** Writes one user-level entry for each ticked Claude Code / OpenCode. Every outcome is shown, failures included. */
  async function connectGlobal() {
    if (!desktop || globalPicked.length === 0) return;
    setConnectingGlobal(true);
    await restart();
    const results: Record<string, RowResult> = {};
    for (const a of globalPicked) {
      try {
        const status = await invoke<GlobalAgentStatus>("connect_agent_globally", { agentId: a.id });
        setGlobalStatus((current) => ({ ...current, [a.id]: status }));
        results[a.id] = status.connected
          ? { ok: true, text: "Connected for all projects." }
          : { ok: false, text: status.detail || `Nexus could not confirm the ${a.name} entry.` };
      } catch (e) {
        results[a.id] = { ok: false, text: errorText(e, `Could not connect ${a.name}. Try again.`) };
      }
    }
    setGlobalResults((current) => ({ ...current, ...results }));
    setConnectingGlobal(false);
  }

  /** Writes the per-project entry for each agent that has no global one. Failures are kept for step 3. */
  async function connectProjectAgents(workspacePath: string, targets: AgentInfo[]) {
    if (targets.length === 0) return;
    await restart();
    const results: Record<string, RowResult> = {};
    for (const a of targets) {
      try {
        const result = await invoke<string | AgentConfigEdit>("connect_agent_to_project", { workspacePath, agentId: a.id, httpUrl: nexusHttpUrlFor(workspacePath) });
        results[a.id] = { ok: true, text: `Wrote ${typeof result === "string" ? result : result.path}.` };
      } catch (e) {
        results[a.id] = { ok: false, text: errorText(e, `Could not write ${a.file}. Check the folder still exists and the file is valid.`) };
      }
    }
    setProjectResults((current) => ({ ...current, ...results }));
  }

  async function register() {
    if (!registeredId) {
      if (!canRegister) return;
      // Declare the folder's real git identity. A hard-coded branch that differs
      // from the checked-out one makes Nexus fail closed ("the Git branch changed").
      let repo = "";
      let branch = "main";
      if (desktop) {
        try {
          const found = await invoke<FolderInspection>("inspect_project_folder", { workspacePath: path.trim() });
          if (found.git_remote) repo = found.git_remote;
          if (found.git_branch) branch = found.git_branch;
        } catch { /* a folder with no git keeps the defaults */ }
      }
      const id = onRegister({ name: name.trim(), path: path.trim(), repo, branch });
      if (!id) { setError("A project with that name already exists."); return; }
      setRegisteredId(id);
      setError("");
    }
    // Per-project agents are written now that the folder is registered. Agents already written are left alone.
    await connectProjectAgents(path.trim(), projectPicked.filter((a) => projectResults[a.id]?.ok !== true));
    setStep(2);
  }

  async function runSetupChecks() {
    if (!project) return;
    if (!desktop) { setTestError("Open the desktop app to run the check."); return; }
    const targets = pickedAgents.filter((a) => a.connect === "auto");
    if (targets.length === 0) return;
    setTesting(true); setTestError("");
    try {
      const next: Record<string, AgentTestStep[]> = {};
      for (const a of targets) {
        next[a.id] = await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId: a.id, httpUrl: nexusHttpUrlFor(project.path) });
      }
      setChecks((current) => ({ ...current, ...next }));
    } catch {
      setTestError("Could not run the check. Make sure Nexus is running and the project folder still exists.");
    } finally {
      setTesting(false);
    }
  }

  function copyText(key: string, text: string) {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    }).catch(() => undefined);
  }

  function toggleTick(key: string) {
    setTicks((current) => ({ ...current, [key]: !current[key] }));
  }

  function addService() {
    if (project) onOpenAddBinding(project.id);
  }

  /** Live state of one per-project agent's config, from its own connect result and the setup check. */
  function configState(a: AgentInfo): { state: RowState; detail: string | null } {
    const written = projectResults[a.id];
    const check = (checks[a.id] ?? []).find((c) => c.step === "Agent config");
    if (!written) return { state: "pending", detail: null };
    if (!written.ok) return { state: "failed", detail: written.text };
    if (check) return { state: check.ok ? "ok" : "failed", detail: check.ok ? null : check.detail };
    return { state: "pending", detail: null };
  }

  // A real project of the user's only: the built-in sample projects must not be shown as if they were theirs.
  const otherProject = projects.find((p) => p.id !== registeredId && !starterProjects.some((sample) => sample.id === p.id) && (p.connections ?? []).length > 0);
  const summaries = [
    connectedAny ? connectedAgents.map((a) => a.name).join(", ") : null,
    project ? project.path : null,
    proven ? "Connected" : null,
  ];

  const nexusState: RowState = running === null ? "pending" : running ? "ok" : "failed";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-(--canvas)">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--line) px-6 py-3">
        <img src="/nexus-symbol.png" alt="" width={26} height={26} className="rounded-[8px] bg-[#1a1a1a] p-1" />
        <span className="text-[14px] font-semibold text-(--text)">Set up Nexus</span>
        <span className="text-[12px] text-(--muted)">Step {step + 1} of {STEPS.length} · about two minutes</span>
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {desktop && running !== null && (
            <span className="flex min-w-0 items-center gap-2">
              <span className="nx-badge mr-1 shrink-0 !px-2.5 !py-1 text-[11.5px]" data-tone={running ? "success" : "warning"} title={detail}>
                {running ? "Nexus running" : "Nexus not running"}
                {!running && <button type="button" className="ml-1.5 underline underline-offset-2" disabled={starting} onClick={() => void restart()}>{starting ? "Starting…" : "Start"}</button>}
              </span>
              {!running && detail && <span className="max-w-[320px] truncate text-[11.5px] text-(--muted)">{detail}</span>}
            </span>
          )}
          <ThemeButton /><Button size="sm" variant="ghost" onPress={onSkip}>Skip for now</Button>
        </span>
      </header>

      {desktop && running === false && (
        <p className="flex shrink-0 flex-wrap items-center gap-3 bg-(--orange-bg) px-6 py-2 text-[12px] text-(--orange)" role="alert">
          <span className="min-w-0 flex-1">{detail}</span>
          {needsNode && <Button size="sm" variant="outline" onPress={() => void openNodeDownload()}>Get Node.js</Button>}
        </p>
      )}
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="nx-card flex min-h-0 flex-col">
          <ol className="mb-4 flex flex-col" aria-label="Setup steps">
            {STEPS.map((label, index) => (
              <li key={label}>
                <button type="button" disabled={index > step && !summaries[index - 1]} onClick={() => setStep(index)} className="flex w-full items-center gap-2.5 py-1.5 text-left disabled:cursor-default">
                  <span className="nx-check" data-state={summaries[index] ? "done" : undefined} style={index === step && !summaries[index] ? { borderColor: "var(--text)" } : undefined}>
                    {summaries[index] ? <NxIcon name="check" size={13} /> : <span className="text-[10.5px] font-semibold text-(--muted)">{index + 1}</span>}
                  </span>
                  <span className="flex-1 text-[13px]" style={{ color: index === step ? "var(--text)" : "var(--muted)", fontWeight: index === step ? 600 : 400 }}>{label}</span>
                  {summaries[index] && <span className="nx-mono max-w-[45%] truncate text-(--muted-2)">{summaries[index]}</span>}
                </button>
              </li>
            ))}
          </ol>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-(--line-soft) pt-4">
            {step === 0 && (
              <div className="flex flex-col gap-3">
                <div>
                  <h2 className="text-[16px] font-semibold text-(--text)">Connect your agents</h2>
                  <p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Pick the agents you use. Claude Code and OpenCode connect once and work in every project.</p>
                  {!agentsFound && <p className="mt-1 text-[12px] text-(--muted-2)">{desktop ? "No agent was detected, so these are the common ones." : "The desktop app finds the agents on this machine."}</p>}
                </div>
                <ul className="flex flex-col rounded-[12px] border border-(--line)" aria-label="Agents">
                  {agents.map((a) => {
                    const result = globalResults[a.id];
                    const alreadyConnected = a.global && globalStatus[a.id]?.connected === true;
                    return (
                      <li key={a.id} className="border-t border-(--line-soft) first:border-t-0">
                        <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
                          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-(--text)" checked={!!ticked[a.id]} disabled={connectingGlobal} onChange={() => toggleAgent(a.id)} />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-2 text-[13px] text-(--text)">
                              {a.name}
                              {alreadyConnected && <span className="text-[11.5px] font-medium text-(--green)">Already connected</span>}
                            </span>
                            <span className="text-[12px] text-(--muted)">{a.global ? "Connects once for all your projects" : a.connect === "auto" ? "Set up for each project (next step)" : "Paste a snippet later"}</span>
                            {result && (
                              <span className="flex items-start gap-1.5 text-[12px] leading-[1.5]" style={{ color: result.ok ? "var(--green)" : "var(--red)" }} role={result.ok ? "status" : "alert"}>
                                <NxIcon name={result.ok ? "check" : "x"} size={13} />
                                <span className="min-w-0 flex-1">{result.text}</span>
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>

                {globalPicked.length > 0 && (
                  <p className="text-[12px] leading-[1.55] text-(--muted)">
                    This adds one entry to <span className="nx-mono">{configPaths.length > 0 ? configPaths.join(" and ") : "your user config"}</span> (a backup is kept). Remove it any time from Agents.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" isDisabled={!desktop || globalPicked.length === 0 || connectingGlobal} onPress={() => void connectGlobal()}>
                    {connectingGlobal ? "Connecting…" : `Connect ${globalPicked.length} ${globalPicked.length === 1 ? "agent" : "agents"}`}
                  </Button>
                  <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-(--muted)">
                    {!desktop ? "Needs the desktop app." : globalPicked.length === 0 ? "Tick Claude Code or OpenCode to connect them once." : "Connects once for all your projects."}
                  </span>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div><h2 className="text-[16px] font-semibold text-(--text)">Add your project</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Pick the folder your agent works in.</p></div>
                <label className="nx-field">
                  Project folder
                  <span className="flex gap-2">
                    <input value={path} onChange={(e) => changePath(e.target.value)} placeholder="~/Projects/Koupa" disabled={!!registeredId} className={`${inputClass} nx-mono`} />
                    {desktop && !registeredId && <Button size="sm" variant="outline" onPress={() => void browse()}>Browse</Button>}
                  </span>
                  {!desktop && <span className="text-[11.5px] text-(--muted)">Browse is available in the desktop app. In the browser preview, type the path.</span>}
                </label>
                {existing && !registeredId && name.trim().toLowerCase() !== existing.toLowerCase() && (
                  <p className="flex flex-wrap items-center gap-2 rounded-[10px] bg-(--blue-bg) px-3 py-2 text-[12px] text-(--blue)">
                    This folder already has a Nexus project: <strong className="font-semibold">{existing}</strong>.
                    <Button size="sm" variant="outline" onPress={() => { setName(existing); setNameTouched(true); }}>Use that name</Button>
                  </p>
                )}
                <label className="nx-field">
                  Project name
                  <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); setError(""); }} placeholder="Koupa" disabled={!!registeredId} className={inputClass} />
                  {nameUsed && <span className="text-[12px] text-(--red)" role="alert">A project with this name already exists.</span>}
                </label>
                {projectPicked.length > 0 && (
                  <p className="text-[12px] leading-[1.55] text-(--muted)">Nexus also sets up {projectPicked.map((a) => a.name).join(", ")} in this folder when you continue.</p>
                )}
                {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-3">
                <div><h2 className="text-[16px] font-semibold text-(--text)">Check the connection</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Nexus can see some of these steps. The others are on you, so tick them as you go.</p></div>
                <ul className="flex flex-col rounded-[12px] border border-(--line)" aria-label="Connection checklist">
                  <LiveRow state={nexusState}>
                    <span className="text-[13px] text-(--text)">Nexus is running</span>
                    {running === false && (
                      <span className="flex flex-wrap items-center gap-3 text-[12px] text-(--red)">
                        Nexus is not running. Keep Nexus Guard open.
                        <Button size="sm" variant="outline" isDisabled={starting} onPress={() => void restart()}>{starting ? "Restarting…" : "Restart Nexus"}</Button>
                      </span>
                    )}
                    {running === null && !desktop && <span className="text-[12px] text-(--muted)">Needs the desktop app.</span>}
                  </LiveRow>

                  {pickedAgents.map((a) => {
                    if (a.global) {
                      const status = globalStatus[a.id];
                      const globalState: RowState = status ? (status.connected ? "ok" : "failed") : "pending";
                      return (
                        <Fragment key={a.id}>
                          <LiveRow state={globalState}>
                            <span className="text-[13px] text-(--text)">{a.name} has Nexus for all projects</span>
                            {globalState === "failed" && <span className="text-[12px] text-(--muted)">{globalResults[a.id]?.text ?? status?.detail ?? `Nothing is written yet. Go back and connect ${a.name}.`}</span>}
                          </LiveRow>
                          <TickRow ticked={!!ticks[`${a.id}:restart`]} onToggle={() => toggleTick(`${a.id}:restart`)}>
                            <span className="text-[13px] text-(--text)">{a.globalRestart}</span>
                          </TickRow>
                          {project && (
                            <TickRow ticked={!!ticks[`${a.id}:open`]} onToggle={() => toggleTick(`${a.id}:open`)}>
                              <span className="text-[13px] text-(--text)">Open {a.name} in this project folder</span>
                              <span className="nx-mono text-[12px] text-(--muted)">{project.path}</span>
                            </TickRow>
                          )}
                        </Fragment>
                      );
                    }

                    if (a.connect === "manual") {
                      const snippet = project ? manualSnippet(a.id, project.path) : "";
                      return (
                        <TickRow key={a.id} ticked={!!ticks[`${a.id}:snippet`]} onToggle={() => toggleTick(`${a.id}:snippet`)}>
                          <span className="text-[13px] text-(--text)">Add the snippet to <span className="nx-mono">{a.file}</span></span>
                          {snippet && (
                            <span className="flex flex-col gap-2">
                              <pre className="nx-mono overflow-x-auto rounded-[10px] bg-(--raised) p-3 text-[12px] leading-[1.55] text-(--text)">{snippet}</pre>
                              <span><Button size="sm" variant="outline" onPress={() => copyText(`snippet:${a.id}`, snippet)}>{copied === `snippet:${a.id}` ? "Copied" : "Copy"}</Button></span>
                            </span>
                          )}
                        </TickRow>
                      );
                    }

                    const config = configState(a);
                    return (
                      <Fragment key={a.id}>
                        <LiveRow state={config.state}>
                          <span className="text-[13px] text-(--text)"><span className="nx-mono">{a.file}</span> has the Nexus entry</span>
                          {config.state === "failed" && <span className="text-[12px] text-(--muted)">{config.detail}</span>}
                          {config.state === "failed" && project && (
                            <button type="button" className="self-start text-[12px] text-(--muted) underline underline-offset-2 hover:text-(--text)" onClick={() => onOpenConnectAgent(project.id, a.id)}>Prefer to run the command yourself?</button>
                          )}
                        </LiveRow>
                        <TickRow ticked={!!ticks[`${a.id}:restart`]} onToggle={() => toggleTick(`${a.id}:restart`)}>
                          <span className="text-[13px] text-(--text)">{a.restart}</span>
                          {project && <span className="nx-mono text-[12px] text-(--muted)">{project.path}</span>}
                        </TickRow>
                        {a.trustPrompt && (
                          <TickRow ticked={!!ticks[`${a.id}:trust`]} onToggle={() => toggleTick(`${a.id}:trust`)}>
                            <span className="text-[13px] text-(--text)">{emphasizeChoice(a.trustPrompt)}</span>
                            <span className="text-[12px] text-(--muted)">If you skip this, the agent never connects.</span>
                          </TickRow>
                        )}
                      </Fragment>
                    );
                  })}

                  <TickRow ticked={!!ticks.prompt} onToggle={() => toggleTick("prompt")}>
                    <span className="text-[13px] text-(--text)">Send this message to {agentLabel}:</span>
                    <span className="flex items-center gap-3 rounded-[10px] bg-(--raised) px-3 py-2">
                      <span className="nx-mono min-w-0 flex-1 text-[13px] text-(--text)">{FIRST_PROMPT}</span>
                      <Button size="sm" variant="outline" onPress={() => copyText("prompt", FIRST_PROMPT)}>{copied === "prompt" ? "Copied" : "Copy"}</Button>
                    </span>
                  </TickRow>

                  <LiveRow state={liveCall ? "ok" : "pending"}>
                    <span className="text-[13px] text-(--text)">{liveCall ? `${callerName} reached Nexus` : `Waiting for ${agentLabel}'s first call`}</span>
                  </LiveRow>
                </ul>
                {testError && <p className="text-[12px] text-(--red)" role="alert">{testError}</p>}

                {liveCall && (
                  <div className="flex flex-col gap-1.5 rounded-[12px] bg-(--green-bg) px-3.5 py-2.5" role="status">
                    <p className="text-[13px] font-semibold text-(--green)">Connected. {callerName} just called Nexus.</p>
                    <p className="text-[12px] leading-[1.55] text-(--muted)">From now on, every call it makes through Nexus shows up in Home.</p>
                  </div>
                )}

                {!liveCall && stuck && (
                  <div className="flex flex-col gap-2 rounded-[12px] bg-(--orange-bg) px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-(--orange)" role="status">
                    <p><strong className="font-semibold">Still waiting. Most likely cause:</strong> {hintAgent?.stuckHint ?? "Make sure your agent is open in the project folder."}</p>
                    <p>Nexus only runs while this app is open.</p>
                  </div>
                )}
                {!liveCall && stuck && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" variant="outline" isDisabled={testing || !project || !desktop} onPress={() => void runSetupChecks()}>{testing ? "Checking…" : "Re-check Nexus's side"}</Button>
                    <span className="min-w-0 flex-1 text-[12px] text-(--muted)">This only checks Nexus. Your agent&apos;s first call is the real test.</span>
                  </div>
                )}

                {proven && (
                  <div className="rounded-[12px] bg-(--raised) px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-(--muted)">
                    {otherProject
                      ? <>Without Nexus, an agent in {project?.name} could have reached {otherProject.name}&apos;s resources. Here that call is refused before it leaves your machine.</>
                      : <>Without Nexus, an agent in {project?.name} could reach any resource your account allows. Here only what you add to this project is reachable.</>}
                  </div>
                )}
                {proven && (
                  <div className="flex flex-col gap-2 rounded-[12px] border border-(--line) p-3">
                    <span className="nx-eyebrow">Optional · Add a service</span>
                    <span className="text-[12px] leading-[1.5] text-(--muted)">Tell Nexus which exact resource this project uses. Anything else is refused.</span>
                    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Service">
                      {SERVICES.map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={service === s} onClick={() => setService(s)} className="nx-badge cursor-pointer !px-3 !py-1.5 text-[12px]" style={service === s ? { background: "var(--text)", color: "var(--canvas)" } : undefined}>{s}</button>
                      ))}
                      <Button size="sm" onPress={addService}><NxIcon name="plus" size={15} />Add {service}</Button>
                    </div>
                    {project && project.connections.length > 0 && (
                      <ul>{project.connections.map((c) => <li key={c.id} className="flex items-center gap-2 py-1 text-[12.5px]"><NxIcon name="check" size={14} /><span className="text-(--text)">{c.provider}</span><span className="nx-mono text-(--muted)">{c.resource ?? c.target}</span></li>)}</ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex shrink-0 items-center justify-between gap-2 border-t border-(--line-soft) pt-3">
            {step === 0 ? <span className="min-w-0 flex-1 text-[11.5px] text-(--muted)">{connectedAny ? "" : "Connect an agent now, or set it up later."}</span> : <Button size="sm" variant="ghost" onPress={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>}
            {step === 0 && <Button size="sm" variant={connectedAny ? "primary" : "outline"} isDisabled={connectingGlobal} onPress={() => setStep(1)}>{connectedAny ? "Continue" : "Skip this step"}</Button>}
            {step === 1 && <Button size="sm" isDisabled={!registeredId && !canRegister} onPress={() => void register()}>{registeredId ? "Continue" : "Register project"}</Button>}
            {step === 2 && <Button size="sm" variant={proven ? "primary" : "outline"} onPress={onFinish}>{proven ? "Open Home" : "Finish later"}</Button>}
          </div>
        </section>

        <section className="nx-card flex min-h-[320px] flex-col" aria-label="Your graph">
          <span className="nx-eyebrow">{project ? "Your graph · builds as you go" : "What Nexus does"}</span>
          <Graph project={project} agentName={connectedAny ? connectedAgents.map((a) => a.name).join(", ") : null} lit={proven} other={proven ? otherProject ?? null : null} />
          <p className="mt-auto pt-4 text-[12px] text-(--muted-2)">{project ? "Step 1 connects your agents, step 2 adds the project. In step 3 the lines light up." : "Connect your agents once. Link your services once."}</p>
        </section>
      </div>
    </div>
  );
}

/** A row Nexus checks itself. Never clickable: the icon is the status. */
function LiveRow({ state, children }: { state: RowState; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 border-t border-(--line-soft) px-3 py-2.5 first:border-t-0">
      {state === "pending"
        ? <span role="img" aria-label="Checking" className="mt-0.5 inline-block size-[18px] shrink-0 animate-spin rounded-full border-2 border-(--line) border-t-(--text)" />
        : <span className="nx-check mt-0.5 shrink-0" data-state={state === "ok" ? "done" : "failed"} style={{ width: 18, height: 18 }}><NxIcon name={state === "ok" ? "check" : "x"} size={11} /></span>}
      <span className="flex min-w-0 flex-1 flex-col gap-1">{children}</span>
    </li>
  );
}

/** A row only the user can do. Ticked by hand, labelled so it is never read as live status. */
function TickRow({ ticked, onToggle, children }: { ticked: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <li className="border-t border-(--line-soft) first:border-t-0">
      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5">
        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-(--text)" checked={ticked} onChange={onToggle} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {children}
          <span className="text-[11px] text-(--muted-2)">You do this</span>
        </span>
      </label>
    </li>
  );
}

/** Bolds “Choose yes” inside the agent's trust prompt, so the one click that matters stands out. */
function emphasizeChoice(text: string): ReactNode {
  const parts = text.split("Choose yes");
  if (parts.length === 1) return text;
  return <>{parts[0]}<strong className="font-semibold">Choose yes</strong>{parts.slice(1).join("Choose yes")}</>;
}

function Graph({ project, agentName, lit, other }: { project: Project | null; agentName: string | null; lit: boolean; other: Project | null }) {
  const services = useMemo(() => (project?.connections ?? []).slice(0, 2), [project]);
  const stroke = lit ? "var(--green)" : "var(--line)";
  const node = (key: string, icon: "agents" | "folder" | "database", title: string, sub: string, tone?: string, dashed = false) => (
    <div key={key} className="flex min-w-0 items-center gap-2.5 rounded-[14px] border bg-(--panel) px-3 py-2.5" style={{ borderColor: dashed ? "var(--muted-2)" : "var(--line)", borderStyle: dashed ? "dashed" : "solid", opacity: dashed ? 0.8 : 1 }}>
      <span className="nx-tile" data-tone={tone} style={{ width: 30, height: 30 }}><NxIcon name={icon} size={16} /></span>
      <span className="flex min-w-0 flex-col"><strong className="truncate text-[13px] font-semibold text-(--text)">{title}</strong><span className="truncate text-[11.5px] text-(--muted)">{sub}</span></span>
    </div>
  );
  const connector = (key: string) => (
    <svg key={key} className="mx-1 shrink-0" width="44" height="12" aria-hidden="true"><line x1="0" y1="6" x2="44" y2="6" stroke={stroke} strokeWidth="2" strokeDasharray={lit ? "6 6" : "3 4"} className={lit ? "topo-flow" : undefined} /></svg>
  );
  if (!project) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-3 py-4">
        <div className="rounded-[14px] border border-(--line) bg-(--panel) px-4 py-3"><strong className="text-[13px] font-semibold text-(--text)">Without Nexus</strong><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Every agent holds your keys and can reach any project or environment they unlock.</p></div>
        <div className="rounded-[14px] border border-(--line) bg-(--panel) px-4 py-3"><strong className="text-[13px] font-semibold text-(--text)">With Nexus</strong><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Agents never hold keys. Each call resolves to this project&apos;s own resources, and anything else is refused before it leaves your machine.</p></div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 py-4">
      <div className="flex items-center justify-center">
        {agentName && <>{node("agent", "agents", agentName, "Agent", lit ? "success" : undefined)}{connector("c1")}</>}
        {node("project", "folder", project.name, project.environment)}
        {services.length > 0 && connector("c2")}
        {services.length > 0 && <div className="flex flex-col gap-2">{services.map((c) => node(c.id, "database", c.provider, c.resource ?? c.target, "info"))}</div>}
      </div>
      {other && (
        <div className="flex justify-center">{node("refused", "database", `${other.name} · ${other.connections[0].resource ?? other.connections[0].target}`, "Refused: another project", "danger", true)}</div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable, unlockVault } from "../vault";
import { starterProjects, type Project } from "../store";
import { ThemeButton, nexusHttpUrlFor } from "../onboarding";
import { agentDisplayName } from "../topology";
import { type AgentConfigEdit, type AgentTestStep, type AuditEntry, type DetectedAgent, type FolderInspection } from "../app/types";
import { Button } from "@heroui/react";
import { Icon as NxIcon } from "../ui";
import { inputClass } from "../app/styles";

const STEPS = ["Project", "Agent", "See it work"] as const;
const ALL_SERVICES = ["Supabase", "GitHub"] as const;
const FALLBACK_AGENTS = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "opencode", name: "OpenCode" },
];
const AGENT_FILES: Record<string, string> = { claude: ".mcp.json", codex: ".codex/config.toml", opencode: "opencode.json", pi: ".mcp.json" };
const FIRST_PROMPT = "Which Nexus project am I in?";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** First run, per paper §12: register one real project, connect one agent with
 *  one click, then watch the agent's first real call arrive. Linking a service
 *  is optional and comes after the proof, so the first value needs no accounts.
 *  The graph on the right gains a node per step. */
export function FirstRun({ projects, resumeProject, vaultUnlocked, onVaultUnlocked, onRegister, onOpenAddBinding, onOpenConnectAgent, onSkip, onFinish }: {
  projects: Project[];
  /** A project registered earlier whose setup was skipped: the wizard reopens at the agent step. */
  resumeProject?: Project | null;
  /** Nexus starts locked and refuses agent calls until the vault is unlocked. */
  vaultUnlocked: boolean;
  onVaultUnlocked: () => void;
  onRegister: (input: { name: string; path: string; repo: string; branch: string }) => string | null;
  onOpenAddBinding: (projectId: string) => void;
  onOpenConnectAgent: (projectId: string, agentId: string | null) => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(resumeProject ? 1 : 0);
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
  const [agents, setAgents] = useState<{ id: string; name: string }[]>(FALLBACK_AGENTS);
  const [agentsFound, setAgentsFound] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(FALLBACK_AGENTS[0].id);
  const [written, setWritten] = useState<AgentConfigEdit | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  // Setup checks run when the agent is connected. These are not proof that the agent works.
  const [connectChecks, setConnectChecks] = useState<AgentTestStep[]>([]);
  // Only the optional "simulated check" in the last step counts as a stand-in for the agent's first call.
  const [checks, setChecks] = useState<AgentTestStep[]>([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [baseline, setBaseline] = useState<string | null>(null);
  const [liveCall, setLiveCall] = useState<AuditEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [server, setServer] = useState<{ running: boolean; needs_node?: boolean; detail: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const desktop = desktopAvailable();

  const project = projects.find((p) => p.id === registeredId) ?? null;
  const nameUsed = !registeredId && projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const canRegister = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;
  const simulated = checks.length > 0 && ["Project file", "HTTP reachable", "Session"].every((s) => checks.find((c) => c.step === s)?.ok);
  const proven = !!liveCall || simulated;
  const agent = agents.find((a) => a.id === agentId) ?? null;
  const agentFile = agentId ? AGENT_FILES[agentId] ?? "its MCP config" : "its MCP config";
  const connected = !!written;

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

  async function openNodeDownload() {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://nodejs.org/en/download");
    } catch { /* the message already names nodejs.org */ }
  }

  async function ensureServer() {
    if (!desktop) return true;
    setStarting(true);
    try {
      const status = await invoke<{ running: boolean; needs_node?: boolean; detail: string }>("ensure_nexus_server");
      setServer(status);
      return status.running;
    } catch {
      setServer({ running: false, detail: "Nexus could not start its local server. Restart the app." });
      return false;
    } finally {
      setStarting(false);
    }
  }
  useEffect(() => { void ensureServer(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!desktop) return;
    invoke<{ configured: boolean }>("github_status").then((status) => setGithubReady(status.configured)).catch(() => undefined);
  }, [desktop]);

  // Preselect the first agent found on this machine so the common case is one click.
  useEffect(() => {
    if (!desktop) return;
    invoke<DetectedAgent[]>("detect_agents").then((found) => {
      const list = found.filter((a) => a.found).map((a) => ({ id: a.id, name: a.name }));
      if (list.length > 0) { setAgents(list); setAgentsFound(true); setAgentId(list[0].id); }
    }).catch(() => undefined);
  }, [desktop]);

  // Step 3: note the newest audit line already on disk, then wait for a newer one from the agent.
  useEffect(() => {
    if (step !== 2 || !project || !desktop) return;
    let cancelled = false;
    let base: string | null = null;
    const read = () => invoke<AuditEntry[]>("read_audit_log", { workspacePath: project.path, limit: 20 }).catch(() => [] as AuditEntry[]);
    void read().then((entries) => {
      if (cancelled) return;
      base = entries.reduce<string>((latest, e) => (String(e.ts ?? "") > latest ? String(e.ts) : latest), "");
      setBaseline(base);
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

  async function register() {
    if (registeredId) { setStep(1); return; }
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
    setStep(1);
  }

  async function connectAgent() {
    if (!project || !agentId) return;
    if (!desktop) { setConnectError("Open the desktop app to connect an agent."); return; }
    setConnecting(true); setConnectError(""); setConnectChecks([]);
    await ensureServer();
    const httpUrl = nexusHttpUrlFor(project.path);
    try {
      const result = await invoke<string | AgentConfigEdit>("connect_agent_to_project", { workspacePath: project.path, agentId, httpUrl });
      setWritten(typeof result === "string" ? { path: result, backup: "", diff: "" } : result);
      setConnectChecks(await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, httpUrl }));
    } catch {
      setConnectError(`Could not write ${agentFile}. Check the folder still exists and the file is valid, or use the manual steps.`);
    } finally {
      setConnecting(false);
    }
  }

  async function runTest() {
    if (!project) return;
    if (!desktop) { setTestError("Open the desktop app to run the check."); return; }
    setTesting(true); setTestError(""); setChecks([]);
    await ensureServer();
    try {
      setChecks(await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId: agentId ?? "claude", httpUrl: nexusHttpUrlFor(project.path) }));
    } catch {
      setTestError("Could not run the check. Make sure Nexus is running and the project folder still exists.");
    } finally {
      setTesting(false);
    }
  }

  const locked = desktop && !vaultUnlocked;

  async function unlock() {
    setUnlocking(true); setUnlockError("");
    try {
      await unlockVault(password);
      setPassword("");
      onVaultUnlocked();
    } catch {
      setUnlockError("That password did not work. Check it and try again.");
    } finally {
      setUnlocking(false);
    }
  }

  function copyPrompt() {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(FIRST_PROMPT).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  }

  function bindService() {
    if (project) onOpenAddBinding(project.id);
  }

  // A real project of the user's only: the built-in sample projects must not be shown as if they were theirs.
  const otherProject = projects.find((p) => p.id !== registeredId && !starterProjects.some((sample) => sample.id === p.id) && (p.connections ?? []).length > 0);
  const summaries = [
    project ? project.path : null,
    connected && agent ? agent.name : null,
    proven ? "Routed" : null,
  ];
  // "Saved approval" is about a Supabase binding, which a new user does not have yet; a red mark there reads as a failure.
  const checkList = (all: AgentTestStep[]) => {
    const list = all.filter((c) => c.step !== "Saved approval");
    return (
    <ul className="rounded-[12px] border border-(--line)">
      {list.map((c, i) => (
        <li key={c.step} className="flex items-start gap-2.5 px-3 py-2" style={i > 0 ? { borderTop: "1px solid var(--line-soft)" } : undefined}>
          <span className="nx-check mt-0.5" data-state={c.ok ? "done" : "failed"} style={{ width: 18, height: 18 }}><NxIcon name={c.ok ? "check" : "x"} size={11} /></span>
          <span className="flex min-w-0 flex-1 flex-col"><span className="text-[12.5px] font-medium text-(--text)">{c.step}</span><span className="text-[11.5px] text-(--muted)">{c.detail}</span></span>
        </li>
      ))}
    </ul>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-(--canvas)">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--line) px-6 py-3">
        <img src="/nexus-symbol.png" alt="" width={26} height={26} className="rounded-[8px] bg-[#1a1a1a] p-1" />
        <span className="text-[14px] font-semibold text-(--text)">Set up Nexus</span>
        <span className="text-[12px] text-(--muted)">Step {step + 1} of {STEPS.length} · about two minutes</span>
        <span className="ml-auto flex items-center gap-1">
          {desktop && server && (
            <span className="nx-badge mr-1 !px-2.5 !py-1 text-[11.5px]" data-tone={server.running ? "success" : "warning"} title={server.detail}>
              {server.running ? "Nexus running" : "Nexus not running"}
              {!server.running && <button type="button" className="ml-1.5 underline underline-offset-2" disabled={starting} onClick={() => void ensureServer()}>{starting ? "Starting…" : "Start"}</button>}
            </span>
          )}
          <ThemeButton /><Button size="sm" variant="ghost" onPress={onSkip}>Skip for now</Button></span>
      </header>

      {desktop && server && !server.running && (
        <p className="flex shrink-0 flex-wrap items-center gap-3 bg-(--orange-bg) px-6 py-2 text-[12px] text-(--orange)" role="alert">
          <span className="min-w-0 flex-1">{server.detail}</span>
          {server.needs_node && <Button size="sm" variant="outline" onPress={() => void openNodeDownload()}>Get Node.js</Button>}
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
                <div><h2 className="text-[16px] font-semibold text-(--text)">Pick the folder your agent works in</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Nexus ties your agent to this project, so it can only reach what belongs to it. Nothing secret is stored.</p></div>
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
                {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div><h2 className="text-[16px] font-semibold text-(--text)">Connect your agent</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">{agentsFound ? "Found on this machine. Pick the one you use." : desktop ? "No agent was detected, so these are the common ones." : "The desktop app lists the agents it finds."}</p></div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Agent">
                  {agents.map((a) => (
                    <button key={a.id} type="button" role="radio" aria-checked={agentId === a.id} onClick={() => { setAgentId(a.id); setWritten(null); setConnectChecks([]); setConnectError(""); }} className="nx-badge cursor-pointer !px-3.5 !py-2 text-[12.5px]" style={agentId === a.id ? { background: "var(--text)", color: "var(--canvas)" } : undefined}>{a.name}</button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" isDisabled={!project || !agentId || connecting || !desktop} onPress={() => void connectAgent()}>{connecting ? "Connecting…" : connected ? "Connect again" : agent ? `Connect ${agent.name}` : "Pick an agent"}</Button>
                  <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-(--muted)">{desktop ? <>Adds one Nexus entry to <span className="nx-mono">{agentFile}</span> in your project. Your other servers are kept and a backup is saved first.</> : "Needs the desktop app."}</span>
                </div>
                {connectError && <p className="text-[12px] text-(--red)" role="alert">{connectError}</p>}
                {written && (
                  <p className="rounded-[10px] bg-(--green-bg) px-3 py-2 text-[12px] leading-[1.55] text-(--green)">
                    Wrote <span className="nx-mono">{written.path}</span>{written.diff ? ` · ${written.diff}` : ""}. {written.backup ? <>Backup at <span className="nx-mono">{written.backup}</span>.</> : "New file, so nothing to back up."}
                  </p>
                )}
                {connected && locked && <p className="text-[12px] leading-[1.55] text-(--muted)">Next you'll unlock Nexus, so your agent is allowed to call it.</p>}
                {connectChecks.length > 0 && checkList(connectChecks)}
                {project && <button type="button" className="self-start text-[12px] text-(--muted) underline underline-offset-2 hover:text-(--text)" onClick={() => onOpenConnectAgent(project.id, agentId)}>Prefer to run the command yourself?</button>}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-3">
                {locked && (
                  <form className="flex flex-col gap-2 rounded-[12px] border border-(--line) bg-(--raised) p-3" onSubmit={(event) => { event.preventDefault(); if (password.length >= 12 && !unlocking) void unlock(); }}>
                    <strong className="text-[13px] font-semibold text-(--text)">Unlock Nexus first</strong>
                    <p className="text-[12px] leading-[1.55] text-(--muted)">Nexus starts locked, and a locked Nexus refuses every agent call. The first time, this creates your vault password (at least 12 characters). You enter it each time you open Nexus.</p>
                    <label className="nx-field">
                      Vault password
                      <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required placeholder="At least 12 characters" className={inputClass} />
                    </label>
                    {unlockError && <p className="text-[12px] text-(--red)" role="alert">{unlockError}</p>}
                    <Button type="submit" size="sm" isDisabled={unlocking || password.length < 12} className="self-start">{unlocking ? "Unlocking…" : "Unlock Nexus"}</Button>
                  </form>
                )}
                <div><h2 className="text-[16px] font-semibold text-(--text)">See your agent reach Nexus</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Restart {agent?.name ?? "your agent"} in <span className="nx-mono">{project?.path ?? "your project"}</span>, then send it this message.{agentId === "claude" && " Claude Code will ask whether to trust the “nexus” server from .mcp.json. Choose yes, or it will never connect."}{agentId === "codex" && " Codex reads .codex/config.toml in that folder, so start it there."}</p></div>
                <div className="flex items-center gap-3 rounded-[10px] bg-(--raised) px-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-(--text)">{FIRST_PROMPT}</span>
                  <Button size="sm" variant="outline" onPress={copyPrompt}>{copied ? "Copied" : "Copy"}</Button>
                </div>
                {liveCall ? (
                  <div className="rounded-[12px] bg-(--green-bg) px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-(--green)" role="status">
                    {agentDisplayName(liveCall.agent ?? agent?.name ?? "Your agent")} called Nexus just now: <span className="nx-mono">{liveCall.operation ?? "a call"}</span> · {liveCall.decision === "allow" ? "allowed" : "refused"}.
                  </div>
                ) : desktop ? (
                  <p className="flex items-center gap-2 text-[12.5px] text-(--muted)" role="status"><span className="nx-check" style={{ width: 14, height: 14 }} />{locked ? "Unlock Nexus above, then send the message. Until then your agent is refused." : baseline === null ? "Getting ready…" : `Waiting for ${agent?.name ?? "your agent"}'s first call. This updates by itself.`}</p>
                ) : (
                  <p className="text-[12px] text-(--muted)">Live detection needs the desktop app.</p>
                )}
                {proven && (
                  <div className="rounded-[12px] bg-(--raised) px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-(--muted)">
                    {otherProject
                      ? <>Without Nexus, an agent in {project?.name} could have reached {otherProject.name}&apos;s resources. Here that call is refused before it leaves your machine.</>
                      : <>Without Nexus, an agent in {project?.name} could reach any resource your account allows. Here only what you bind to this project is reachable.</>}
                  </div>
                )}
                {!liveCall && (
                  <div className="flex flex-col gap-2 border-t border-(--line-soft) pt-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="sm" variant="outline" isDisabled={testing || !project} onPress={() => void runTest()}>{testing ? "Checking…" : checks.length ? "Run the check again" : "Run a simulated check"}</Button>
                      <span className="min-w-0 flex-1 text-[12px] text-(--muted)">Not working yet? This checks the setup without involving your agent.</span>
                    </div>
                    {testError && <p className="text-[12px] text-(--red)" role="alert">{testError}</p>}
                    {checks.length > 0 && checkList(checks)}
                  </div>
                )}
                {proven && (
                  <div className="flex flex-col gap-2 rounded-[12px] border border-(--line) p-3">
                    <span className="nx-eyebrow">Optional · Bind a service</span>
                    <span className="text-[12px] leading-[1.5] text-(--muted)">Tell Nexus which exact resource this project uses. Anything else is refused.</span>
                    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Service">
                      {SERVICES.map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={service === s} onClick={() => setService(s)} className="nx-badge cursor-pointer !px-3 !py-1.5 text-[12px]" style={service === s ? { background: "var(--text)", color: "var(--canvas)" } : undefined}>{s}</button>
                      ))}
                      <Button size="sm" onPress={bindService}><NxIcon name="plus" size={15} />Bind {service}</Button>
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
            {step === 0 ? <span className="min-w-0 flex-1 text-[11.5px] text-(--muted)">{!registeredId && !canRegister ? "Choose a folder and a name to continue." : ""}</span> : <Button size="sm" variant="ghost" onPress={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>}
            {step === 0 && <Button size="sm" isDisabled={!registeredId && !canRegister} onPress={() => void register()}>{registeredId ? "Continue" : "Register project"}</Button>}
            {step === 1 && <Button size="sm" variant={connected ? "primary" : "outline"} onPress={() => setStep(2)}>{connected ? "Continue" : "Skip this step"}</Button>}
            {step === 2 && <Button size="sm" variant={proven ? "primary" : "outline"} onPress={onFinish}>{proven ? "Open Home" : "Finish without testing"}</Button>}
          </div>
        </section>

        <section className="nx-card flex min-h-[320px] flex-col" aria-label="Your graph">
          <span className="nx-eyebrow">{project ? "Your graph · builds as you go" : "What Nexus does"}</span>
          <Graph project={project} agentName={connected ? agent?.name ?? null : null} lit={proven} other={proven ? otherProject ?? null : null} />
          <p className="mt-auto pt-4 text-[12px] text-(--muted-2)">{project ? "Step 1 adds the project, step 2 the agent. In step 3 the lines light up." : "Connect your agents once. Link your services once."}</p>
        </section>
      </div>
    </div>
  );
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

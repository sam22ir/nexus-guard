import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../vault";
import { type Account, type Project } from "../store";
import { ThemeButton, nexusHttpUrlFor } from "../onboarding";
import { type AgentTestStep, type DetectedAgent, type FolderInspection } from "../app/types";
import { Button } from "@heroui/react";
import { Icon as NxIcon } from "../ui";
import { inputClass, selectClass } from "../app/styles";

const STEPS = ["Register", "Link", "Connect", "See it work"] as const;
const SERVICES = ["Supabase", "GitHub"] as const;
const FALLBACK_AGENTS = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "opencode", name: "OpenCode" },
];

/** First run, per paper §12: register one real project, link one service,
 *  connect one agent, then watch a real check route through Nexus. The graph on
 *  the right gains a node per step. The project is registered at the end of
 *  step 1 so the proof reads a real folder. */
export function FirstRun({ projects, accounts, onRegister, onAddAccount, onOpenAddBinding, onOpenConnectAgent, onSkip, onFinish }: {
  projects: Project[];
  accounts: Account[];
  onRegister: (input: { name: string; path: string; repo: string; branch: string }) => string | null;
  onAddAccount: (input: { provider: string; label: string }) => void;
  onOpenAddBinding: (projectId: string) => void;
  onOpenConnectAgent: (projectId: string, agentId: string | null) => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [service, setService] = useState<(typeof SERVICES)[number]>("Supabase");
  const [label, setLabel] = useState("personal");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>(FALLBACK_AGENTS);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [checks, setChecks] = useState<AgentTestStep[]>([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const desktop = desktopAvailable();
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;

  const project = projects.find((p) => p.id === registeredId) ?? null;
  const nameUsed = !registeredId && projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const canRegister = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;
  const serviceAccounts = accounts.filter((a) => (SERVICES as readonly string[]).includes(a.provider));
  const routed = checks.length > 0 && ["Project file", "HTTP reachable", "Session"].every((s) => checks.find((c) => c.step === s)?.ok);
  const agent = agents.find((a) => a.id === agentId) ?? null;

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
    invoke<DetectedAgent[]>("detect_agents").then((found) => {
      const list = found.filter((a) => a.found).map((a) => ({ id: a.id, name: a.name }));
      if (list.length > 0) setAgents(list);
    }).catch(() => undefined);
  }, [desktop]);

  async function browse() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose the project folder" });
      if (typeof selected === "string" && selected) {
        setPath(selected);
        if (!name.trim()) setName(selected.split(/[\\/]/).filter(Boolean).pop() ?? "");
      }
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

  async function runTest() {
    if (!project) return;
    if (!desktop) { setTestError("Open the desktop app to run the test call."); return; }
    setTesting(true); setTestError(""); setChecks([]);
    try {
      setChecks(await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId: agentId ?? "claude", httpUrl: nexusHttpUrlFor(project.path) }));
    } catch {
      setTestError("Could not run the check. Make sure Nexus is running and the project folder still exists.");
    } finally {
      setTesting(false);
    }
  }

  const otherProject = projects.find((p) => p.id !== registeredId && (p.connections ?? []).length > 0);
  const summaries = [
    project ? project.path : null,
    project && project.connections.length > 0 ? `${project.connections[0].provider} · ${project.connections[0].resource ?? project.connections[0].target}` : null,
    agent ? agent.name : null,
    routed ? "Routed" : null,
  ];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-(--canvas)">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--line) px-6 py-3">
        <img src="/nexus-symbol.png" alt="" width={26} height={26} className="rounded-[8px] bg-[#1a1a1a] p-1" />
        <span className="text-[14px] font-semibold text-(--text)">Set up Nexus</span>
        <span className="text-[12px] text-(--muted)">Step {step + 1} of {STEPS.length}</span>
        <span className="ml-auto flex items-center gap-1"><ThemeButton /><Button size="sm" variant="ghost" onPress={onSkip}>Skip for now</Button></span>
      </header>

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
                <div><h2 className="text-[16px] font-semibold text-(--text)">Register a project</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">A project is a folder you work in. Nexus uses it to know which resources an agent may reach. Nothing secret is stored.</p></div>
                <label className="nx-field">
                  Project folder
                  <span className="flex gap-2">
                    <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Projects/Koupa" disabled={!!registeredId} className={`${inputClass} nx-mono`} />
                    {desktop && !registeredId && <Button size="sm" variant="outline" onPress={() => void browse()}>Browse</Button>}
                  </span>
                </label>
                {existing && !registeredId && name.trim().toLowerCase() !== existing.toLowerCase() && (
                  <p className="flex flex-wrap items-center gap-2 rounded-[10px] bg-(--blue-bg) px-3 py-2 text-[12px] text-(--blue)">
                    This folder already has a Nexus project: <strong className="font-semibold">{existing}</strong>.
                    <Button size="sm" variant="outline" onPress={() => setName(existing)}>Use that name</Button>
                  </p>
                )}
                <label className="nx-field">
                  Project name
                  <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="Koupa" disabled={!!registeredId} className={inputClass} />
                  {nameUsed && <span className="text-[12px] text-(--red)" role="alert">A project with this name already exists.</span>}
                </label>
                {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div><h2 className="text-[16px] font-semibold text-(--text)">Link a service</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Link one login, then bind the exact resource this project uses. Nexus refuses anything else.</p></div>
                <div className="rounded-[12px] border border-(--line) p-3">
                  <span className="nx-eyebrow">1 · Link a login</span>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="nx-field"><span>Service</span>
                      <select className={`${selectClass} !w-auto`} value={service} onChange={(e) => setService(e.target.value as (typeof SERVICES)[number])}>{SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    </label>
                    <label className="nx-field min-w-[120px] flex-1"><span>Account label</span><input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="personal" /></label>
                    <Button size="sm" variant="outline" onPress={() => { onAddAccount({ provider: service, label: label.trim() || "personal" }); setLabel("personal"); }}>Link login</Button>
                  </div>
                  {serviceAccounts.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">{serviceAccounts.map((a) => <li key={a.id} className="nx-badge">{a.provider} · {a.label}</li>)}</ul>
                  )}
                </div>
                <div className="rounded-[12px] border border-(--line) p-3">
                  <span className="nx-eyebrow">2 · Bind a resource</span>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Button size="sm" isDisabled={!project} onPress={() => project && onOpenAddBinding(project.id)}><NxIcon name="plus" size={15} />Add a binding</Button>
                    <span className="min-w-0 flex-1 text-[12px] text-(--muted)">Opens the same dialog as Bindings, including browser approval for Supabase.</span>
                  </div>
                  {project && project.connections.length > 0 && (
                    <ul className="mt-2">{project.connections.map((c) => <li key={c.id} className="flex items-center gap-2 py-1 text-[12.5px]"><NxIcon name="check" size={14} /><span className="text-(--text)">{c.provider}</span><span className="nx-mono text-(--muted)">{c.resource ?? c.target}</span></li>)}</ul>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-3">
                <div><h2 className="text-[16px] font-semibold text-(--text)">Connect an agent</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Point one coding agent at Nexus instead of the provider. {desktop ? "These are the agents found on this machine." : "The desktop app lists the agents it finds."}</p></div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Agent">
                  {agents.map((a) => (
                    <button key={a.id} type="button" role="radio" aria-checked={agentId === a.id} onClick={() => setAgentId(a.id)} className="nx-badge cursor-pointer !px-3.5 !py-2 text-[12.5px]" style={agentId === a.id ? { background: "var(--text)", color: "var(--canvas)" } : undefined}>{a.name}</button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" isDisabled={!project || !agentId} onPress={() => project && onOpenConnectAgent(project.id, agentId)}>{agent ? `Connect ${agent.name}` : "Pick an agent"}</Button>
                  <span className="min-w-0 flex-1 text-[12px] text-(--muted)">Runs its own command or writes the config for you, with a diff and a backup.</span>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-3">
                <div><h2 className="text-[16px] font-semibold text-(--text)">See it work</h2><p className="mt-1 text-[12.5px] leading-[1.55] text-(--muted)">Nexus routes one harmless check the way an agent call would go: {agent?.name ?? "your agent"}, then {project?.name ?? "your project"}, then its service.</p></div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" isDisabled={testing || !project} onPress={() => void runTest()}>{testing ? "Routing…" : checks.length ? "Run it again" : "Run a test call"}</Button>
                  {!desktop && <span className="text-[12px] text-(--muted)">Needs the desktop app.</span>}
                </div>
                {testError && <p className="text-[12px] text-(--red)" role="alert">{testError}</p>}
                {routed && (
                  <>
                    <div className="rounded-[12px] bg-(--green-bg) px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-(--green)">Routed. The call resolved to {project?.connections[0] ? <><span className="nx-mono">{project.connections[0].resource ?? project.connections[0].target}</span> in your {project.connections[0].account ?? project.connections[0].provider} {project.connections[0].provider}</> : `${project?.name}`}.</div>
                    <div className="rounded-[12px] bg-(--raised) px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-(--muted)">
                      {otherProject
                        ? <>Without Nexus, an agent in {project?.name} could have reached {otherProject.name}&apos;s resources. Here that call is refused before it leaves your machine.</>
                        : <>Without Nexus, an agent in {project?.name} could reach any resource your login allows. Here only the one you bound is reachable.</>}
                    </div>
                  </>
                )}
                {checks.length > 0 && (
                  <ul className="rounded-[12px] border border-(--line)">
                    {checks.map((c, i) => (
                      <li key={c.step} className="flex items-start gap-2.5 px-3 py-2" style={i > 0 ? { borderTop: "1px solid var(--line-soft)" } : undefined}>
                        <span className="nx-check mt-0.5" data-state={c.ok ? "done" : "failed"} style={{ width: 18, height: 18 }}><NxIcon name={c.ok ? "check" : "x"} size={11} /></span>
                        <span className="flex min-w-0 flex-1 flex-col"><span className="text-[12.5px] font-medium text-(--text)">{c.step}</span><span className="text-[11.5px] text-(--muted)">{c.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex shrink-0 items-center justify-between gap-2 border-t border-(--line-soft) pt-3">
            <Button size="sm" variant="ghost" isDisabled={step === 0} onPress={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
            {step === 0 && <Button size="sm" isDisabled={!registeredId && !canRegister} onPress={() => void register()}>{registeredId ? "Continue" : "Register project"}</Button>}
            {step === 1 && <Button size="sm" onPress={() => setStep(2)}>{project && project.connections.length > 0 ? "Continue" : "Skip this step"}</Button>}
            {step === 2 && <Button size="sm" onPress={() => setStep(3)}>{agentId ? "Continue" : "Skip this step"}</Button>}
            {step === 3 && <Button size="sm" onPress={onFinish}>{routed ? "Open Home" : "Finish without testing"}</Button>}
          </div>
        </section>

        <section className="nx-card flex min-h-[320px] flex-col" aria-label="Your graph">
          <span className="nx-eyebrow">Your graph · builds as you go</span>
          <Graph project={project} agentName={step >= 2 ? agent?.name ?? null : null} lit={routed} other={routed ? otherProject ?? null : null} />
          <p className="mt-auto pt-4 text-[12px] text-(--muted-2)">Step 1 adds the project, step 2 the service, step 3 the agent. In step 4 the lines light up.</p>
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
    return <div className="flex flex-1 items-center justify-center text-[13px] text-(--muted)">Register a project and it appears here.</div>;
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

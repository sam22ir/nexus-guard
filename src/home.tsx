import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Account, type Project } from "./store";
import { TopologyGraph, agentDisplayName, agentInitials, projectDisplayName, type PendingLinkRequest, type TopologyEnv, type TopologySelection, type TopologySession } from "./topology";
import { ThemeToggle } from "./onboarding";
import { desktopAvailable } from "./vault";

export type HomeNavTarget = "home" | "overview" | "projects" | "agents" | "bindings" | "services" | "guard" | "activity" | "settings";

type HomeAuditEntry = {
  ts?: string | null;
  session?: string | null;
  agent?: string | null;
  project?: string | null;
  project_id?: string | null;
  environment?: string | null;
  provider?: string | null;
  resource?: string | null;
  operation?: string | null;
  decision?: string | null;
  reason?: string | null;
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "unknown time";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ENV_OPTIONS: { value: TopologyEnv; label: string }[] = [
  { value: "all", label: "All envs" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
];

export function HomeView({ projects, accounts, onView, onSelectProject, onOpenOnboarding }: {
  projects: Project[];
  accounts?: Account[];
  onView: (view: HomeNavTarget) => void;
  onSelectProject: (id: string) => void;
  onOpenOnboarding: () => void;
}) {
  const [entries, setEntries] = useState<HomeAuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sessionView, setSessionView] = useState<"topology" | "list">("topology");
  const [env, setEnv] = useState<TopologyEnv>("all");
  const [selectedNode, setSelectedNode] = useState<TopologySelection>(null);
  const [pendingLink, setPendingLink] = useState<PendingLinkRequest | null>(null);

  // Live audit layer: read on mount AND re-poll on an interval so edges,
  // pulses, and badges track Guard decisions without a reload. Same
  // read_audit_log data layer the topology edges are derived from.
  useEffect(() => {
    if (!desktopAvailable()) { setLoaded(true); return; }
    let cancelled = false;
    function load() {
      Promise.allSettled(projects.map((item) => invoke<HomeAuditEntry[]>("read_audit_log", { workspacePath: item.path, limit: 20 })))
        .then((settled) => {
          if (cancelled) return;
          const merged = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
          merged.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
          setEntries(merged);
          setLoaded(true);
        })
        .catch(() => { if (!cancelled) setLoaded(true); });
    }
    load();
    const timer = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projects]);

  // Drop selections that no longer exist (e.g. env filter changed).
  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNode.kind === "project" && !projects.some((project) => project.id === selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [projects, selectedNode]);

  const browserPending = projects.flatMap((item) =>
    (item.connections ?? [])
      .filter((connection) => connection.authState === "pending")
      .map((connection) => ({ project: item, connection })),
  );
  const pendingAuthByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const { project } of browserPending) counts[project.id] = (counts[project.id] ?? 0) + 1;
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);
  const sessions = useMemo<TopologySession[]>(() => {
    const bySession = new Map<string, HomeAuditEntry[]>();
    for (const entry of entries) {
      if (!entry.session) continue;
      const list = bySession.get(entry.session) ?? [];
      list.push(entry);
      bySession.set(entry.session, list);
    }
    return [...bySession.entries()].map(([session, items]) => {
      const sorted = [...items].sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
      const lastEntry = sorted[sorted.length - 1];
      return {
        session,
        agent: [...sorted].reverse().find((i) => i.agent)?.agent ?? null,
        project: lastEntry.project ?? "?",
        environment: lastEntry.environment ?? "?",
        decisions: items.length,
        blocked: items.filter((i) => i.decision !== "allow").length,
        lastTs: lastEntry.ts ?? null,
        lastOperation: lastEntry.operation ?? "?",
        lastDecision: lastEntry.decision ?? null,
      };
    }).sort((a, b) => String(b.lastTs ?? "").localeCompare(String(a.lastTs ?? "")));
  }, [entries]);
  const guardApprovals = [...entries].filter((e) => e.decision === "approval_required").slice(-5).reverse();
  const recent = [...entries].slice(-5).reverse();

  const connectedBindings = projects.reduce((sum, project) => sum + (project.connections ?? []).length, 0);
  const nativeBindings = projects.reduce((sum, project) => sum + (project.connections ?? []).filter((connection) => connection.provider === "Supabase" || connection.provider === "GitHub").length, 0);
  const selectedActivity = recent[0];

  /** Inspector project click focuses the canvas (dims everything else and
   *  opens details) — it does NOT navigate away. The → arrow opens it. */
  function focusProject(id: string) {
    onSelectProject(id);
    setSelectedNode({ kind: "project", id });
  }

  function nodeLabel(sel: Exclude<TopologySelection, null>): string {
    if (sel.kind === "project") return projects.find((project) => project.id === sel.id)?.name ?? "project";
    if (sel.kind === "agent") {
      const session = sessions.find((item) => item.session === sel.id);
      return session ? agentDisplayName(session.agent) : "agent";
    }
    for (const project of projects) {
      const connection = (project.connections ?? []).find((item) => item.id === sel.id);
      if (connection) return `${connection.provider} ${connection.resource ?? connection.target}`;
    }
    return "service";
  }

  function renderNodeDetails(): ReactNode {
    if (!selectedNode) return null;
    if (selectedNode.kind === "project") {
      const project = projects.find((item) => item.id === selectedNode.id);
      if (!project) return null;
      const waiting = entries.filter((entry) =>
        (entry.project_id === project.id || entry.project === project.name) && entry.decision === "approval_required",
      ).length;
      return (
        <div className="flex flex-col gap-2">
          <strong className="text-[13px] font-semibold text-(--text)">{project.name}</strong>
          <p className="font-mono text-[11px] tabular-nums text-(--muted-2)">{project.path}</p>
          <p className="text-[12px] tabular-nums text-(--muted)">
            {project.environment} · {(project.connections ?? []).length} service{(project.connections ?? []).length === 1 ? "" : "s"} · {waiting} waiting
          </p>
          <span className="flex gap-2">
            <button type="button" className="studio-ghost-button" onClick={() => onView("overview")}>Open project</button>
            <button type="button" className="studio-ghost-button" onClick={() => onView("bindings")}>Bindings</button>
          </span>
        </div>
      );
    }
    if (selectedNode.kind === "agent") {
      const session = sessions.find((item) => item.session === selectedNode.id);
      if (!session) return null;
      return (
        <div className="flex flex-col gap-2">
          <strong className="text-[13px] font-semibold text-(--text)">{agentDisplayName(session.agent)}</strong>
          <p className="font-mono text-[11px] tabular-nums text-(--muted-2)">⌀ {session.session.slice(0, 8)}</p>
          <p className="text-[12px] tabular-nums text-(--muted)">
            {projectDisplayName(session.project)} · {session.environment} · {session.decisions} calls · {session.blocked} flagged
          </p>
          <span className="flex gap-2">
            <button type="button" className="studio-ghost-button" onClick={() => onView("activity")}>Activity</button>
          </span>
        </div>
      );
    }
    for (const project of projects) {
      const connection = (project.connections ?? []).find((item) => item.id === selectedNode.id);
      if (connection) {
        return (
          <div className="flex flex-col gap-2">
            <strong className="text-[13px] font-semibold text-(--text)">{connection.provider}</strong>
            <p className="font-mono text-[11px] tabular-nums text-(--muted-2)">{connection.resource ?? connection.target}</p>
            <p className="text-[12px] tabular-nums text-(--muted)">{project.name} · {connection.authState ?? "not connected"}</p>
            <span className="flex gap-2">
              <button type="button" className="studio-ghost-button" onClick={() => { onSelectProject(project.id); onView("bindings"); }}>Bindings</button>
            </span>
          </div>
        );
      }
    }
    return null;
  }

  return (
    <div className="app-view home-view studio-home mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col gap-4 overflow-visible">
      <header className="studio-header">
        <div className="studio-heading">
          <div className="studio-kicker">Nexus control plane <span>·</span> workspace view</div>
          <div className="flex items-center gap-3">
            <h1>Topology</h1>
            <span className="studio-status-pill"><span className="studio-status-dot" /> Local guard online</span>
          </div>
          <p>Every agent, project, and bound service in one calm surface.</p>
        </div>
        <div className="studio-header-actions">
          <ThemeToggle />
          <button type="button" className="studio-ghost-button" onClick={() => onView("activity")}>Activity <span>↗</span></button>
          <button type="button" className="studio-ghost-button" onClick={onOpenOnboarding}>Finish setup</button>
          <button type="button" className="studio-primary-button" onClick={() => onView("agents")}><span>＋</span> Connect agent</button>
        </div>
      </header>

      <section className="studio-workbench" aria-label="Nexus topology workbench">
        <div className="studio-canvas-column">
          <div className="studio-canvas-toolbar">
            <div className="studio-canvas-title">
              <span className="studio-canvas-icon">⌁</span>
              <span><strong>Live topology</strong><small>{loaded ? "Synced from local audit and bindings" : "Reading local state…"}</small></span>
            </div>
            <div className="studio-canvas-tools">
              <button type="button" className="studio-tool-button" aria-label="Undo">↶</button>
              <button type="button" className="studio-tool-button" aria-label="Redo">↷</button>
              <button type="button" className="studio-tool-button" aria-label="Fit topology">⌗</button>
              <button type="button" className="studio-add-button" onClick={() => onView("bindings")}><span>＋</span> Add binding</button>
            </div>
          </div>
          <div className="studio-canvas-meta" style={{ flexWrap: "wrap", rowGap: 8 }}>
            <div className="studio-canvas-tabs" role="group" aria-label="Topology view">
              <button type="button" className={sessionView === "topology" ? "is-active" : ""} onClick={() => setSessionView("topology")}>Topology</button>
              <button type="button" className={sessionView === "list" ? "is-active" : ""} onClick={() => setSessionView("list")}>Sessions</button>
            </div>
            <div className="seg-control" role="group" aria-label="Environment filter">
              {ENV_OPTIONS.map((option) => (
                <button key={option.value} type="button" aria-pressed={env === option.value} onClick={() => setEnv(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="studio-legend"><span><i className="is-green" /> Flowing</span><span><i className="is-amber" /> Review</span><span><i className="is-red" /> Blocked</span><span><i className="is-muted" /> Idle</span></div>
          </div>
          {pendingLink && (
            <div className="mx-4 mt-2 flex shrink-0 flex-wrap items-center gap-2 rounded-[8px] border border-(--line) bg-(--panel) px-3 py-2 text-[12px] text-(--muted)" role="status">
              <span className="min-w-0 flex-1">
                Link requested: <strong className="font-semibold text-(--text)">{nodeLabel(pendingLink.from)} → {nodeLabel(pendingLink.to)}</strong>.
                The canvas never saves — confirm it under Bindings.
              </span>
              <button type="button" className="studio-ghost-button" onClick={() => { setPendingLink(null); onView("bindings"); }}>Open Bindings</button>
              <button type="button" className="studio-ghost-button" onClick={() => setPendingLink(null)} aria-label="Dismiss link request">×</button>
            </div>
          )}
          <div className="studio-canvas-stage">
            {sessionView === "topology" ? (
              <TopologyGraph
                projects={projects}
                sessions={sessions}
                entries={entries}
                accounts={accounts}
                environment={env}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                warningsByProject={pendingAuthByProject}
                detailsSlot={renderNodeDetails()}
                onRequestLink={setPendingLink}
              />
            ) : (
              <div className="studio-session-list" aria-label="Live sessions list">
                {sessions.length === 0 ? <div className="studio-empty-state"><strong>No live sessions</strong><span>Connect an agent and its first call will appear here.</span></div> : sessions.map((session) => (
                  <button key={session.session} type="button" className="studio-session-row" onClick={() => onView("activity")}>
                    <span className="studio-session-avatar">{agentInitials(agentDisplayName(session.agent))}</span>
                    <span><strong>{agentDisplayName(session.agent)}</strong><small>{projectDisplayName(session.project)} · {session.environment}</small></span>
                    <em>{session.decisions} decisions</em><span className="studio-row-arrow">→</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="studio-canvas-footer"><span>Read-only graph · connections are managed from Agents and Bindings</span><span className="studio-zoom-control">− &nbsp; 100% &nbsp; ＋ &nbsp; ⤢</span></div>
        </div>

        <aside className="studio-inspector" aria-label="Topology inspector">
          <div className="studio-inspector-head">
            <div><span className="studio-kicker">Workspace overview</span><h2>Guard state</h2></div>
            <button type="button" className="studio-more-button" aria-label="More options">•••</button>
          </div>
          <div className="studio-inspector-tabs"><button className="is-active" type="button">Overview</button><button type="button" onClick={() => onView("activity")}>Activity</button><button type="button" onClick={() => onView("bindings")}>Bindings</button></div>
          <div className="studio-metric-grid">
            <div><strong>{projects.length}</strong><span>Projects</span></div>
            <div><strong>{connectedBindings}</strong><span>Bindings</span></div>
            <div><strong>{sessions.length}</strong><span>Sessions</span></div>
          </div>
          <div className="studio-inspector-section">
            <div className="studio-section-label"><span>Projects</span><em>{projects.length}</em></div>
            <div className="studio-project-list">
              {projects.map((project) => (
                <div key={project.id} className={`studio-project-row${selectedNode?.kind === "project" && selectedNode.id === project.id ? " is-focused" : ""}`}>
                  <button type="button" className="studio-row-main" onClick={() => focusProject(project.id)} aria-label={`Focus ${project.name} on canvas`}>
                    <span className="studio-project-mark">{project.initials}</span><span><strong>{project.name}</strong><small>{project.environment} · {(project.connections ?? []).length} services</small></span>
                  </button>
                  <button
                    type="button"
                    className="studio-row-open"
                    aria-label={`Open ${project.name}`}
                    onClick={() => { onSelectProject(project.id); onView("overview"); }}
                  >
                    →
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="studio-inspector-section">
            <div className="studio-section-label"><span>Latest signal</span><em>{selectedActivity ? timeAgo(selectedActivity.ts) : "quiet"}</em></div>
            <div className="studio-signal-card">
              <span className="studio-signal-icon">{selectedActivity ? (selectedActivity.decision === "block" ? "!" : "✓") : "·"}</span>
              <span><strong>{selectedActivity ? selectedActivity.operation ?? "Decision" : "No calls yet"}</strong><small>{selectedActivity ? `${projectDisplayName(selectedActivity.project)} · ${selectedActivity.resource ?? selectedActivity.provider ?? "Nexus"}` : "Route an agent through Nexus to see decisions here."}</small></span>
            </div>
          </div>
          <div className="studio-inspector-section studio-inspector-bindings">
            <div className="studio-section-label"><span>Service bindings</span><em>{nativeBindings} native</em></div>
            {(projects[0]?.connections ?? []).slice(0, 4).map((connection) => (
              <div className="studio-binding-row" key={connection.id}><span className="studio-binding-icon">{connection.provider.slice(0, 2).toUpperCase()}</span><span><strong>{connection.provider}</strong><small>{connection.resource ?? connection.target}</small></span><i className={connection.authState === "connected" ? "is-green" : "is-muted"} /></div>
            ))}
          </div>
          {browserPending.length > 0 && <button type="button" className="studio-review-button" onClick={() => onView("bindings")}>{browserPending.length} approval{browserPending.length === 1 ? "" : "s"} waiting <span>→</span></button>}
        </aside>
      </section>

      <div className="studio-bottom-grid">
        <section className="studio-bottom-card"><div className="studio-section-label"><span>Blocked calls</span><button type="button" onClick={() => onView("activity")}>Open activity →</button></div><strong>{guardApprovals.length ? `${guardApprovals.length} blocked decision${guardApprovals.length === 1 ? "" : "s"}` : "Nothing blocked"}</strong><p>{guardApprovals.length ? "Denied calls stay blocked until re-allowed — review them in Activity." : "All clear. New denied calls will land here."}</p></section>
        <section className="studio-bottom-card"><div className="studio-section-label"><span>Recent activity</span><button type="button" onClick={() => onView("activity")}>View all →</button></div><strong>{recent.length ? `${recent.length} recent decisions` : "Quiet"}</strong><p>{recent.length ? "Latest signals are visible in the activity feed." : desktopAvailable() ? "No agent has used Nexus yet." : "Open the desktop app to read local audit logs."}</p></section>
      </div>
    </div>
  );
}

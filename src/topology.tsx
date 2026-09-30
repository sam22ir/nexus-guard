// Home topology view — read-only node-graph reflection of live Nexus state.
//
// Notion §12 ("Home as topology view"): Agents | Projects | Services/Resources
// in columns, edges colored by Guard decision state. Deliberately NOT an
// editor: no node creation, no manual positioning, and the canvas never
// writes — drag-to-link only fires onRequestLink so the parent (App) can
// confirm through the existing Services/Agents forms. All persisted
// connections still happen through those tab forms.
// Positions are deterministic auto-layout from live counts (see COL_X /
// ROW_SLOT below) — nodes re-arrange themselves as sessions connect and
// disconnect, with no user dragging involved.
//
// Visual system: src/theme.css tokens only (var() — never hardcoded hex,
// so dark/light follow automatically). Nodes are neutral panel cards with
// tinted icon squares; status lives on EDGES and BADGES only (§11).
// Edge semantics: flowing var(--green), warned var(--orange), blocked
// var(--red). Idle (no traffic yet) uses var(--line) — honest "no data",
// not a new color. Flowing edges pulse via .topo-flow (stroke-dashoffset,
// prefers-reduced-motion safe).
//
// Data gaps, flagged explicitly rather than stubbed (see the <details>
// footnote rendered under the canvas too):
//  1. Agent names are client-declared in the MCP handshake (display only).
//     Log lines written before the backend recorded that field show
//     "Unknown agent" with their session id.
//  2. There is no live per-edge Guard subscription. Edge state is derived
//     from the same polled audit-log data layer Home already uses
//     (read_audit_log per project on interval), windowed to recent entries.
//     A streaming Guard-event feed would make "currently blocked" exact.
//  3. Agent presence ("Active"/"Idle") is recency of last audit entry,
//     not a live connection-status API — same polling limitation as (2).
// Over HTTP, one agent (MCP) session keeps one Nexus audit session across
// its requests (stateful sessions in mcp/nexus-http-server.mjs); without
// that, every call would log a fresh random session and per-agent grouping
// would be meaningless.

import { useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { accountLabelForConnection, tierForProvider, type Account, type Connection, type Project } from "./store";

export type TopologySession = {
  session: string;
  /** Agent tool name declared in the MCP handshake (null for pre-identity log lines). */
  agent: string | null;
  project: string;
  environment: string;
  decisions: number;
  blocked: number;
  lastTs: string | null;
  lastOperation: string;
  lastDecision?: string | null;
};

export type TopologyEntry = {
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
};

export type EdgeState = "flowing" | "warned" | "blocked" | "idle";

/** Environment filter for the canvas. "all" shows every column unfiltered. */
export type TopologyEnv = "production" | "staging" | "development" | "all";

/** Selected node on the canvas. Selection dims everything unrelated
 *  (focus-dim) and lets the parent render details in its side panel. */
export type TopologySelection =
  | { kind: "agent"; id: string }
  | { kind: "project"; id: string }
  | { kind: "service"; id: string }
  | null;

/** Drag-to-link request. The canvas never writes: dropping a node on
 *  another node only fires onRequestLink — the parent confirms through
 *  the existing connection forms before anything is persisted. */
export type PendingLinkRequest = {
  from: Exclude<TopologySelection, null>;
  to: Exclude<TopologySelection, null>;
};

/** §11 semantic tokens as var() refs — same meaning in both themes.
 *  Idle reuses the hairline token. */
export const EDGE_STROKE: Record<EdgeState, string> = {
  flowing: "var(--green)",
  warned: "var(--orange)",
  blocked: "var(--red)",
  idle: "var(--line)",
};

const EDGE_LABEL: Record<EdgeState, string> = {
  flowing: "Flowing",
  warned: "Warned / awaiting approval",
  blocked: "Blocked",
  idle: "No traffic yet",
};

/** Pretty names for known agent tools. Unknown declared names pass through
 *  raw (honest: the name is client-declared in the MCP handshake, display only).
 *  Missing (pre-identity log lines) is stated plainly, never a bare "?". */
const KNOWN_AGENTS: Record<string, string> = {
  "claude-code": "Claude Code",
  claude: "Claude Code",
  codex: "Codex",
  "codex-cli": "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  cursor: "Cursor",
  windsurf: "Windsurf",
};

export function agentDisplayName(raw?: string | null): string {
  if (raw == null || !raw.trim()) return "Unknown agent";
  const key = raw.trim().toLowerCase();
  return KNOWN_AGENTS[key] ?? raw.trim();
}

export function agentInitials(display: string): string {
  const letters = display.split(/[\s_-]+/).map((part) => part[0]).join("").slice(0, 2);
  return (letters || "AG").toUpperCase();
}

/** A session whose project never resolved states that plainly — never "?". */
export function projectDisplayName(raw?: string | null): string {
  if (raw == null || !raw.trim() || raw.trim() === "?") return "Unresolved project";
  return raw;
}

/** Mirrors home.tsx timeAgo (duplicated to keep the home → topology import one-directional). */
function timeAgoShort(iso?: string | null): string {
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

/** Session health from its latest verdict; older flags keep the edge amber ("recently warned"). */
export function sessionEdgeState(session: TopologySession): EdgeState {
  if (session.lastDecision === "block") return "blocked";
  if (session.lastDecision === "approval_required" || session.lastDecision === "pending") return "warned";
  if (session.blocked > 0) return "warned";
  return "flowing";
}

/**
 * Project → service edge health from recent audit entries for that binding.
 * Windowed to the last 5 matching entries so a red edge clears as new
 * allowed traffic arrives. No matching entries → "idle" (gray, honest).
 */
export function serviceEdgeState(project: Project, connection: Connection, entries: TopologyEntry[]): EdgeState {
  const resource = connection.resource ?? connection.target;
  const matching = entries.filter((entry) => {
    const sameProject = entry.project === project.name || (entry.project_id != null && entry.project_id === project.id);
    if (!sameProject) return false;
    if (!entry.provider || entry.provider.toLowerCase() !== connection.provider.toLowerCase()) return false;
    if (entry.resource != null && entry.resource !== "" && entry.resource !== resource && entry.resource !== connection.target) return false;
    return true;
  });
  const recent = matching.slice(-5);
  if (recent.length === 0) return "idle";
  if (recent.some((entry) => entry.decision === "block")) return "blocked";
  if (recent.some((entry) => entry.decision === "approval_required" || entry.decision === "pending")) return "warned";
  return "flowing";
}

/** Tier badge colors — same mapping ServicesView uses (native green,
 *  curated blue, self-added amber). Badges may carry status; node cards
 *  themselves stay neutral. */
function tierBadge(tier: string): { background: string; color: string } {
  if (tier === "native") return { background: "var(--green-bg)", color: "var(--green)" };
  if (tier === "curated") return { background: "var(--blue-bg)", color: "var(--blue)" };
  return { background: "var(--orange-bg)", color: "var(--orange)" };
}

// Deterministic auto-layout: three fixed columns, one slot per row.
// Column heights re-center as counts change; no manual positions stored.
const NODE_W = 210;
const AGENT_H = 108;
const PROJECT_H = 112;
const SERVICE_H = 120;
const COL_X = [18, 242, 466] as const;
const CANVAS_W = 694;
const ROW_SLOT = 150;
const TOP_PAD = 16;
const MAX_AGENTS = 8;
const MAX_SERVICES = 12;

type PlacedEdge = { id: string; d: string; x2: number; y2: number; state: EdgeState };

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

function envMatches(value: string | undefined | null, env: TopologyEnv): boolean {
  if (env === "all") return true;
  return (value ?? "").toLowerCase() === env;
}

export function TopologyGraph({ projects, sessions, entries, accounts, environment = "all", selectedNode = null, onSelectNode, warningsByProject, detailsSlot, onRequestLink }: {
  projects: Project[];
  sessions: TopologySession[];
  entries: TopologyEntry[];
  accounts?: Account[];
  /** Canvas environment filter (production|staging|development|all). */
  environment?: TopologyEnv;
  /** Focused node: everything unrelated dims. Null = no focus. */
  selectedNode?: TopologySelection;
  onSelectNode?: (selection: TopologySelection) => void;
  /** Extra per-project warning counts the parent knows about (merged with
   *  pending approvals derived from entries). Rendered as a badge dot —
   *  node cards themselves stay neutral. */
  warningsByProject?: Record<string, number>;
  /** Side-panel details slot: rendered as a dismissible overlay docked to
   *  the canvas when a node is selected. The parent owns its content. */
  detailsSlot?: ReactNode;
  /** Drag-to-link callback. The canvas never writes — the parent confirms
   *  through the existing connection forms. */
  onRequestLink?: (request: PendingLinkRequest) => void;
}) {
  const [dragSource, setDragSource] = useState<Exclude<TopologySelection, null> | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const visibleProjects = useMemo(
    () => projects.filter((project) => envMatches(project.environment, environment)),
    [projects, environment],
  );
  const visibleSessions = useMemo(
    () => sessions.filter((session) => envMatches(session.environment, environment)),
    [sessions, environment],
  );
  const agents = useMemo(() => visibleSessions.slice(0, MAX_AGENTS), [visibleSessions]);
  const serviceBindings = useMemo(
    () => visibleProjects.flatMap((project) =>
      (project.connections ?? [])
        .filter((connection) => envMatches(connection.environment ?? project.environment, environment))
        .map((connection) => ({ project, connection }))),
    [visibleProjects, environment],
  );
  const services = useMemo(() => serviceBindings.slice(0, MAX_SERVICES), [serviceBindings]);

  const pendingByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.decision !== "approval_required") continue;
      const key = entry.project_id ?? entry.project ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const pendingFor = (project: Project): number =>
    (pendingByProject.get(project.id) ?? 0) + (pendingByProject.get(project.name) ?? 0) + (warningsByProject?.[project.id] ?? 0);

  const blockedProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { project, connection } of serviceBindings) {
      if (serviceEdgeState(project, connection, entries) === "blocked") ids.add(project.id);
    }
    for (const agent of visibleSessions) {
      if (sessionEdgeState(agent) !== "blocked") continue;
      const match = visibleProjects.find((project) => project.name === agent.project);
      if (match) ids.add(match.id);
    }
    return ids;
  }, [serviceBindings, visibleSessions, visibleProjects, entries]);

  const maxRows = Math.max(agents.length || 1, visibleProjects.length || 1, services.length || 1);
  const canvasH = Math.max(340, maxRows * ROW_SLOT + TOP_PAD * 2);

  function colY(count: number, index: number, nodeH: number): number {
    const colH = Math.max(count, 1) * ROW_SLOT;
    const top = TOP_PAD + (canvasH - TOP_PAD * 2 - colH) / 2;
    return top + index * ROW_SLOT + (ROW_SLOT - nodeH) / 2;
  }

  const agentPos = agents.map((_, i) => ({ x: COL_X[0], y: colY(agents.length, i, AGENT_H) }));
  const projectPos = visibleProjects.map((_, i) => ({ x: COL_X[1], y: colY(visibleProjects.length, i, PROJECT_H) }));
  const servicePos = services.map((_, i) => ({ x: COL_X[2], y: colY(services.length, i, SERVICE_H) }));

  const projectIndex = new Map(visibleProjects.map((project, i) => [project.id, i]));
  const projectIndexByName = new Map(visibleProjects.map((project, i) => [project.name, i]));

  /** Project id that "owns" a node, used for focus-dim neighborhood. */
  function ownerProjectId(sel: Exclude<TopologySelection, null>): string | null {
    if (sel.kind === "project") return sel.id;
    if (sel.kind === "agent") {
      const agent = visibleSessions.find((session) => session.session === sel.id);
      if (!agent) return null;
      return visibleProjects.find((project) => project.name === agent.project)?.id ?? null;
    }
    const binding = serviceBindings.find(({ connection }) => connection.id === sel.id);
    return binding?.project.id ?? null;
  }

  const focusOwner = selectedNode ? ownerProjectId(selectedNode) : null;

  function isDimmed(kind: "agent" | "project" | "service", id: string): boolean {
    if (!selectedNode || !focusOwner) return false;
    if (selectedNode.kind === kind && selectedNode.id === id) return false;
    return ownerProjectId({ kind, id } as Exclude<TopologySelection, null>) !== focusOwner;
  }

  function toggleSelect(sel: Exclude<TopologySelection, null>) {
    if (!onSelectNode) return;
    onSelectNode(selectedNode?.kind === sel.kind && selectedNode.id === sel.id ? null : sel);
  }

  function handleKey(sel: Exclude<TopologySelection, null>, event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleSelect(sel);
    }
  }

  // --- Drag-to-link (request only; the parent confirms before persisting) ---
  function dragKey(sel: Exclude<TopologySelection, null>): string {
    return `${sel.kind}:${sel.id}`;
  }

  function onDragStart(sel: Exclude<TopologySelection, null>, event: DragEvent) {
    event.dataTransfer.setData("application/x-nexus-node", JSON.stringify(sel));
    event.dataTransfer.effectAllowed = "link";
    setDragSource(sel);
  }

  function onDragOver(sel: Exclude<TopologySelection, null>, event: DragEvent) {
    if (!dragSource || !onRequestLink) return;
    if (dragSource.kind === sel.kind && dragSource.id === sel.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "link";
    setDropTarget(dragKey(sel));
  }

  function onDrop(sel: Exclude<TopologySelection, null>, event: DragEvent) {
    event.preventDefault();
    setDropTarget(null);
    if (!dragSource || !onRequestLink) {
      setDragSource(null);
      return;
    }
    if (dragSource.kind === sel.kind && dragSource.id === sel.id) {
      setDragSource(null);
      return;
    }
    onRequestLink({ from: dragSource, to: sel });
    setDragSource(null);
  }

  function onDragEnd() {
    setDragSource(null);
    setDropTarget(null);
  }

  const edges = useMemo<PlacedEdge[]>(() => {
    const list: PlacedEdge[] = [];
    agents.forEach((agent, i) => {
      const target = projectIndexByName.get(agent.project);
      if (target == null) return;
      const state = sessionEdgeState(agent);
      const x1 = agentPos[i].x + NODE_W;
      const y1 = agentPos[i].y + AGENT_H / 2;
      const x2 = projectPos[target].x;
      const y2 = projectPos[target].y + PROJECT_H / 2;
      list.push({ id: `agent-${agent.session}`, d: edgePath(x1, y1, x2, y2), x2, y2, state });
    });
    services.forEach(({ project, connection }, i) => {
      const source = projectIndex.get(project.id);
      if (source == null) return;
      const state = serviceEdgeState(project, connection, entries);
      const x1 = projectPos[source].x + NODE_W;
      const y1 = projectPos[source].y + PROJECT_H / 2;
      const x2 = servicePos[i].x;
      const y2 = servicePos[i].y + SERVICE_H / 2;
      list.push({ id: `svc-${connection.id}`, d: edgePath(x1, y1, x2, y2), x2, y2, state });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, services, entries, visibleProjects, canvasH]);

  const envSuffix = environment === "all" ? "" : ` · ${environment}`;
  const summary = `${agents.length} live session${agents.length === 1 ? "" : "s"}, ${visibleProjects.length} project${visibleProjects.length === 1 ? "" : "s"}, ${serviceBindings.length} service binding${serviceBindings.length === 1 ? "" : "s"}${envSuffix}`;

  return (
    <div className="topology-view flex min-h-0 flex-1 flex-col overflow-visible">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Edge legend">
        {(Object.keys(EDGE_STROKE) as EdgeState[]).map((state) => (
          <span key={state} className="flex items-center gap-1.5 text-[12px] text-(--muted)">
            <span aria-hidden="true" style={{ display: "inline-block", width: 16, height: 2, borderRadius: 2, background: EDGE_STROKE[state] }} />
            {EDGE_LABEL[state]}
          </span>
        ))}
        <span className="ml-auto text-[12px] tabular-nums text-(--muted-2)">{summary}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-(--line) bg-(--canvas)">
        <div className="relative mx-auto" style={{ width: CANVAS_W, height: canvasH, backgroundImage: "radial-gradient(var(--line-soft) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex" aria-hidden="true" style={{ padding: "0 16px" }}>
            {["Agents", "Projects", "Services / resources"].map((label, i) => (
              <span key={label} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--muted-2)" style={{ width: NODE_W, marginLeft: i === 0 ? 0 : 40, paddingTop: 2 }}>{label}</span>
            ))}
          </div>

          <svg width={CANVAS_W} height={canvasH} role="img" aria-label={`Topology graph: ${summary}. Edges colored by Guard state.`} style={{ position: "absolute", inset: 0 }}>
            {edges.map((edge) => (
              <g key={edge.id}>
                <path
                  d={edge.d}
                  fill="none"
                  stroke={EDGE_STROKE[edge.state]}
                  strokeWidth={edge.state === "idle" ? 1 : 1.5}
                  strokeLinecap="round"
                  opacity={edge.state === "idle" ? 0.8 : 1}
                  className={edge.state === "flowing" ? "topo-flow" : undefined}
                />
                <circle cx={edge.x2} cy={edge.y2} r={3.5} fill="var(--canvas)" stroke={EDGE_STROKE[edge.state]} strokeWidth={1.5} />
              </g>
            ))}
          </svg>

          {selectedNode && detailsSlot != null && (
            <div
              className="absolute z-10 max-h-[70%] w-[240px] overflow-y-auto rounded-[10px] border border-(--line) bg-(--panel) p-3"
              style={{ right: 12, top: 24 }}
              role="complementary"
              aria-label="Selected node details"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-(--muted-2)">Details</span>
                <button
                  type="button"
                  onClick={() => onSelectNode?.(null)}
                  aria-label="Clear selection"
                  className="rounded-[6px] px-1.5 py-0.5 text-[14px] leading-none text-(--muted) hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
                >
                  ×
                </button>
              </div>
              {detailsSlot}
            </div>
          )}

          {agents.length === 0 && (
            <article className="absolute rounded-[10px] border border-dashed border-(--line) bg-(--panel) p-3" style={{ left: COL_X[0], top: colY(1, 0, AGENT_H), width: NODE_W, height: AGENT_H }} aria-label="No live sessions">
              <p className="text-[13px] font-semibold text-(--text)">No live sessions</p>
              <p className="mt-1 text-[12px] leading-[1.5] text-(--muted)">Agents appear here the moment one calls through Nexus.</p>
            </article>
          )}
          {agents.map((agent, i) => {
            const active = agent.lastTs != null && Date.now() - new Date(agent.lastTs).getTime() < 10 * 60 * 1000;
            const name = agentDisplayName(agent.agent);
            const sel = { kind: "agent", id: agent.session } as const;
            const dimmed = isDimmed(sel.kind, sel.id);
            return (
              <article
                key={agent.session}
                title={`Session ${agent.session}`}
                className={`topo-node absolute rounded-[10px] border border-(--line) bg-(--panel) p-3${dimmed ? " topo-dim" : ""}${dropTarget === dragKey(sel) ? " topo-drop-target" : ""}`}
                style={{ left: agentPos[i].x, top: agentPos[i].y, width: NODE_W, height: AGENT_H }}
                aria-label={`${name} bound to ${projectDisplayName(agent.project)}`}
                tabIndex={onSelectNode ? 0 : undefined}
                role={onSelectNode ? "button" : undefined}
                aria-pressed={onSelectNode ? selectedNode?.kind === "agent" && selectedNode.id === agent.session : undefined}
                onClick={onSelectNode ? () => toggleSelect(sel) : undefined}
                onKeyDown={onSelectNode ? (event) => handleKey(sel, event) : undefined}
                draggable={!!onRequestLink}
                onDragStart={onRequestLink ? (event) => onDragStart(sel, event) : undefined}
                onDragOver={onRequestLink ? (event) => onDragOver(sel, event) : undefined}
                onDragLeave={onDragEnd}
                onDrop={onRequestLink ? (event) => onDrop(sel, event) : undefined}
                onDragEnd={onDragEnd}
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-(--raised) text-[10px] font-semibold text-(--text)" aria-hidden="true">
                    {agentInitials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-(--text)">{name}</strong>
                    <small className="text-[12px] text-(--muted)">{active ? "Active" : "Idle"}</small>
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[12px] tabular-nums text-(--muted)">
                  {projectDisplayName(agent.project)} · {agent.environment}
                </p>
                <p className="truncate font-mono text-[11px] tabular-nums text-(--muted-2)" title={`Session ${agent.session}`}>
                  ⌀ {agent.session.slice(0, 8)} · {agent.decisions} call{agent.decisions === 1 ? "" : "s"} · {agent.blocked} flagged · {agent.lastOperation} · {timeAgoShort(agent.lastTs)}
                </p>
              </article>
            );
          })}

          {visibleProjects.map((project, i) => {
            const warnings = pendingFor(project);
            const blocked = blockedProjectIds.has(project.id);
            const sel = { kind: "project", id: project.id } as const;
            const dimmed = isDimmed(sel.kind, sel.id);
            return (
              <article
                key={project.id}
                className={`topo-node absolute rounded-[10px] border border-(--line) bg-(--panel) p-3${dimmed ? " topo-dim" : ""}${dropTarget === dragKey(sel) ? " topo-drop-target" : ""}`}
                style={{ left: projectPos[i].x, top: projectPos[i].y, width: NODE_W, height: PROJECT_H }}
                aria-label={`Project ${project.name}, ${project.environment}`}
                tabIndex={onSelectNode ? 0 : undefined}
                role={onSelectNode ? "button" : undefined}
                aria-pressed={onSelectNode ? selectedNode?.kind === "project" && selectedNode.id === project.id : undefined}
                onClick={onSelectNode ? () => toggleSelect(sel) : undefined}
                onKeyDown={onSelectNode ? (event) => handleKey(sel, event) : undefined}
                draggable={!!onRequestLink}
                onDragStart={onRequestLink ? (event) => onDragStart(sel, event) : undefined}
                onDragOver={onRequestLink ? (event) => onDragOver(sel, event) : undefined}
                onDragLeave={onDragEnd}
                onDrop={onRequestLink ? (event) => onDrop(sel, event) : undefined}
                onDragEnd={onDragEnd}
              >
                {warnings > 0 && (
                  <span className={`topo-warn-dot${blocked ? " is-blocked" : ""}`} title={`${warnings} waiting · ${blocked ? "blocked traffic" : "awaiting review"}`}>
                    {warnings > 9 ? "9+" : warnings}
                  </span>
                )}
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-(--raised) text-[10px] font-semibold text-(--text)" aria-hidden="true">{project.initials}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-(--text)">{project.name}</strong>
                  </span>
                  <span className="shrink-0 rounded-full bg-(--raised) px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em] text-(--muted)">{project.environment}</span>
                </div>
                <p className="mt-2 text-[12px] tabular-nums text-(--muted)">
                  {(project.connections ?? []).length} service{(project.connections ?? []).length === 1 ? "" : "s"} · {warnings} waiting
                </p>
                <p className="truncate font-mono text-[11px] tabular-nums text-(--muted-2)">{project.path}</p>
              </article>
            );
          })}

          {services.map(({ project, connection }, i) => {
            const tier = tierForProvider(connection.provider);
            const accountLabel = accountLabelForConnection(connection, accounts) ?? "—";
            const resource = connection.resource ?? connection.target;
            const sel = { kind: "service", id: connection.id } as const;
            const dimmed = isDimmed(sel.kind, sel.id);
            return (
              <article
                key={connection.id}
                className={`topo-node absolute rounded-[10px] border border-(--line) bg-(--panel) p-3${dimmed ? " topo-dim" : ""}${dropTarget === dragKey(sel) ? " topo-drop-target" : ""}`}
                style={{ left: servicePos[i].x, top: servicePos[i].y, width: NODE_W, height: SERVICE_H }}
                aria-label={`${connection.provider} ${resource} for ${project.name}`}
                tabIndex={onSelectNode ? 0 : undefined}
                role={onSelectNode ? "button" : undefined}
                aria-pressed={onSelectNode ? selectedNode?.kind === "service" && selectedNode.id === connection.id : undefined}
                onClick={onSelectNode ? () => toggleSelect(sel) : undefined}
                onKeyDown={onSelectNode ? (event) => handleKey(sel, event) : undefined}
                draggable={!!onRequestLink}
                onDragStart={onRequestLink ? (event) => onDragStart(sel, event) : undefined}
                onDragOver={onRequestLink ? (event) => onDragOver(sel, event) : undefined}
                onDragLeave={onDragEnd}
                onDrop={onRequestLink ? (event) => onDrop(sel, event) : undefined}
                onDragEnd={onDragEnd}
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-(--raised) text-[10px] font-semibold text-(--text)" aria-hidden="true">
                    {connection.provider.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-(--text)">{connection.provider}</strong>
                    <small className="block truncate text-[12px] tabular-nums text-(--muted)">account: {accountLabel ?? "Not linked"}</small>
                  </span>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={tierBadge(tier)}>{tier === "self-added" ? "self-added" : tier}</span>
                </div>
                <p className="mt-2 truncate text-[13px] font-medium tabular-nums text-(--text)">{resource}</p>
                <p className="truncate text-[12px] tabular-nums text-(--muted-2)">{project.name}{connection.environment ? ` · ${connection.environment}` : ""}</p>
              </article>
            );
          })}
        </div>
      </div>

      {(visibleSessions.length > MAX_AGENTS || serviceBindings.length > MAX_SERVICES) && (
        <p className="mt-2 text-[12px] tabular-nums text-(--muted-2)">
          Showing {agents.length} of {visibleSessions.length} sessions and {services.length} of {serviceBindings.length} bindings — the busiest surface stays readable; the full lists live under Activity and Bindings.
        </p>
      )}

      <p className="mt-2 shrink-0 text-[12px] leading-[1.6] text-(--muted-2)">
        Read-only: this graph reflects bindings plus recent decisions. Make connections in the Services and Agents tabs — never by drawing on this canvas.
      </p>
      <details className="mt-2 max-h-[160px] shrink-0 overflow-y-auto rounded-[8px] border border-(--line) bg-(--panel) px-3 py-2 text-[12px] leading-[1.6] text-(--muted)">
        <summary className="cursor-pointer font-medium text-(--text)">What this view still needs from the data model</summary>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
          <li>Agent names come from the name each agent declares in its MCP handshake (display only — a client can declare anything). Log lines written before that field existed show “Unknown agent” with their session id.</li>
          <li>Live edge state: edges are derived from the polled audit log (same data layer as the list below), not a live event feed. A streaming feed would make “currently blocked” exact.</li>
          <li>Presence: “Active / Idle” is recency of the last audit entry, not a live connection-status API.</li>
        </ul>
      </details>
    </div>
  );
}

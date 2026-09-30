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

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { PROVIDER_CATALOG, accountLabelForConnection, tierForProvider, type Account, type Connection, type Project } from "./store";
import { Button } from "@heroui/react";
import { Icon, type IconName } from "./ui";
import { useCanvasCamera } from "./useCanvasCamera";

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
  idle: "var(--muted-2)",
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

/** Category drives the tinted icon square (paper §11): never status colors. */
function categoryTile(provider: string): { icon: IconName; tone: "info" | "violet" | "neutral" } {
  const tags = PROVIDER_CATALOG.find((entry) => entry.provider.toLowerCase() === provider.toLowerCase())?.tags ?? [];
  const has = (...names: string[]) => tags.some((tag) => names.includes(tag));
  if (has("Database", "Storage", "Vectors")) return { icon: "database", tone: "info" };
  if (has("Auth", "Identity", "AI")) return { icon: "key", tone: "violet" };
  if (has("Source control", "CI")) return { icon: "branch", tone: "neutral" };
  if (has("Payments")) return { icon: "shield", tone: "neutral" };
  return { icon: "services", tone: "neutral" };
}


// Deterministic auto-layout: three fixed columns, one slot per row.
// Column heights re-center as counts change; no manual positions stored.
const NODE_W = 240;
const AGENT_H = 108;
const PROJECT_H = 112;
const SERVICE_H = 120;
const COL_X = [18, 314, 610] as const;
const CANVAS_W = 868;
const ZOOM_MIN = 0.35;
const READABLE_MIN = 0.6;
const ZOOM_MAX = 2.2;
const ROW_SLOT = 150;
const TOP_PAD = 16;
const MAX_AGENTS = 8;
const MAX_SERVICES = 12;

type PlacedEdge = { id: string; d: string; x2: number; y2: number; mx: number; my: number; state: EdgeState; label: string };

function project_label(project: Project): string {
  return project.name;
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

function envMatches(value: string | undefined | null, env: TopologyEnv): boolean {
  if (env === "all") return true;
  return (value ?? "").toLowerCase() === env;
}

export function TopologyGraph({ projects, sessions, entries, accounts, environment = "all", selectedNode = null, onSelectNode, warningsByProject, detailsSlot, onRequestLink, selectedEdge = null, onSelectEdge, sharedConnectionIds, insetTop = 0, insetRight = 0 }: {
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
  /** Connection id of the selected link line; selecting one only opens the
   *  parent's confirm step — the canvas never removes anything itself. */
  selectedEdge?: string | null;
  onSelectEdge?: (connectionId: string | null) => void;
  /** Connections whose account is also bound to another project (paper §6). */
  sharedConnectionIds?: Set<string>;
  /** Space covered by floating UI, so "fit" centers in the visible area. */
  insetTop?: number;
  insetRight?: number;
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

  // --- Camera: zoom/pan over the fixed-column layout (see useCanvasCamera). ---
  const camera = useCanvasCamera({
    contentW: CANVAS_W,
    contentH: canvasH,
    insetTop,
    insetRight,
    minZoom: ZOOM_MIN,
    maxZoom: ZOOM_MAX,
    readableMin: READABLE_MIN,
    onEmptyClick: () => { onSelectNode?.(null); onSelectEdge?.(null); },
  });
  const { cam, vp, viewportRef, flyTo } = camera;
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // --- Navigation: fly-to, neighborhood focus, search, minimap. ---
  type NodeRect = { x: number; y: number; w: number; h: number; label: string; kind: "agent" | "project" | "service"; id: string };
  const rects: NodeRect[] = [
    ...agents.map((agent, i) => ({ ...agentPos[i], w: NODE_W, h: AGENT_H, label: agentDisplayName(agent.agent), kind: "agent" as const, id: agent.session })),
    ...visibleProjects.map((project, i) => ({ ...projectPos[i], w: NODE_W, h: PROJECT_H, label: project.name, kind: "project" as const, id: project.id })),
    ...services.map(({ connection }, i) => ({ ...servicePos[i], w: NODE_W, h: SERVICE_H, label: `${connection.provider} ${connection.resource ?? connection.target}`, kind: "service" as const, id: connection.id })),
  ];

  function flyToNode(sel: Exclude<TopologySelection, null>) {
    const owner = ownerProjectId(sel);
    const group = owner ? rects.filter((rect) => ownerProjectId({ kind: rect.kind, id: rect.id } as Exclude<TopologySelection, null>) === owner) : rects.filter((rect) => rect.kind === sel.kind && rect.id === sel.id);
    if (group.length === 0) return;
    const x1 = Math.min(...group.map((rect) => rect.x));
    const y1 = Math.min(...group.map((rect) => rect.y));
    const x2 = Math.max(...group.map((rect) => rect.x + rect.w));
    const y2 = Math.max(...group.map((rect) => rect.y + rect.h));
    flyTo({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }

  // Selecting a project (canvas or panel) moves the camera to its neighborhood.
  const lastFlown = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedNode?.kind === "project" ? selectedNode.id : null;
    if (key && key !== lastFlown.current) flyToNode(selectedNode as Exclude<TopologySelection, null>);
    lastFlown.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.kind, selectedNode?.id]);

  const matches = query.trim()
    ? rects.filter((rect) => rect.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6)
    : [];

  function jumpTo(rect: NodeRect) {
    const sel = { kind: rect.kind, id: rect.id } as Exclude<TopologySelection, null>;
    onSelectNode?.(sel);
    if (rect.kind !== "project") flyTo(rect, 1.2);
    setQuery("");
    searchRef.current?.blur();
  }

  const MM_W = 176;
  const MM_H = 112;
  const mmScale = Math.min((MM_W - 12) / CANVAS_W, (MM_H - 12) / canvasH);
  function minimapMove(event: ReactPointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const cx = (event.clientX - box.left - 6) / mmScale;
    const cy = (event.clientY - box.top - 6) / mmScale;
    camera.centerOn(cx, cy);
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
      list.push({ id: `agent-${agent.session}`, d: edgePath(x1, y1, x2, y2), x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, state, label: `${agentDisplayName(agent.agent)} → ${project_label(visibleProjects[target])}` });
    });
    services.forEach(({ project, connection }, i) => {
      const source = projectIndex.get(project.id);
      if (source == null) return;
      const state = serviceEdgeState(project, connection, entries);
      const x1 = projectPos[source].x + NODE_W;
      const y1 = projectPos[source].y + PROJECT_H / 2;
      const x2 = servicePos[i].x;
      const y2 = servicePos[i].y + SERVICE_H / 2;
      list.push({ id: `svc-${connection.id}`, d: edgePath(x1, y1, x2, y2), x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, state, label: `${project.name} → ${connection.provider} ${connection.resource ?? connection.target}` });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, services, entries, visibleProjects, canvasH]);

  const envSuffix = environment === "all" ? "" : ` · ${environment}`;
  const summary = `${agents.length} live session${agents.length === 1 ? "" : "s"}, ${visibleProjects.length} project${visibleProjects.length === 1 ? "" : "s"}, ${serviceBindings.length} service binding${serviceBindings.length === 1 ? "" : "s"}${envSuffix}`;

  return (
    <div
      ref={viewportRef}
      className="topology-view relative h-full w-full overflow-hidden bg-(--canvas) outline-none"
      tabIndex={0}
      aria-label="Topology canvas. Scroll or pinch to zoom, drag to pan, plus and minus to zoom, zero to reset."
      {...camera.bind}
      style={{
        ...camera.bind.style,
        backgroundImage: "radial-gradient(var(--line-soft) 1px, transparent 1px)",
        backgroundSize: `${22 * cam.z}px ${22 * cam.z}px`,
        backgroundPosition: `${cam.x}px ${cam.y}px`,
      }}
    >
        <div className="absolute left-0 top-0" style={{ width: CANVAS_W, height: canvasH, transformOrigin: "0 0", transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` , willChange: "transform" }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex" aria-hidden="true" style={{ padding: "0 16px" }}>
            {["Agents", "Projects", "Services / resources"].map((label, i) => (
              <span key={label} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--muted-2)" style={{ width: NODE_W, marginLeft: i === 0 ? 0 : 56, paddingTop: 2 }}>{label}</span>
            ))}
          </div>

          <svg width={CANVAS_W} height={canvasH} role="group" aria-label={`Topology graph: ${summary}. Lines colored by routing state.`} style={{ position: "absolute", inset: 0 }}>
            {edges.map((edge) => {
              const connectionId = edge.id.startsWith("svc-") ? edge.id.slice(4) : null;
              const picked = connectionId != null && selectedEdge === connectionId;
              return (
                <g key={edge.id}>
                  <path
                    d={edge.d}
                    fill="none"
                    stroke={EDGE_STROKE[edge.state]}
                    strokeWidth={picked ? 3 : 1.5}
                    strokeLinecap="round"
                    opacity={edge.state === "idle" && !picked ? 0.55 : 1}
                    className={edge.state === "flowing" ? "topo-flow" : undefined}
                  >
                    <title>{`${EDGE_LABEL[edge.state]} · ${edge.label}`}</title>
                  </path>
                  {edge.state === "flowing" && (
                    <circle r={3} fill="var(--green)" style={{ pointerEvents: "none" }}>
                      <animateMotion dur="2.6s" repeatCount="indefinite" path={edge.d} />
                    </circle>
                  )}
                  {(edge.state === "blocked" || edge.state === "warned") && (
                    <g style={{ pointerEvents: "none" }} transform={`translate(${edge.mx} ${edge.my})`}>
                      <circle r={9} fill={edge.state === "blocked" ? "var(--red-bg)" : "var(--orange-bg)"} stroke={EDGE_STROKE[edge.state]} strokeWidth={1.25} />
                      <path d={edge.state === "blocked" ? "M -3 -3 L 3 3 M 3 -3 L -3 3" : "M 0 -4 L 0 1 M 0 3.6 L 0 3.7"} stroke={EDGE_STROKE[edge.state]} strokeWidth={1.6} strokeLinecap="round" fill="none" />
                    </g>
                  )}
                  <circle cx={edge.x2} cy={edge.y2} r={3.5} fill="var(--canvas)" stroke={EDGE_STROKE[edge.state]} strokeWidth={1.5} />
                  {connectionId && onSelectEdge && (
                    <path
                      d={edge.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ cursor: "pointer" }}
                      role="button"
                      tabIndex={0}
                      aria-label="Select this link"
                      aria-pressed={picked}
                      onClick={() => onSelectEdge(picked ? null : connectionId)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectEdge(picked ? null : connectionId); } }}
                    />
                  )}
                </g>
              );
            })}
          </svg>

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
                className={`topo-node absolute rounded-[14px] border border-(--line) bg-(--panel) p-3 shadow-[var(--shadow-card)]${dimmed ? " topo-dim" : ""}${dropTarget === dragKey(sel) ? " topo-drop-target" : ""}`}
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
                onDoubleClick={() => flyToNode(sel)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="nx-tile" data-tone={sessionEdgeState(agent) === "blocked" ? "danger" : sessionEdgeState(agent) === "warned" ? "warning" : active ? "success" : undefined}><Icon name="agents" size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-(--text)">{name}</strong>
                    <small className="block truncate text-[12px] text-(--muted)">{projectDisplayName(agent.project)} · {agent.environment}</small>
                  </span>
                  <span className="nx-badge shrink-0" data-tone={active ? "success" : "neutral"}><i aria-hidden="true" />{active ? "Active" : "Idle"}</span>
                </div>
                <p className="nx-mono mt-2 truncate text-(--muted-2)" title={`Session ${agent.session}`}>
                  {agent.session.slice(0, 8)} · {agent.decisions} call{agent.decisions === 1 ? "" : "s"} · {agent.blocked} flagged
                </p>
                <p className="truncate text-[11.5px] text-(--muted-2)">{agent.lastOperation} · {timeAgoShort(agent.lastTs)}</p>
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
                className={`topo-node absolute rounded-[14px] border border-(--line) bg-(--panel) p-3 shadow-[var(--shadow-card)]${dimmed ? " topo-dim" : ""}${dropTarget === dragKey(sel) ? " topo-drop-target" : ""}`}
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
                onDoubleClick={() => flyToNode(sel)}
              >
                {warnings > 0 && (
                  <span className={`topo-warn-dot${blocked ? " is-blocked" : ""}`} title={`${warnings} waiting · ${blocked ? "blocked traffic" : "awaiting review"}`}>
                    {warnings > 9 ? "9+" : warnings}
                  </span>
                )}
                <div className="flex items-center gap-2.5">
                  <span className="nx-tile" aria-hidden="true"><Icon name="folder" size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-(--text)">{project.name}</strong>
                    <small className="block truncate text-[12px] text-(--muted)">{(project.connections ?? []).length} service{(project.connections ?? []).length === 1 ? "" : "s"} · {warnings} waiting</small>
                  </span>
                  <span className="nx-badge shrink-0" data-tone={project.environment.toLowerCase().startsWith("prod") ? "warning" : "neutral"}>{project.environment}</span>
                </div>
                <p className="nx-mono mt-2 truncate text-(--muted-2)">{project.path}</p>
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
                className={`topo-node absolute rounded-[14px] border border-(--line) bg-(--panel) p-3 shadow-[var(--shadow-card)]${dimmed ? " topo-dim" : ""}${dropTarget === dragKey(sel) ? " topo-drop-target" : ""}`}
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
                onDoubleClick={() => flyToNode(sel)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="nx-tile" data-tone={categoryTile(connection.provider).tone === "neutral" ? undefined : categoryTile(connection.provider).tone} aria-hidden="true"><Icon name={categoryTile(connection.provider).icon} size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-semibold text-(--text)">{connection.provider}</strong>
                    <small className="block truncate text-[12px] text-(--muted)">{accountLabel}</small>
                  </span>
                  <span className="nx-badge shrink-0" data-tone={tier === "native" ? "success" : tier === "curated" ? "info" : "warning"}>{tier}</span>
                </div>
                <p className="mt-2 flex items-center gap-2">
                  <span className="nx-mono min-w-0 truncate text-(--text)">{resource}</span>
                  {sharedConnectionIds?.has(connection.id) && <span className="nx-badge shrink-0" data-tone="warning" title="This account is also bound to another project">Shared</span>}
                </p>
                <p className="truncate text-[11.5px] text-(--muted-2)">{project.name}{connection.environment ? ` · ${connection.environment}` : ""}</p>
              </article>
            );
          })}
        </div>

          {selectedNode && detailsSlot != null && (
            <div
              className="absolute z-10 max-h-[70%] w-[240px] overflow-y-auto rounded-[14px] border border-(--line) bg-(--panel) p-3 shadow-[var(--shadow-card)]"
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

      <div data-topo-overlay className="absolute bottom-4 left-4 z-10 flex max-w-[calc(50%-140px)] flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-(--line) bg-(--panel) px-3 py-2 shadow-[var(--shadow-card)]" aria-label="Line legend" style={{ left: 16 }}>
        {(Object.keys(EDGE_STROKE) as EdgeState[]).map((state) => (
          <span key={state} className="flex items-center gap-1.5 text-[11.5px] text-(--muted)">
            <span aria-hidden="true" style={{ display: "inline-block", width: 14, height: 2, borderRadius: 2, background: EDGE_STROKE[state] }} />
            {EDGE_LABEL[state]}
          </span>
        ))}
        {(visibleSessions.length > MAX_AGENTS || serviceBindings.length > MAX_SERVICES) && (
          <span className="text-[11.5px] tabular-nums text-(--muted-2)">Showing {agents.length}/{visibleSessions.length} sessions, {services.length}/{serviceBindings.length} bindings</span>
        )}
      </div>

      <div data-topo-overlay className="absolute bottom-[68px] left-4 z-10 rounded-[12px] border border-(--line) bg-(--panel) p-1.5 shadow-[var(--shadow-card)]" style={{ width: MM_W, height: MM_H, touchAction: "none" }} aria-label="Minimap. Click or drag to move the view."
        onPointerDown={(event) => { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointers have no capture */ } minimapMove(event); }}
        onPointerMove={(event) => { if (event.buttons === 1) minimapMove(event); }}
      >
        <svg width={MM_W - 12} height={MM_H - 12} style={{ display: "block", cursor: "crosshair" }}>
          {rects.map((rect) => (
            <rect key={`${rect.kind}:${rect.id}`} x={rect.x * mmScale} y={rect.y * mmScale} width={rect.w * mmScale} height={rect.h * mmScale} rx={2} fill={selectedNode?.kind === rect.kind && selectedNode.id === rect.id ? "var(--text)" : "var(--raised)"} stroke="var(--line)" strokeWidth={0.75} />
          ))}
          <rect x={(-cam.x / cam.z) * mmScale} y={(-cam.y / cam.z) * mmScale} width={(vp.w / cam.z) * mmScale} height={(vp.h / cam.z) * mmScale} fill="none" stroke="var(--text)" strokeWidth={1.25} rx={2} />
        </svg>
      </div>

      <div data-topo-overlay className="absolute bottom-4 left-1/2 z-10 w-[240px] -translate-x-1/2">
        {searchFocused && matches.length > 0 && (
          <ul className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-[12px] border border-(--line) bg-(--panel) shadow-[var(--shadow-pop)]" role="listbox" aria-label="Matching nodes">
            {matches.map((rect) => (
              <li key={`${rect.kind}:${rect.id}`}>
                <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] text-(--text) hover:bg-(--raised)" onMouseDown={(event) => { event.preventDefault(); jumpTo(rect); }}>
                  <span className="truncate">{rect.label}</span>
                  <span className="shrink-0 text-[11px] uppercase tracking-[0.06em] text-(--muted-2)">{rect.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-center gap-2 rounded-[12px] border border-(--line) bg-(--panel) px-3 py-2 shadow-[var(--shadow-card)]">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) jumpTo(matches[0]); if (event.key === "Escape") { setQuery(""); searchRef.current?.blur(); } event.stopPropagation(); }}
            placeholder="Find a node…"
            aria-label="Find a node"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-(--text) outline-none placeholder:text-(--muted-2)"
          />
        </label>
      </div>

      <div data-topo-overlay className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-[12px] border border-(--line) bg-(--panel) p-1 shadow-[var(--shadow-card)]" role="group" aria-label="Zoom controls">
        <Button isIconOnly size="sm" variant="ghost" aria-label="Zoom out" onPress={() => camera.zoomBy(1 / 1.25)}><Icon name="minus" size={15} /></Button>
        <button type="button" className="nx-mono w-[52px] rounded-[8px] py-1 text-center text-(--text) hover:bg-(--raised)" aria-label="Reset view" title="Reset view" onClick={camera.resetView}>{Math.round(cam.z * 100)}%</button>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Zoom in" onPress={() => camera.zoomBy(1.25)}><Icon name="plus" size={15} /></Button>
        <span className="mx-0.5 h-5 w-px bg-(--line)" aria-hidden="true" />
        <Button isIconOnly size="sm" variant="ghost" aria-label="Fit whole graph" onPress={camera.fitAll}><Icon name="expand" size={15} /></Button>
      </div>
    </div>
  );
}

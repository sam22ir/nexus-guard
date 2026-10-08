import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { accountLabelForConnection, tierForProvider, type Account, type Project } from "./store";
import { accountGroupKey } from "./accounts";
import { TopologyGraph, agentDisplayName, agentInitials, projectDisplayName, type PendingLinkRequest, type TopologyEnv, type TopologySelection, type TopologySession } from "./topology";
import { Button } from "@heroui/react";
import { Badge, Card, CardHead, Empty, Icon, Segmented, StepRow, type StepState, type Tone } from "./ui";
import { desktopAvailable } from "./keychain";
import { type NavTarget } from "./app/types";

export type HomeNavTarget = NavTarget;

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

export function HomeView({ projects, accounts, sharedConnectionIds, linkDraft, onView, onSelectProject, onRequestLink, onConfirmLink, onCancelLink, onContinueInPicker, onUnlink }: {
  projects: Project[];
  accounts?: Account[];
  sharedConnectionIds?: Set<string>;
  onView: (view: HomeNavTarget) => void;
  onSelectProject: (id: string) => void;
  /** Drag-to-link: the parent opens its prefilled binding picker and confirms. */
  onRequestLink: (request: PendingLinkRequest) => void;
  /** A drop waiting for confirmation (paper §12): nothing is saved until the
   *  developer presses Link in the confirm card. */
  linkDraft?: { projectId: string; provider: string; accountId?: string } | null;
  onConfirmLink: (input: { provider: string; target: string; accountId?: string }) => void;
  onCancelLink: () => void;
  onContinueInPicker: () => void;
  /** Confirmed unlink of one binding; the canvas itself never writes. */
  onUnlink: (projectId: string, connectionId: string) => void;
}) {
  const [entries, setEntries] = useState<HomeAuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sessionView, setSessionView] = useState<"topology" | "list">("topology");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [openSections, setOpenSections] = useState({ projects: false, activity: false, blocked: false });
  const toggleSection = (key: keyof typeof openSections) => setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  const [env, setEnv] = useState<TopologyEnv>("all");
  const [selectedNode, setSelectedNode] = useState<TopologySelection>(null);

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

  /** Inspector project click focuses the canvas (dims everything else and
   *  opens details) — it does NOT navigate away. The arrow opens it. */
  function focusProject(id: string) {
    onSelectProject(id);
    setSelectedNode({ kind: "project", id });
  }

  const decisionTone = (decision?: string | null): { state: StepState; tone: Tone } =>
    decision === "allow" ? { state: "done", tone: "success" }
      : decision === "block" ? { state: "failed", tone: "danger" }
      : { state: "skipped", tone: "warning" };

  /** Confirm step for removing a link: names project, environment, account and
   *  resource, and flags a shared account. Only the confirm button writes. */
  function renderUnlinkConfirm(): ReactNode {
    if (!selectedEdge) return null;
    for (const project of projects) {
      const connection = (project.connections ?? []).find((item) => item.id === selectedEdge);
      if (!connection) continue;
      const account = accountLabelForConnection(connection, accounts) ?? "Not linked";
      const shared = sharedConnectionIds?.has(connection.id) === true;
      return (
        <Card>
          <CardHead eyebrow="Remove link" title={`${project.name} → ${connection.provider}`} />
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="text-(--muted)">Environment</dt><dd className="text-(--text)">{connection.environment ?? project.environment}</dd>
            <dt className="text-(--muted)">Account</dt><dd className="text-(--text)">{account}</dd>
            <dt className="text-(--muted)">Resource</dt><dd className="nx-mono text-(--text)">{connection.resource ?? connection.target}</dd>
          </dl>
          {shared && <p className="mt-3 text-[12px] leading-[1.55] text-(--orange)">This account is also bound to another project. Removing this link does not affect the other one.</p>}
          <p className="mt-3 text-[12px] leading-[1.55] text-(--muted)">Agents on this project lose access to this resource. The saved approval is deleted from this desktop.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" onPress={() => { onUnlink(project.id, connection.id); setSelectedEdge(null); }}>Remove link</Button>
            <Button size="sm" variant="outline" onPress={() => setSelectedEdge(null)}>Cancel</Button>
          </div>
        </Card>
      );
    }
    return null;
  }

  const envOptions = ENV_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
  const panelWidth = 300;

  return (
    <div className="nx-card nx-card-flush relative min-h-0 flex-1 overflow-hidden" style={{ minHeight: 420, padding: 0 }}>
      {sessionView === "topology" ? (
        <TopologyGraph
          projects={projects}
          sessions={sessions}
          entries={entries}
          accounts={accounts}
          environment={env}
          selectedNode={selectedNode}
          onSelectNode={(node) => { setSelectedEdge(null); setSelectedNode(node); }}
          warningsByProject={pendingAuthByProject}
          onRequestLink={onRequestLink}
          selectedEdge={selectedEdge}
          onSelectEdge={(id) => { setSelectedNode(null); setSelectedEdge(id); }}
          sharedConnectionIds={sharedConnectionIds}
          insetTop={72}
          insetRight={panelOpen ? panelWidth + 16 : 0}
        />
      ) : (
        <div className="absolute inset-0 z-10 overflow-y-auto bg-(--canvas) pb-4 pl-4 pt-[72px]" style={{ paddingRight: panelOpen ? panelWidth + 32 : 16 }} aria-label="Live sessions list">
          {sessions.length === 0 ? (
            <Empty title="No live sessions">Connect an agent and its first call will appear here.</Empty>
          ) : (
            <div className="nx-rows rounded-[14px] border border-(--line) bg-(--panel)">
              {sessions.map((session) => (
                <StepRow
                  key={session.session}
                  title={agentDisplayName(session.agent)}
                  sub={`${projectDisplayName(session.project)} · ${session.environment}`}
                  icon="agents"
                  trailing={<span className="nx-mono nx-muted">{agentInitials(agentDisplayName(session.agent))} · {session.decisions} calls</span>}
                  onPress={() => onView("activity")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-[14px] border border-(--line) bg-(--panel) p-1.5 shadow-[var(--shadow-card)]">
        <div className="nx-seg" role="tablist" aria-label="Topology view">
          <button type="button" role="tab" aria-selected={sessionView === "topology"} aria-label="Topology" title="Topology" onClick={() => setSessionView("topology")} style={{ padding: "5px 8px" }}><Icon name="branch" size={15} /></button>
          <button type="button" role="tab" aria-selected={sessionView === "list"} aria-label="Sessions" title="Sessions" onClick={() => setSessionView("list")} style={{ padding: "5px 8px" }}><Icon name="agents" size={15} /></button>
        </div>
        <EnvMenu value={env} options={envOptions} onChange={setEnv} />
        <Button isIconOnly size="sm" aria-label="Add binding" onPress={() => onView("bindings")}><Icon name="plus" size={15} /></Button>
        <span className="mx-1 h-2 w-2 shrink-0 rounded-full" style={{ background: loaded ? "var(--green)" : "var(--muted-2)" }} title={loaded ? "Synced from local activity" : "Reading local state…"} role="img" aria-label={loaded ? "Synced" : "Loading"} />
      </div>

      {!panelOpen && (
        <Button className="absolute right-4 top-4 z-20 shadow-[var(--shadow-card)]" size="sm" variant="outline" onPress={() => setPanelOpen(true)}>
          <Icon name="grid" size={15} />Panel
        </Button>
      )}

      {panelOpen && (
        <aside className="absolute right-4 top-4 z-20 flex flex-col gap-3 overflow-y-auto pb-1 [&>*]:shrink-0" style={{ width: panelWidth, maxHeight: "calc(100% - 88px)" }} aria-label="Topology inspector">
          {linkDraft && (
            <LinkConfirmCard
              key={`${linkDraft.projectId}:${linkDraft.provider}`}
              draft={linkDraft}
              projects={projects}
              accounts={accounts ?? []}
              onConfirm={onConfirmLink}
              onCancel={onCancelLink}
              onContinueInPicker={onContinueInPicker}
            />
          )}
          {renderUnlinkConfirm()}
          {selectedNode && (
            <NodeInspector
              key={`${selectedNode.kind}:${selectedNode.id}`}
              selection={selectedNode}
              projects={projects}
              accounts={accounts}
              sessions={sessions}
              entries={entries}
              sharedConnectionIds={sharedConnectionIds}
              onView={onView}
              onSelectProject={onSelectProject}
              onClose={() => setSelectedNode(null)}
            />
          )}
          <Card flush>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-(--muted)">
                <strong className="nx-mono font-semibold text-(--text)">{projects.length}</strong> projects · <strong className="nx-mono font-semibold text-(--text)">{connectedBindings}</strong> bindings · <strong className="nx-mono font-semibold text-(--text)">{sessions.length}</strong> live
              </span>
              {!(selectedNode || linkDraft || selectedEdge) && (
                <Button isIconOnly size="sm" variant="ghost" aria-label="Hide panel" onPress={() => setPanelOpen(false)}><Icon name="x" size={15} /></Button>
              )}
            </div>
            {browserPending.length > 0 && (
              <button type="button" className="nx-row" onClick={() => onView("bindings")}>
                <span className="nx-tile" data-tone="warning"><Icon name="alert" size={16} /></span>
                <span className="nx-row-body"><span className="nx-row-title">{browserPending.length} approval{browserPending.length === 1 ? "" : "s"} waiting</span></span>
                <Icon name="forward" size={14} />
              </button>
            )}
            <PanelSection title="Projects" count={projects.length} open={openSections.projects} onToggle={() => toggleSection("projects")}>
              {projects.map((project) => (
                <StepRow
                  key={project.id}
                  icon="folder"
                  title={project.name}
                  sub={`${project.environment} · ${(project.connections ?? []).length} services`}
                  active={selectedNode?.kind === "project" && selectedNode.id === project.id}
                  onPress={() => focusProject(project.id)}
                  trailing={<Icon name="forward" size={15} />}
                />
              ))}
              {projects.length === 0 && <div className="px-4 py-3 text-[12.5px] text-(--muted)">No projects yet. Register one to see it here.</div>}
            </PanelSection>
            <PanelSection title="Recent activity" count={recent.length} open={openSections.activity} onToggle={() => toggleSection("activity")}>
              {recent.slice(0, 4).map((entry, index) => {
                const { state, tone } = decisionTone(entry.decision);
                return <StepRow key={`${entry.ts}-${index}`} state={state} icon="database" tone={tone} title={entry.operation ?? "Decision"} sub={`${projectDisplayName(entry.project)} · ${entry.resource ?? entry.provider ?? "Nexus"}`} trailing={<span className="nx-mono nx-muted">{timeAgo(entry.ts)}</span>} />;
              })}
              {recent.length === 0 && <div className="px-4 py-3 text-[12.5px] text-(--muted)">{desktopAvailable() ? "No agent has used Nexus yet." : "Open the desktop app to read the local activity log."}</div>}
              {recent.length > 0 && <button type="button" className="nx-row" onClick={() => onView("activity")}><span className="nx-row-body"><span className="nx-row-sub">View all activity</span></span><Icon name="forward" size={14} /></button>}
            </PanelSection>
            {guardApprovals.length > 0 && (
              <PanelSection title="Blocked calls" count={guardApprovals.length} tone="warning" open={openSections.blocked} onToggle={() => toggleSection("blocked")}>
                {guardApprovals.slice(0, 3).map((entry, index) => (
                  <StepRow key={`${entry.ts}-${index}`} state="skipped" icon="shield" tone="warning" title={entry.operation ?? "Decision"} sub={`${projectDisplayName(entry.project)} · ${entry.resource ?? entry.provider ?? "Nexus"}`} trailing={<span className="nx-mono nx-muted">{timeAgo(entry.ts)}</span>} />
                ))}
              </PanelSection>
            )}
          </Card>
        </aside>
      )}
    </div>
  );
}

type InspectorTab = "overview" | "bindings" | "activity" | "warnings";

/** Full detail panel for the selected node (references: right-hand detail
 *  panel with tabs). Reads only; every change goes through Bindings/Agents. */
function NodeInspector({ selection, projects, accounts, sessions, entries, sharedConnectionIds, onView, onSelectProject, onClose }: {
  selection: Exclude<TopologySelection, null>;
  projects: Project[];
  accounts?: Account[];
  sessions: TopologySession[];
  entries: HomeAuditEntry[];
  sharedConnectionIds?: Set<string>;
  onView: (view: HomeNavTarget) => void;
  onSelectProject: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<InspectorTab>("overview");
  const found = (() => {
    if (selection.kind === "project") {
      const project = projects.find((item) => item.id === selection.id);
      return project ? { kind: "project" as const, project } : null;
    }
    if (selection.kind === "agent") {
      const session = sessions.find((item) => item.session === selection.id);
      return session ? { kind: "agent" as const, session } : null;
    }
    for (const project of projects) {
      const connection = (project.connections ?? []).find((item) => item.id === selection.id);
      if (connection) return { kind: "service" as const, project, connection };
    }
    return null;
  })();
  if (!found) return null;

  const inProject = (entry: HomeAuditEntry, project: Project) => entry.project_id === project.id || entry.project === project.name;
  let title = "";
  let subtitle = "";
  let icon: Parameters<typeof Icon>[0]["name"] = "folder";
  let scoped: HomeAuditEntry[] = [];
  const warnings: { tone: Tone; text: string }[] = [];
  let overview: [string, ReactNode][] = [];
  let bindingRows: ReactNode = null;

  if (found.kind === "project") {
    const { project } = found;
    title = project.name;
    subtitle = `${project.environment} · ${(project.connections ?? []).length} services`;
    scoped = entries.filter((entry) => inProject(entry, project));
    const waiting = scoped.filter((entry) => entry.decision === "approval_required").length;
    const blocked = scoped.filter((entry) => entry.decision === "block").length;
    if (waiting) warnings.push({ tone: "warning", text: `${waiting} call${waiting === 1 ? "" : "s"} waiting for review.` });
    if (blocked) warnings.push({ tone: "danger", text: `${blocked} call${blocked === 1 ? "" : "s"} blocked.` });
    for (const connection of project.connections ?? []) {
      if (!connection.accountId && !connection.account) warnings.push({ tone: "warning", text: `${connection.provider} has no linked account.` });
      if (sharedConnectionIds?.has(connection.id)) warnings.push({ tone: "warning", text: `${connection.provider} shares its account with another project.` });
      if (connection.authState === "pending") warnings.push({ tone: "info", text: `${connection.provider} is waiting for browser approval.` });
    }
    overview = [["Environment", project.environment], ["Folder", <span className="nx-mono" key="p">{project.path}</span>], ["Bindings", String((project.connections ?? []).length)], ["Calls seen", String(scoped.length)]];
    bindingRows = (project.connections ?? []).map((connection) => (
      <StepRow key={connection.id} icon="services" title={connection.provider} sub={`${accountLabelForConnection(connection, accounts) ?? "Not linked"} · ${connection.resource ?? connection.target}`} trailing={sharedConnectionIds?.has(connection.id) ? <Badge tone="warning">Shared</Badge> : undefined} />
    ));
  } else if (found.kind === "agent") {
    const { session } = found;
    title = agentDisplayName(session.agent);
    subtitle = `${projectDisplayName(session.project)} · ${session.environment}`;
    icon = "agents";
    scoped = entries.filter((entry) => entry.session === session.session);
    if (session.blocked > 0) warnings.push({ tone: "warning", text: `${session.blocked} flagged call${session.blocked === 1 ? "" : "s"} in this session.` });
    if (projectDisplayName(session.project) === "Unresolved project") warnings.push({ tone: "danger", text: "This session never resolved to a registered project." });
    overview = [["Session", <span className="nx-mono" key="s">{session.session.slice(0, 8)}</span>], ["Calls", String(session.decisions)], ["Flagged", String(session.blocked)], ["Last call", `${session.lastOperation} · ${timeAgo(session.lastTs)}`]];
  } else {
    const { project, connection } = found;
    const resource = connection.resource ?? connection.target;
    title = connection.provider;
    subtitle = `${project.name} · ${connection.environment ?? project.environment}`;
    icon = "services";
    scoped = entries.filter((entry) => inProject(entry, project) && entry.provider?.toLowerCase() === connection.provider.toLowerCase() && (!entry.resource || entry.resource === resource || entry.resource === connection.target));
    if (!connection.accountId && !connection.account) warnings.push({ tone: "warning", text: "No account is linked to this binding." });
    if (sharedConnectionIds?.has(connection.id)) warnings.push({ tone: "warning", text: "This account is also bound to another project." });
    if (connection.authState === "pending") warnings.push({ tone: "info", text: "Waiting for browser approval." });
    overview = [["Account", accountLabelForConnection(connection, accounts) ?? "Not linked"], ["Resource", <span className="nx-mono" key="r">{resource}</span>], ["Approval", connection.authState ?? "not connected"], ["Calls seen", String(scoped.length)]];
    const sameAccount = projects.flatMap((item) => (item.connections ?? []).filter((other) => other.id !== connection.id && accountGroupKey(other.provider, other) === accountGroupKey(connection.provider, connection) && accountGroupKey(connection.provider, connection)).map((other) => ({ item, other })));
    bindingRows = sameAccount.length === 0
      ? <div className="px-5 py-4 text-[12.5px] text-(--muted)">This account is bound only here.</div>
      : sameAccount.map(({ item, other }) => <StepRow key={other.id} icon="link" title={item.name} sub={`${other.provider} · ${other.resource ?? other.target}`} trailing={<Badge tone="warning">Shared</Badge>} />);
  }

  const tabs: { value: InspectorTab; label: string }[] = [
    { value: "overview", label: "Overview" },
    ...(found.kind !== "agent" ? [{ value: "bindings" as const, label: found.kind === "project" ? "Bindings" : "Shared" }] : []),
    { value: "activity", label: "Activity" },
    { value: "warnings", label: warnings.length ? `Alerts ${warnings.length}` : "Alerts" },
  ];
  const recent = [...scoped].reverse().slice(0, 8);
  const tone = (decision?: string | null): { state: StepState; tone: Tone } =>
    decision === "allow" ? { state: "done", tone: "success" } : decision === "block" ? { state: "failed", tone: "danger" } : { state: "skipped", tone: "warning" };

  return (
    <Card flush>
      <div className="flex items-center gap-3 px-5 pt-4">
        <span className="nx-tile"><Icon name={icon} size={17} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate text-[14px] font-semibold text-(--text)">{title}</strong>
          <small className="truncate text-[12px] text-(--muted)">{subtitle}</small>
        </span>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Close details" onPress={onClose}><Icon name="x" size={15} /></Button>
      </div>
      <div className="px-5 pb-3 pt-3"><Segmented label="Node details" value={tab} onChange={setTab} options={tabs} /></div>
      <div className="border-t border-(--line-soft)">
        {tab === "overview" && (
          <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 px-5 py-4 text-[12.5px]">
            {overview.map(([label, value]) => (<div key={label} className="contents"><dt className="text-(--muted)">{label}</dt><dd className="min-w-0 break-words text-(--text)">{value}</dd></div>))}
          </dl>
        )}
        {tab === "bindings" && <div className="nx-rows">{bindingRows}</div>}
        {tab === "activity" && (
          <div className="nx-rows">
            {recent.length === 0 && <div className="px-5 py-4 text-[12.5px] text-(--muted)">No calls recorded for this yet.</div>}
            {recent.map((entry, index) => {
              const { state, tone: rowTone } = tone(entry.decision);
              return <StepRow key={`${entry.ts}-${index}`} state={state} icon="database" tone={rowTone} title={entry.operation ?? "Decision"} sub={entry.reason ?? `${entry.provider ?? "Nexus"} · ${entry.resource ?? ""}`} trailing={<span className="nx-mono nx-muted">{timeAgo(entry.ts)}</span>} />;
            })}
          </div>
        )}
        {tab === "warnings" && (
          <div className="flex flex-col gap-2 px-5 py-4">
            {warnings.length === 0 && <p className="text-[12.5px] text-(--muted)">Nothing needs attention.</p>}
            {warnings.map((warning, index) => (<div key={index} className="flex items-start gap-2 text-[12.5px] text-(--text)"><Badge tone={warning.tone} dot>{warning.tone === "danger" ? "Blocked" : warning.tone === "info" ? "Info" : "Review"}</Badge><span className="min-w-0 flex-1">{warning.text}</span></div>))}
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-(--line-soft) px-5 py-3">
        {found.kind === "agent" ? (
          <Button size="sm" variant="outline" onPress={() => onView("activity")}>Open activity</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onPress={() => { onSelectProject(found.project.id); onView("bindings"); }}>Bindings</Button>
            {found.kind === "project" && <Button size="sm" variant="outline" onPress={() => { onSelectProject(found.project.id); onView("overview"); }}>Open project</Button>}
          </>
        )}
      </div>
    </Card>
  );
}

/** Confirm step for a drag-to-link: names project, environment, account and
 *  resource, and flags a shared account. The only writer is the Link button. */
function LinkConfirmCard({ draft, projects, accounts, onConfirm, onCancel, onContinueInPicker }: {
  draft: { projectId: string; provider: string; accountId?: string };
  projects: Project[];
  accounts: Account[];
  onConfirm: (input: { provider: string; target: string; accountId?: string }) => void;
  onCancel: () => void;
  onContinueInPicker: () => void;
}) {
  const project = projects.find((item) => item.id === draft.projectId);
  const matching = accounts.filter((account) => account.provider.toLowerCase() === draft.provider.toLowerCase());
  const [accountId, setAccountId] = useState(draft.accountId && matching.some((a) => a.id === draft.accountId) ? draft.accountId : matching[0]?.id ?? "");
  const [resource, setResource] = useState("");
  const [understood, setUnderstood] = useState(false);
  if (!project) return null;
  const tier = tierForProvider(draft.provider);
  const usesPicker = draft.provider === "Supabase"; // needs the live project list
  const elsewhere = accountId
    ? projects.filter((item) => item.id !== project.id && (item.connections ?? []).some((c) => c.accountId === accountId && c.provider.toLowerCase() === draft.provider.toLowerCase()))
    : [];
  const canLink = resource.trim().length > 0 && (tier !== "self-added" || understood);

  return (
    <Card>
      <CardHead eyebrow="Link service" title={`${draft.provider} → ${project.name}`} action={<Button isIconOnly size="sm" variant="ghost" aria-label="Cancel link" onPress={onCancel}><Icon name="x" size={15} /></Button>} />
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-(--muted)">Project</dt><dd className="text-(--text)">{project.name}</dd>
          <dt className="text-(--muted)">Environment</dt><dd className="text-(--text)">{project.environment}</dd>
          <dt className="text-(--muted)">Service</dt><dd className="text-(--text)">{draft.provider} <span className="text-(--muted)">· {tier}</span></dd>
        </dl>
        <label className="nx-field">
          Account
          <select className="nx-input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {matching.length === 0 && <option value="">No linked account</option>}
            {matching.map((account) => (<option key={account.id} value={account.id}>{account.label}</option>))}
          </select>
        </label>
        {usesPicker ? (
          <p className="text-[12px] leading-[1.55] text-(--muted)">Supabase resources come live from the account, so pick the project in the binding picker.</p>
        ) : (
          <label className="nx-field">
            Resource
            <input className="nx-input nx-mono" value={resource} onChange={(event) => setResource(event.target.value)} placeholder="e.g. project-name" autoFocus />
          </label>
        )}
        {elsewhere.length > 0 && (
          <p className="text-[12px] leading-[1.55] text-(--orange)">This account is already bound to {elsewhere.map((item) => item.name).join(", ")}. Sharing it widens the blast radius of one credential.</p>
        )}
        {!usesPicker && tier === "self-added" && (
          <label className="flex items-start gap-2 text-[12px] leading-[1.5] text-(--muted)">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-0.5" />
            Nexus has not reviewed this service. Calls stay fail-closed until approved.
          </label>
        )}
        <p className="text-[12px] leading-[1.55] text-(--muted)">Nothing is saved until you press {usesPicker ? "Continue" : "Link"}.</p>
        <div className="flex gap-2">
          {usesPicker ? (
            <Button size="sm" onPress={onContinueInPicker}>Continue</Button>
          ) : (
            <Button size="sm" isDisabled={!canLink} onPress={() => onConfirm({ provider: draft.provider, target: resource.trim(), accountId: accountId || undefined })}>Link</Button>
          )}
          <Button size="sm" variant="outline" onPress={onCancel}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

/** Collapsible panel section: a one-line header that expands on demand. */
function PanelSection({ title, count, tone, open, onToggle, children }: { title: string; count: number; tone?: Tone; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-t border-(--line-soft)">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-2.5 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="flex-1 text-[12.5px] font-medium text-(--text)">{title}</span>
        <Badge tone={tone ?? "neutral"}>{count}</Badge>
        <span className="text-(--muted)"><Icon name={open ? "up" : "down"} size={15} /></span>
      </button>
      {open && <div className="nx-rows pb-1">{children}</div>}
    </div>
  );
}

/** Environment filter as one compact dropdown instead of four buttons. */
function EnvMenu({ value, options, onChange }: { value: TopologyEnv; options: { value: TopologyEnv; label: string }[]; onChange: (value: TopologyEnv) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const current = options.find((option) => option.value === value)?.label ?? "All envs";
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" aria-haspopup="listbox" aria-expanded={open} aria-label={`Environment: ${current}`} onPress={() => setOpen((v) => !v)}>
        {current}<Icon name="down" size={14} />
      </Button>
      {open && (
        <ul role="listbox" aria-label="Environment" className="absolute left-0 top-full z-30 mt-1.5 min-w-[150px] overflow-hidden rounded-[12px] border border-(--line) bg-(--panel) py-1 shadow-[var(--shadow-pop)]">
          {options.map((option) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] text-(--text) hover:bg-(--raised)" onClick={() => { onChange(option.value); setOpen(false); }}>
                {option.label}
                {option.value === value && <Icon name="check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

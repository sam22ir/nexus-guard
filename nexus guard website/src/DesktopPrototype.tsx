import { useState, useEffect, useMemo, type ReactNode } from "react";
import "./DesktopPrototype.css";

export type Connection = {
  id: string;
  provider: string;
  short: string;
  target: string;
  /** Resource: concrete instance behind the service name. Alias of target. */
  resource?: string;
  /** Environment: development | production | similar. */
  environment?: string;
  detail: string;
  tone: "blue" | "violet" | "green" | "orange";
  state: "Ready" | "Needs review";
  method?: "manual" | "mcp";
  authState?: "not_connected" | "pending" | "connected";
  keySaved?: boolean;
  projectRef?: string;
  url?: string;
};

export type Project = {
  id: string;
  name: string;
  initials: string;
  path: string;
  branch: string;
  repo: string;
  /** Environment for this workspace registration. */
  environment: string;
  lastSeen: string;
  connections: Connection[];
};

type View = "overview" | "projects" | "agents" | "connections" | "guard" | "activity" | "settings";

const STARTER_PROJECTS: Project[] = [
  {
    id: "koupa",
    name: "Koupa",
    initials: "KO",
    path: "~/Projects/Koupa",
    branch: "main",
    repo: "github.com/saadi/koupa",
    environment: "production",
    lastSeen: "Active now",
    connections: [
      { id: "koupa-supabase", provider: "Supabase", short: "SB", target: "koupa-production", resource: "koupa-production", environment: "production", detail: "Database · Auth · Storage", tone: "green", state: "Needs review", method: "manual", projectRef: "koupa-prod-ref", url: "https://koupa-prod.supabase.co" },
      { id: "koupa-clerk", provider: "Clerk", short: "C", target: "koupa-auth", resource: "koupa-auth", environment: "production", detail: "Authentication", tone: "violet", state: "Needs review", method: "manual" },
      { id: "koupa-github", provider: "GitHub", short: "GH", target: "saadi/koupa", resource: "saadi/koupa", environment: "production", detail: "Repository", tone: "blue", state: "Needs review", method: "mcp" },
      { id: "koupa-sentry", provider: "Sentry", short: "S", target: "koupa", resource: "koupa", environment: "production", detail: "Error tracking", tone: "orange", state: "Needs review", method: "manual" },
    ],
  },
  {
    id: "nabdh",
    name: "Nabdh",
    initials: "NA",
    path: "~/Projects/Nabdh",
    branch: "develop",
    repo: "github.com/saadi/nabdh",
    environment: "development",
    lastSeen: "12 min ago",
    connections: [
      { id: "nabdh-supabase", provider: "Supabase", short: "SB", target: "nabdh-development", resource: "nabdh-development", environment: "development", detail: "Database · Auth", tone: "green", state: "Needs review", method: "manual", projectRef: "nabdh-dev-ref", url: "https://nabdh-dev.supabase.co" },
      { id: "nabdh-clerk", provider: "Clerk", short: "C", target: "nabdh-auth", resource: "nabdh-auth", environment: "development", detail: "Authentication", tone: "violet", state: "Needs review", method: "manual" },
      { id: "nabdh-github", provider: "GitHub", short: "GH", target: "saadi/nabdh", resource: "saadi/nabdh", environment: "development", detail: "Repository", tone: "blue", state: "Needs review", method: "mcp" },
    ],
  },
];

function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <img
        src="/nexus-symbol.png"
        alt="Nexus Guard"
        className="brand-mark-img"
        width={size}
        height={size}
      />
    </div>
  );
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    folder: "M3.5 6.5h6l1.7 2H20.5v9.5h-17z",
    nodes: "M7 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm10 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM9 9h6m-7 1.5 5.8 3.5",
    link: "M9.5 14.5 8 16a3.2 3.2 0 0 1-4.5-4.5L6 9m8.5.5L16 8a3.2 3.2 0 0 1 4.5 4.5L18 15M8 12h8",
    shield: "M12 3.5 19 6v5.2c0 4.2-2.8 7.4-7 9.3-4.2-1.9-7-5.1-7-9.3V6zM9.2 12l1.8 1.8 3.8-4",
    activity: "M3.5 12h3l2-5 3.3 10 2.1-5h6.6",
    settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
    plus: "M12 5v14M5 12h14",
    arrow: "M5 12h13m-5-5 5 5-5 5",
    chevron: "m8 10 4 4 4-4",
    more: "M6 12h.01M12 12h.01M18 12h.01",
    external: "M14 5h5v5m0-5-7 7M18 13v5H5V5h5",
    maximize: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
    minimize: "M4 14h6m0 0v6m0-6-7 7m17-11h-6m0 0V4m0 6 7-7",
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

function StatusDot({ tone = "green" }: { tone?: string }) {
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}

function initialsFor(name: string) {
  const letters = name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2);
  return (letters || "NX").toUpperCase();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function DesktopAppPrototype({ isFullscreen = false, onToggleFullscreen }: { isFullscreen?: boolean; onToggleFullscreen?: () => void }) {
  const [view, setView] = useState<View>("overview");
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = window.localStorage.getItem("nexus-proto.projects");
      return saved ? JSON.parse(saved) : STARTER_PROJECTS;
    } catch {
      return STARTER_PROJECTS;
    }
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string>("koupa");
  const [modal, setModal] = useState<"project" | "connection" | "key" | null>(null);
  const [keyConnection, setKeyConnection] = useState<Connection | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({ "koupa-supabase": true });
  const [notice, setNotice] = useState("");

  const project = useMemo(() => projects.find((p) => p.id === selectedProjectId) ?? projects[0], [projects, selectedProjectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("nexus-proto.projects", JSON.stringify(projects));
    } catch {}
  }, [projects]);

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setView("overview");
  }

  function addProject(input: { name: string; path: string; repo: string; branch: string }) {
    if (projects.some((item) => item.name.toLowerCase() === input.name.toLowerCase())) return;
    const branch = input.branch || "main";
    const newProject: Project = {
      id: makeId("project"),
      name: input.name,
      initials: initialsFor(input.name),
      path: input.path,
      branch,
      repo: input.repo || "Not connected",
      environment: branch === "main" ? "production" : "development",
      lastSeen: "Added just now",
      connections: [],
    };
    setProjects((current) => [...current, newProject]);
    setSelectedProjectId(newProject.id);
    setView("overview");
    setModal(null);
  }

  function addConnection(input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string }) {
    if (!project) return;
    const newConnection: Connection = {
      id: makeId("conn"),
      provider: input.provider,
      short: initialsFor(input.provider),
      target: input.target,
      resource: input.target,
      environment: project.environment ?? "development",
      detail: input.detail || "Service connection",
      tone: input.tone,
      state: "Needs review",
      method: input.method,
      authState: input.authState,
      keySaved: false,
      projectRef: input.projectRef,
      url: input.url,
    };
    setProjects((current) => current.map((p) => p.id === project.id ? { ...p, connections: [...p.connections, newConnection] } : p));
    setModal(null);
    setNotice(`Saved the safe Nexus project file at ${project.path}/.nexus/project.json.`);
  }

  function startMcpConnection(input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string }) {
    if (!project) return;
    if (input.provider !== "Supabase") {
      setNotice("MCP browser approval is available for Supabase only in this prototype.");
      return;
    }
    const newConnection: Connection = {
      id: makeId("conn"),
      provider: input.provider,
      short: initialsFor(input.provider),
      target: input.target,
      resource: input.target,
      environment: project.environment ?? "development",
      detail: input.detail || "Database and services",
      tone: input.tone,
      state: "Needs review",
      method: "mcp",
      authState: "pending",
      projectRef: input.projectRef,
      url: input.url,
    };
    setProjects((current) => current.map((p) => p.id === project.id ? { ...p, connections: [...p.connections, newConnection] } : p));
    setModal(null);
    setNotice("Supabase approval is open in your browser.");

    setTimeout(() => {
      setProjects((current) => current.map((p) => p.id === project.id ? {
        ...p,
        connections: p.connections.map((c) => c.id === newConnection.id ? { ...c, authState: "connected" as const, state: "Ready" as const } : c)
      } : p));
      setNotice(`Supabase is connected. Nexus wrote ${project.path}/.nexus/project.json. Its approval is stored in the desktop vault.`);
    }, 1500);
  }

  function openKeyModal(connection: Connection) {
    setKeyConnection(connection);
    setModal("key");
  }

  const navItems: { id: View; label: string; icon: string; section?: string }[] = [
    { id: "overview", label: "Overview", icon: "grid" },
    { id: "projects", label: "Projects", icon: "folder", section: "Workspace" },
    { id: "agents", label: "Agent sessions", icon: "nodes" },
    { id: "connections", label: "Connections", icon: "link" },
    { id: "guard", label: "Guard", icon: "shield", section: "Monitor" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "settings", label: "Settings", icon: "settings", section: "System" },
  ];

  return (
    <div className={`nexus-desktop-prototype ${isFullscreen ? "fullscreen-mode" : ""}`}>
      {/* Desktop Window Frame Bar */}
      <div className="proto-window-titlebar">
        <div className="proto-window-dots">
          <span className="dot-red" />
          <span className="dot-yellow" />
          <span className="dot-green" />
        </div>
        <div className="proto-window-title">
          <span>Nexus Guard (Desktop App Prototype v0.1.0)</span>
        </div>
        {onToggleFullscreen && (
          <button
            type="button"
            className="proto-fullscreen-toggle"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Prototype"}
            onClick={onToggleFullscreen}
          >
            <Icon name={isFullscreen ? "minimize" : "maximize"} />
          </button>
        )}
      </div>

      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="brand-lockup">
              <BrandMark />
              <div>
                <div className="brand-name">Nexus</div>
                <div className="brand-subtitle">Guard</div>
              </div>
            </div>
            <button className="icon-button quiet" aria-label="More options"><Icon name="more" /></button>
          </div>

          <div className="project-picker-label">Current project</div>
          <button className="project-picker" onClick={() => setView("projects")}>
            <span className="project-avatar">{project.initials}</span>
            <span className="project-picker-copy">
              <strong>{project.name}</strong>
              <span><StatusDot tone="orange" /> Not verified</span>
            </span>
            <Icon name="chevron" />
          </button>

          <nav className="side-nav" aria-label="Main navigation">
            {navItems.map((item) => (
              <div key={item.id}>
                {item.section && <div className="nav-section-label">{item.section}</div>}
                <button
                  className={`nav-item ${view === item.id ? "active" : ""}`}
                  onClick={() => setView(item.id)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.id === "guard" && <span className="nav-count">0</span>}
                </button>
              </div>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <div className="vault-card">
              <div className="vault-card-top">
                <span className="vault-icon"><Icon name="shield" /></span>
                <span className="eyebrow">Vault status</span>
              </div>
              <strong>{vaultUnlocked ? "Desktop vault unlocked (prototype)" : "Desktop vault locked"}</strong>
              <span>{vaultUnlocked ? "Publishable keys are saved locally, not verified." : "Click settings to unlock or manage."}</span>
            </div>
            <div className="profile-row">
              <span className="profile-avatar">S</span>
              <span className="profile-copy">
                <strong>Samir</strong>
                <small>Local workspace</small>
              </span>
              <Icon name="more" />
            </div>
          </div>
        </aside>

        <main className="main-content">
          <header className="topbar">
            <div className="breadcrumbs">
              <span>{view === "overview" ? "Workspace" : navItems.find((item) => item.id === view)?.label}</span>
              <span className="crumb-separator">/</span>
              <strong>{project.name}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className="status-pill"
                onClick={() => setView("settings")}
              >
                <StatusDot tone={vaultUnlocked ? "green" : "orange"} />
                {vaultUnlocked ? "Vault unlocked" : "Vault locked"}
              </button>
              <button className="icon-button" onClick={() => setModal("connection")} title="Add connection">
                <Icon name="plus" />
              </button>
              <button className="avatar-button" title="User profile">S</button>
            </div>
          </header>

          {notice && (
            <div className="toast" role="status">
              <StatusDot tone={notice.includes("connected") ? "green" : "orange"} />
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss">×</button>
            </div>
          )}

          <div className="content-scroll">
            {view === "overview" && <Overview project={project} onView={setView} />}
            {view === "projects" && (
              <ProjectsView
                projects={projects}
                selectedProject={project.id}
                onSelect={selectProject}
                onAdd={() => setModal("project")}
              />
            )}
            {view === "agents" && <AgentsView project={project} />}
            {view === "connections" && (
              <ConnectionsView
                project={project}
                vaultUnlocked={vaultUnlocked}
                savedKeys={savedKeys}
                onSaveKey={openKeyModal}
                onUnlock={() => setView("settings")}
                onAdd={() => setModal("connection")}
              />
            )}
            {view === "guard" && <GuardView project={project} />}
            {view === "activity" && <ActivityView project={project} />}
            {view === "settings" && (
              <SettingsView
                projects={projects}
                savedKeys={savedKeys}
                vaultUnlocked={vaultUnlocked}
                onUnlocked={() => setVaultUnlocked(true)}
                onLocked={() => setVaultUnlocked(false)}
              />
            )}
          </div>

          {modal === "project" && (
            <AddProjectModal
              onClose={() => setModal(null)}
              onSave={addProject}
              existingNames={projects.map((item) => item.name)}
            />
          )}

          {modal === "connection" && project && (
            <AddConnectionModal
              projectName={project.name}
              onClose={() => setModal(null)}
              onSave={addConnection}
              onStartMcp={startMcpConnection}
            />
          )}

          {modal === "key" && project && keyConnection && (
            <PublishableKeyModal
              project={project}
              connection={keyConnection}
              saved={!!savedKeys[keyConnection.id]}
              onClose={() => setModal(null)}
              onChanged={(saved) => {
                setSavedKeys((current) => ({ ...current, [keyConnection.id]: saved }));
                setProjects((current) => current.map((p) => p.id === project.id ? { ...p, connections: p.connections.map((c) => c.id === keyConnection.id ? { ...c, keySaved: saved } : c) } : p));
                setModal(null);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({ project, onView }: { project: Project; onView: (view: View) => void }) {
  return (
    <div className="page-stack">
      <PageTitle
        eyebrow="PROJECT OVERVIEW"
        title={project.name}
        description="Saved project details. No agent or service has been verified yet."
        action={
          <button className="secondary-button" onClick={() => onView("connections")}>
            <Icon name="link" /> Manage connections
          </button>
        }
      />

      <section className="proto-status-card panel">
        <div className="proto-status-icon">
          <Icon name="shield" />
        </div>
        <div className="proto-status-copy">
          <div className="status-label">
            <StatusDot tone="orange" /> Setup in progress
          </div>
          <h2>Connections are not verified</h2>
          <p>Project and service names are saved. Agent access and project identity checks are not connected yet.</p>
        </div>
        <div className="proto-status-meta">
          <span>Project identity</span>
          <strong>Not checked</strong>
          <span className="verified-text">
            <StatusDot tone="orange" /> Agent access: not connected
          </span>
        </div>
      </section>

      <div className="metric-grid">
        <Metric label="AGENT SESSIONS" value="0" detail="Not connected yet" icon="nodes" />
        <Metric label="SERVICE DETAILS" value={String(project.connections.length || 0)} detail="Not verified" icon="link" />
        <Metric label="GUARD" value="Off" detail="No agent integration" icon="shield" />
        <Metric label="LAST ACTIVITY" value="None" detail="No live activity" icon="activity" />
      </div>

      <div className="section-grid">
        <section className="panel workspace-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ACTIVE WORKSPACE</div>
              <h3>{project.path}</h3>
            </div>
            <button className="icon-button quiet"><Icon name="more" /></button>
          </div>
          <div className="workspace-details">
            <Detail label="REPOSITORY" value={project.repo} icon="external" />
            <Detail label="BRANCH" value={project.branch} />
            <Detail label="IDENTITY CHECK" value="Not yet connected" />
          </div>
          <div className="verified-banner">
            <StatusDot tone="orange" />
            <span><strong>Saved only.</strong> Nexus has not checked this folder.</span>
            <button onClick={() => onView("projects")}>
              View details <Icon name="arrow" />
            </button>
          </div>
        </section>

        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">RECENT ACTIVITY</div>
              <h3>No live activity yet</h3>
            </div>
            <button className="text-button" onClick={() => onView("activity")}>
              View all <Icon name="arrow" />
            </button>
          </div>
          <p className="empty-inline">Agent integration is not connected. Nothing is being monitored yet.</p>
        </section>
      </div>

      <section className="panel connections-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">SAVED SERVICES</div>
            <h3>Details for {project.name} (not verified)</h3>
          </div>
          <button className="text-button" onClick={() => onView("connections")}>
            View all <Icon name="arrow" />
          </button>
        </div>
        <div className="connection-list">
          {project.connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  return (
    <div className="metric-card">
      <span className="metric-icon"><Icon name={icon} /></span>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-detail">{detail}</div>
      </div>
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}{icon && <Icon name={icon} />}</span>
    </div>
  );
}

function ConnectionRow({ connection, keySaved, onSaveKey, onUnlock }: { connection: Connection; keySaved?: boolean; onSaveKey?: () => void; onUnlock?: () => void }) {
  const eligible = connection.provider === "Supabase" && !!connection.projectRef && !!connection.url;
  const methodLabel = connection.method === "mcp" ? "MCP · browser approval" : "Manual details";
  const connected = connection.authState === "connected";
  const saved = connection.keySaved || keySaved;
  const stateLabel = connected ? "Connected · approval saved" : connection.authState === "pending" ? "Authorization pending" : saved ? "Key saved · not verified" : "Not verified";

  return (
    <div className="connection-row">
      <span className={`service-avatar ${connection.tone}`}>{connection.short}</span>
      <span className="connection-name">
        <strong>{connection.provider}</strong>
        <small>{connection.detail}</small>
      </span>
      <span className="connection-target">
        {connection.target}
        <small className="connection-meta">{methodLabel}{connection.projectRef && ` · ref: ${connection.projectRef}`}</small>
      </span>
      <span className={`connection-state ${connected ? "connected" : "review"}`}>
        <StatusDot tone={connected ? "green" : "orange"} /> {stateLabel}
      </span>
      {onSaveKey && eligible && (
        <button
          className="text-button key-action"
          onClick={onUnlock ?? onSaveKey}
        >
          {onUnlock ? "Unlock vault" : keySaved ? "Manage key" : "Save key"}
        </button>
      )}
    </div>
  );
}

function ProjectsView({ projects, selectedProject, onSelect, onAdd }: { projects: Project[]; selectedProject: string; onSelect: (id: string) => void; onAdd: () => void }) {
  return (
    <div className="page-stack">
      <PageTitle
        eyebrow="WORKSPACE"
        title="Projects"
        description="Choose the project that Nexus should keep in context."
        action={
          <button className="primary-button" onClick={onAdd}>
            <Icon name="plus" /> Add project
          </button>
        }
      />
      <div className="project-card-grid">
        {projects.map((p) => (
          <button
            className={`project-card ${p.id === selectedProject ? "selected" : ""}`}
            key={p.id}
            onClick={() => onSelect(p.id)}
          >
            <span className="project-card-top">
              <span className="project-avatar large">{p.initials}</span>
              <span className="project-card-check">
                <StatusDot tone={p.id === selectedProject ? "green" : "muted"} />
                {p.id === selectedProject ? "Selected" : "Saved"}
              </span>
            </span>
            <strong>{p.name}</strong>
            <small>{p.path}</small>
            <span className="project-card-footer">
              <span>{p.connections.length} connections</span>
              <Icon name="arrow" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentsView({ project }: { project: Project }) {
  return (
    <div className="page-stack">
      <PageTitle
        eyebrow="WORKSPACE"
        title="Agent sessions"
        description="Agents will appear here once they are connected to Nexus."
      />
      <section className="empty-state panel">
        <div className="empty-icon"><Icon name="nodes" /></div>
        <h2>No agents connected</h2>
        <p>Connecting coding agents is a future step. Nexus is not monitoring {project.name} yet, and nothing here is enforced.</p>
      </section>
    </div>
  );
}

function ConnectionsView({ project, onAdd, vaultUnlocked, savedKeys, onSaveKey, onUnlock }: { project: Project; onAdd: () => void; vaultUnlocked: boolean; savedKeys: Record<string, boolean>; onSaveKey: (conn: Connection) => void; onUnlock: () => void }) {
  return (
    <div className="page-stack">
      <PageTitle
        eyebrow={`${project.name} · WORKSPACE`}
        title="Connections"
        description="Project details are saved. Service access is not connected to an agent yet."
        action={
          <button className="primary-button" onClick={onAdd}>
            <Icon name="plus" /> Add connection
          </button>
        }
      />
      <section className="panel connections-panel large-panel">
        <div className="connection-list">
          {project.connections.map((c) => (
            <ConnectionRow
              key={c.id}
              connection={c}
              keySaved={vaultUnlocked && !!savedKeys[c.id]}
              onSaveKey={() => onSaveKey(c)}
              onUnlock={!vaultUnlocked ? onUnlock : undefined}
            />
          ))}
        </div>
      </section>
      <div className="note-panel">
        <span className="note-icon"><Icon name="shield" /></span>
        <p>
          <strong>Not connected yet.</strong> Saving a publishable key does not verify your Supabase project or give agents access. Never enter a secret or service-role key here.
        </p>
      </div>
    </div>
  );
}

function GuardView({ project }: { project: Project }) {
  return (
    <div className="page-stack">
      <PageTitle
        eyebrow="MONITOR"
        title="Guard Decisions"
        description="Guard will check service requests once agents can use Nexus."
      />
      <section className="empty-state panel">
        <div className="empty-icon"><Icon name="shield" /></div>
        <h2>Guard is not active yet</h2>
        <p>Direct commands and service tools do not pass through Nexus today for {project.name}. Do not rely on this prototype to block wrong-project actions.</p>
      </section>
    </div>
  );
}

function ActivityView({ project }: { project: Project }) {
  return (
    <div className="page-stack">
      <PageTitle
        eyebrow="MONITOR"
        title="Activity Audit"
        description="Nexus will record the operations it actually handles."
      />
      <section className="empty-state panel">
        <div className="empty-icon"><Icon name="activity" /></div>
        <h2>No recorded activity</h2>
        <p>No agent is connected yet for {project.name}. Nexus does not track commands run outside the app.</p>
      </section>
    </div>
  );
}

function SettingsView({ projects, savedKeys, vaultUnlocked, onUnlocked, onLocked }: { projects: Project[]; savedKeys: Record<string, boolean>; vaultUnlocked: boolean; onUnlocked: () => void; onLocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setTimeout(() => {
      setBusy(false);
      if (password.length < 12) {
        setMessage("Vault password must have at least 12 characters.");
      } else {
        setPassword("");
        onUnlocked();
      }
    }, 400);
  }

  function lock() {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onLocked();
    }, 200);
  }

  return (
    <div className="page-stack">
      <PageTitle
        eyebrow="SYSTEM"
        title="Settings & Vault"
        description="Simulated OS keychain vault and system keychain (prototype only)."
      />
      <section className="panel vault-panel">
        <div className="eyebrow">ENCRYPTED DESKTOP VAULT (PROTOTYPE)</div>
        <h2>{vaultUnlocked ? "Vault is Unlocked" : "Unlock or Create Your Vault"}</h2>
        <p>
          {vaultUnlocked
            ? "Your vault is unlocked for this prototype session. Saving a key here does not verify the project or grant agents access."
            : "Enter a password with at least 12 characters to open the prototype vault. The real app uses the OS keychain."}
        </p>

        {!vaultUnlocked ? (
          <form className="modal-form" onSubmit={submit}>
            <label>
              Vault Password
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters (e.g. master-vault-demo-pass)"
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || password.length < 12}>
              {busy ? "Opening vault..." : "Unlock Vault"}
            </button>
            {message && <p className="form-error" role="alert">{message}</p>}
          </form>
        ) : (
          <div>
            <button className="secondary-button" disabled={busy} onClick={lock}>
              {busy ? "Locking..." : "Lock Vault"}
            </button>
            <p style={{ marginTop: "12px", color: "var(--green)", fontSize: "11px" }}>
              ✓ Prototype vault open. Keys here are not verified and grant no agent access.
            </p>
            <VaultItems projects={projects} savedKeys={savedKeys} />
          </div>
        )}
      </section>
    </div>
  );
}

function VaultItems({ projects, savedKeys }: { projects: Project[]; savedKeys: Record<string, boolean> }) {
  const items = projects.flatMap((p) => p.connections.flatMap((c) => {
    const publishable = c.provider === "Supabase" && (c.keySaved || savedKeys[c.id]);
    const mcp = c.authState === "connected";
    if (!publishable && !mcp) return [];
    return [{ project: p.name, service: c.provider, target: c.target, kind: publishable ? "Publishable key" : "MCP approval" }];
  }));

  return (
    <div className="vault-items">
      <div className="eyebrow">Stored items</div>
      {items.length === 0 ? (
        <p className="vault-empty">No keys or approvals are saved yet.</p>
      ) : (
        <div className="vault-item-list">
          {items.map((item) => (
            <div className="vault-item" key={`${item.project}-${item.service}-${item.kind}`}>
              <span className="vault-item-icon"><Icon name="shield" /></span>
              <span>
                <strong>{item.service} · {item.project}</strong>
                <small>{item.kind} · {item.target}</small>
              </span>
              <span className="vault-item-state"><StatusDot tone="green" /> Saved</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddProjectModal({ onClose, onSave, existingNames }: { onClose: () => void; onSave: (input: { name: string; path: string; repo: string; branch: string }) => void; existingNames: string[] }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const nameUsed = existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase());
  const canSave = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;

  return (
    <Modal title="Add a project" description="Tell Nexus where this project lives. You can add services after it is saved." onClose={onClose}>
      <form className="modal-form" onSubmit={(e) => { e.preventDefault(); if (canSave) onSave({ name: name.trim(), path: path.trim(), repo: repo.trim(), branch: branch.trim() }); }}>
        <label>
          Project name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Koupa" />
        </label>
        {nameUsed && <p className="form-error" role="alert">A project with this name already exists.</p>}
        <label>
          Project folder
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Projects/Koupa" />
        </label>
        <div className="form-row">
          <label>
            Git repository
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/you/koupa" />
          </label>
          <label>
            Branch
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </label>
        </div>
        <div className="modal-note">
          <Icon name="shield" />
          <span>Only project path and remote metadata are saved. No passwords required.</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={!canSave}>Save project</button>
        </div>
      </form>
    </Modal>
  );
}

function AddConnectionModal({
  projectName,
  onClose,
  onSave,
  onStartMcp,
}: {
  projectName: string;
  onClose: () => void;
  onSave: (input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string }) => void;
  onStartMcp?: (input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string }) => void;
}) {
  const [provider, setProvider] = useState("Supabase");
  const [method, setMethod] = useState<"choose" | "manual" | "mcp">("choose");
  const [target, setTarget] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [url, setUrl] = useState("");
  const [detail, setDetail] = useState("Database and services");
  const [tone, setTone] = useState<Connection["tone"]>("green");
  const [busy, setBusy] = useState(false);

  const isSupabase = provider === "Supabase";
  const canSave = provider.trim().length > 0 && target.trim().length > 0 && (!isSupabase || (projectRef.trim().length > 0 && url.trim().length > 0));

  function changeProvider(next: string) {
    setProvider(next);
    if (next === "Clerk") {
      setDetail("Authentication");
      setTone("violet");
    } else if (next === "GitHub") {
      setDetail("Repository access");
      setTone("blue");
    } else if (next === "Sentry") {
      setDetail("Error tracking");
      setTone("orange");
    } else {
      setDetail("Database and services");
      setTone("green");
    }
  }

  function handleSave(chosenMethod: "manual" | "mcp") {
    if (chosenMethod === "mcp" && onStartMcp) {
      setBusy(true);
      setTimeout(() => {
        setBusy(false);
        onStartMcp({
          provider: provider.trim(),
          target: target.trim(),
          detail: detail.trim(),
          tone,
          method: "mcp",
          authState: "pending",
          projectRef: projectRef.trim() || undefined,
          url: url.trim() || undefined,
        });
      }, 350);
      return;
    }

    onSave({
      provider: provider.trim(),
      target: target.trim(),
      detail: detail.trim(),
      tone,
      method: chosenMethod,
      authState: chosenMethod === "mcp" ? "pending" : "connected",
      projectRef: projectRef.trim() || undefined,
      url: url.trim() || undefined,
    });
  }

  return (
    <Modal title={`Add a connection to ${projectName}`} description="Choose how Nexus should connect to this service." onClose={onClose}>
      <div className="modal-form">
        <label>
          Service
          <select value={provider} onChange={(e) => changeProvider(e.target.value)}>
            <option>Supabase</option>
            <option>Clerk</option>
            <option>GitHub</option>
            <option>Sentry</option>
            <option>Convex</option>
            <option>Other</option>
          </select>
        </label>

        {method === "choose" ? (
          <div className="method-choice-grid">
            <button type="button" className="method-card" onClick={() => setMethod("manual")}>
              <span className="method-card-icon"><Icon name="settings" /></span>
              <strong>Add manually</strong>
              <small>Enter the project details and save a key in the desktop vault.</small>
              <span className="method-card-link">Choose manual <Icon name="arrow" /></span>
            </button>
            <button type="button" className="method-card" onClick={() => setMethod("mcp")}>
              <span className="method-card-icon mcp"><Icon name="nodes" /></span>
              <strong>Connect with MCP</strong>
              <small>Sign in in your browser and approve access for this service.</small>
              <span className="method-card-link">Choose MCP <Icon name="arrow" /></span>
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="back-method" onClick={() => setMethod("choose")}>
              ← Choose another method
            </button>
            <label>
              {isSupabase ? "Display name" : "Project or account name"}
              <input autoFocus value={target} onChange={(e) => setTarget(e.target.value)} placeholder={isSupabase ? "koupa-development" : "For example, koupa-auth"} />
            </label>
            {isSupabase && (
              <div className="form-row">
                <label>
                  Project reference
                  <input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="abcdefghijklmnop" />
                </label>
                <label>
                  Project URL
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://...supabase.co" />
                </label>
              </div>
            )}
            <div className="form-row">
              <label>
                What it provides
                <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Database · Auth" />
              </label>
              <label>
                Color
                <select value={tone} onChange={(e) => setTone(e.target.value as Connection["tone"])}>
                  <option value="green">Green</option>
                  <option value="violet">Violet</option>
                  <option value="blue">Blue</option>
                  <option value="orange">Orange</option>
                </select>
              </label>
            </div>
            {method === "mcp" ? (
              <div className="mcp-flow-note">
                <div className="mcp-flow-title">
                  <span className="method-card-icon mcp"><Icon name="nodes" /></span>
                  <strong>Browser approval</strong>
                </div>
                <p>Nexus will open Supabase in your browser, let you sign in, and ask you to approve access. The approval is stored in the desktop vault.</p>
                <ol>
                  <li>Sign in to the service</li>
                  <li>Choose the right project</li>
                  <li>Approve Nexus access</li>
                </ol>
              </div>
            ) : (
              <div className="modal-note">
                <Icon name="shield" />
                <span>Only project details are saved now. Secret keys are never saved in the browser.</span>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="primary-button" disabled={!canSave || busy} onClick={() => handleSave(method)}>
                {busy ? "Opening browser..." : method === "mcp" ? "Connect in browser" : "Save project details"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PublishableKeyModal({ project, connection, saved, onClose, onChanged }: { project: Project; connection: Connection; saved: boolean; onClose: () => void; onChanged: (saved: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setTimeout(() => {
      setBusy(false);
      if (!value.trim().startsWith("sb_publishable_")) {
        setMessage("Use a Supabase publishable key starting with sb_publishable_");
      } else {
        setValue("");
        onChanged(true);
      }
    }, 300);
  }

  function remove() {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onChanged(false);
    }, 200);
  }

  return (
    <Modal title={`Publishable key for ${connection.target}`} description={`Project: ${project.name}. Saved only in your local desktop vault.`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          Supabase publishable key
          <input
            type="password"
            autoFocus
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sb_publishable_demo_test_key"
          />
        </label>
        <div className="modal-note">
          <Icon name="shield" />
          <span>Do not enter a secret key, service-role key, or personal access token. Only publishable keys are brokered.</span>
        </div>
        {message && <p className="form-error" role="alert">{message}</p>}
        <div className="modal-actions">
          {saved && (
            <button type="button" className="secondary-button danger" disabled={busy} onClick={remove}>
              Remove key
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy || !value.trim().startsWith("sb_publishable_")}>
            {busy ? "Saving..." : saved ? "Replace key" : "Save key"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Local workspace</div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="icon-button quiet" onClick={onClose} aria-label="Close">
            <span className="close-mark">×</span>
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

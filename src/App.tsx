import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { desktopAvailable, hasPublishableKey, listSupabaseProjects, removeMcpTokens, removePublishableKey, saveMcpTokens } from "./vault";
import { initialsFor, loadAccounts, loadProjects, makeAccountId, makeId, manifestAccountFor, PROVIDER_CATALOG, remoteServiceUrl, serviceSlug, setCustomServices, type CustomService, saveAccounts, saveProjects, starterAccounts, starterProjects, type Account, type Connection, type Project } from "./store";
import { accountGroupKey, detectBlastRadius } from "./accounts";
import { HomeView } from "./home";
import { type PendingLinkRequest } from "./topology";
import { ThemeButton, initTheme } from "./onboarding";
import { useAuditLog } from "./app/audit";
import { FirstRun } from "./views/FirstRun";
import { ProjectPage } from "./views/ProjectPage";
import { ConnectionsPage } from "./views/ConnectionsPage";
import { Button } from "@heroui/react";
import { AppShell, Badge, Icon as NxIcon, Notice, type NavItem } from "./ui";
import { type View, type NavTarget, type ProjectTab, type ConnectionsTab, type ErrorRetry, type ErrorRecord } from "./app/types";
import { GUARD_VISIBLE } from "./app/styles";
import { errorIdentity, loadErrorLog } from "./app/errors";
import { Overview } from "./views/OverviewView";
import { AgentsView } from "./views/AgentsView";
import { BindingsView } from "./views/BindingsView";
import { ServicesView } from "./views/ServicesView";
import { GuardView } from "./views/GuardView";
import { ActivityView } from "./views/ActivityView";
import { SettingsView } from "./views/SettingsView";
import { AddProjectModal } from "./modals/AddProjectModal";
import { EditProjectModal } from "./modals/EditProjectModal";
import { AddConnectionModal } from "./modals/AddConnectionModal";
import { PublishableKeyModal } from "./modals/PublishableKeyModal";
import { ConnectAgentModal } from "./modals/ConnectAgentModal";
import "./App.css";

function App() {
  const [view, setView] = useState<View>("home");
  const [projectTab, setProjectTab] = useState<ProjectTab>("status");
  const [connectionsTab, setConnectionsTab] = useState<ConnectionsTab>("accounts");
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [selectedProject, setSelectedProject] = useState(() => window.localStorage.getItem("nexus-guard.selected-project") ?? "koupa");
  const [linkDraft, setLinkDraft] = useState<{ projectId: string; provider: string; accountId?: string } | null>(null);
  const [linkPrefill, setLinkPrefill] = useState<{ provider: string; accountId?: string } | null>(null);
  const [modal, setModal] = useState<"project" | "connection" | "key" | "edit-project" | "agent" | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try { return !window.localStorage.getItem("nexus-guard.onboarded"); } catch { return false; }
  });
  const [agentTarget, setAgentTarget] = useState<{ projectId: string; agentId: string | null } | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [keyConnection, setKeyConnection] = useState<Connection | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [errorLog, setErrorLog] = useState<ErrorRecord[]>(loadErrorLog);
  const [osUser, setOsUser] = useState("Local");
  // Lookups made in the same tick as a new account (add-binding creates one inline) must see it.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const project = useMemo(() => projects.find((item) => item.id === selectedProject || item.name === selectedProject) ?? projects[0], [projects, selectedProject]);
  // Setup counts as done once any agent has called Nexus. A skipped setup resumes at the agent step for the selected real project.
  const { entries: auditEntries, loaded: auditLoaded } = useAuditLog(projects);
  const setupIncomplete = auditLoaded && !auditEntries.some((entry) => entry.agent);
  const resumeProject = project && setupIncomplete && !starterProjects.some((item) => item.id === project.id) ? project : null;

  // Theme ownership lives in onboarding.tsx (initTheme/ThemeToggle):
  // apply the stored/OS choice once at boot. First paint is already
  // covered by index.html's inline script; this keeps runtime state in sync.
  useEffect(() => { initTheme(); }, []);

  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => saveAccounts(accounts), [accounts]);
  useEffect(() => {
    try { window.localStorage.setItem("nexus-guard.errors", JSON.stringify(errorLog.slice(-20))); } catch { /* ignore */ }
  }, [errorLog]);

  /** User-safe debug tag for the Activity log: error name/code only, never the
   *  message (it can echo paths or input) and never secrets or tokens. The
   *  full value still goes to console.error for local debugging. */
  function errorDebug(error: unknown): string | undefined {
    if (error instanceof Error) {
      const code = (error as Error & { code?: unknown }).code;
      const suffix = typeof code === "string" || typeof code === "number" ? ` [${String(code)}]` : "";
      return `${error.name}${suffix}`;
    }
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" || typeof code === "number") return `InvokeError [${String(code)}]`;
    }
    return undefined;
  }

  function reportError(where: string, error: unknown, retry?: ErrorRetry) {
    const message =
      where === "Saving project file" || where === "Linking Supabase project"
        ? "Nexus could not write the project file. Check the folder still exists and is writable, then retry."
        : where === "Removing binding"
          ? "The project file still lists this connection. Retry to finish removing it."
          : "Something failed. Try again, and check Activity if it keeps happening.";
    console.error(`[nexus] ${where}`, error);
    setErrorLog((current) => [...current.slice(-19), { id: makeId("error"), ts: new Date().toISOString(), where, message, debug: errorDebug(error), retry }]);
    return message;
  }

  useEffect(() => {
    if (!desktopAvailable()) return;
    invoke<string>("current_user").then((name) => { if (name) setOsUser(name); }).catch(() => undefined);
  }, []);
  useEffect(() => { if (project?.id) window.localStorage.setItem("nexus-guard.selected-project", project.id); }, [project]);

  // Saved-key badges are verified per vault session, never trusted from
  // storage: locking clears them, unlocking re-checks the keychain and
  // reconciles the persisted `keySaved` flags so a key deleted outside the
  // app stops badging as saved. Scoped to the lock/unlock transition (not
  // the projects array) so keystroke saves don't re-hit the keychain.
  // Note: vault.ts keeps its gate in memory, so any reload starts locked.
  useEffect(() => {
    if (!vaultUnlocked) { setSavedKeys({}); return; }
    let cancelled = false;
    const snapshot = projects;
    Promise.all(snapshot.flatMap((item) => item.connections.filter((connection) => connection.provider === "Supabase").map(async (connection) => [connection.id, await hasPublishableKey(item.id, connection.id)] as const)))
      .then((entries) => {
        if (cancelled) return;
        setSavedKeys(Object.fromEntries(entries));
        const verified = new Set(entries.filter(([, saved]) => saved).map(([id]) => id));
        setProjects((current) => {
          let changed = false;
          const next = current.map((item) => {
            let connsChanged = false;
            const conns = item.connections.map((c) => {
              if (c.provider !== "Supabase" || !c.keySaved || verified.has(c.id)) return c;
              connsChanged = true;
              return { ...c, keySaved: false };
            });
            if (!connsChanged) return item;
            changed = true;
            return { ...item, connections: conns };
          });
          return changed ? next : current;
        });
      })
      .catch(() => { if (!cancelled) setSavedKeys({}); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultUnlocked]);

  function openConnectAgent(projectId: string, agentId: string | null) {
    setAgentTarget({ projectId, agentId });
    setModal("agent");
  }

  function openEditProject(item: Project) {
    setEditingProject(item);
    setModal("edit-project");
  }

  function openKeyModal(connection: Connection) {
    setKeyConnection(connection);
    setModal("key");
  }

  function selectProject(id: string) {
    setSelectedProject(id);
    navigate("overview");
  }

  function dismissOnboarding() {
    try { window.localStorage.setItem("nexus-guard.onboarded", "1"); } catch { /* ignore */ }
    setOnboardingOpen(false);
  }

  function addProject(input: { name: string; path: string; repo: string; branch: string; environment?: string; binding?: { provider: string; accountId: string; resource: string } }, options?: { stay?: boolean }): string | null {
    if (projects.some((item) => item.name.toLowerCase() === input.name.toLowerCase())) return null;
    const branch = input.branch || "main";
    const environment = input.environment || (branch === "main" ? "production" : "development");
    const accountEntry = input.binding ? accounts.find((a) => a.id === input.binding!.accountId) : undefined;
    const newProject: Project = {
      id: makeId("project"),
      name: input.name,
      initials: initialsFor(input.name),
      path: input.path,
      branch,
      repo: input.repo || "Not connected",
      environment,
      lastSeen: "Added just now",
      connections: input.binding ? [{
        id: makeId("connection"),
        provider: input.binding.provider,
        short: initialsFor(input.binding.provider),
        target: input.binding.resource,
        resource: input.binding.resource,
        accountId: input.binding.accountId,
        account: accountEntry?.label ?? input.binding.accountId,
        environment,
        detail: "Resource",
        tone: "blue",
        state: "Needs review",
        method: "manual",
        authState: "not_connected",
        keySaved: false,
      }] : [],
    };
    setProjects((current) => [...current, newProject]);
    setSelectedProject(newProject.id);
    if (!options?.stay) { navigate("overview"); setModal(null); }
    // Manifest sync (paper: discovery != registration — local create is not
    // on-disk until the project file is written). Runs async; the local
    // create above is already done so the UI never blocks on the backend.
    void (async () => {
      if (!desktopAvailable()) return;
      try {
        const inspection = await invoke<{ exists: boolean; is_dir: boolean }>("inspect_project_folder", { workspacePath: newProject.path });
        if (!inspection.exists || !inspection.is_dir) {
          if (!window.confirm(`Project folder “${newProject.path}” does not exist yet. Create it now?`)) {
            setNotice("Project saved here. Its folder does not exist yet — create it, then check the project file on the Project page so agents resolve it.");
            return;
          }
          await invoke<string>("create_project_folder", { workspacePath: newProject.path });
        }
      } catch {
        // Inspection failure is non-fatal: the local project still exists.
        // Disk sync below will surface its own error if the folder is bad.
      }
      const first = newProject.connections[0];
      if (!first) {
        // Connection-less registration: writes (or upgrades)
        // .nexus/project.json with identity + environment and no connections,
        // so agents resolve the folder immediately. Binding a service later
        // merges into the same file via write_nexus_project_file.
        try {
          const filePath = await invoke<string>("register_nexus_project", {
            workspacePath: newProject.path,
            projectId: newProject.id,
            projectName: newProject.name,
            environment: newProject.environment,
            repo: newProject.repo && newProject.repo !== "Not connected" ? newProject.repo : null,
            branch: newProject.branch ?? null,
          });
          setNotice(`Saved the safe Nexus project file at ${filePath}. Add a binding from the Project page to attach a resource.`);
        } catch (error) {
          reportError("Saving project file", error);
          setNotice("Project saved here, but Nexus could not write the project file. Check the folder still exists and is writable, then check the project file on the Project page.");
        }
        return;
      }
      try {
        const filePath = await syncNexusProjectFile(newProject, first);
        if (filePath) setNotice(`Saved the safe Nexus project file at ${filePath}.`);
      } catch (error) {
        reportError("Saving project file", error, { kind: "write-file", projectId: newProject.id, connectionId: first.id });
        setNotice("Project saved here, but Nexus could not write the project file. Check the folder still exists and is writable, then retry from Activity.");
      }
    })();
    return newProject.id;
  }

  function updateProject(projectId: string, patch: { name: string; path: string; repo: string; branch: string; environment: string }) {
    if (projects.some((item) => item.id !== projectId && item.name.toLowerCase() === patch.name.toLowerCase())) return;
    const old = projects.find((item) => item.id === projectId);
    if (!old) return;
    // Paper: branch/workspace/manifest edits need dev confirm. Diff old vs
    // patch so the confirm shows exactly what changes.
    const diffLines: string[] = [];
    if (old.name !== patch.name) diffLines.push(`name: “${old.name}” → “${patch.name}”`);
    if (old.path !== patch.path) diffLines.push(`folder: “${old.path}” → “${patch.path}”`);
    if ((old.repo || "Not connected") !== (patch.repo || "Not connected")) diffLines.push(`repo: “${old.repo}” → “${patch.repo || "Not connected"}”`);
    if (old.branch !== (patch.branch || "main")) diffLines.push(`branch: “${old.branch}” → “${patch.branch || "main"}”`);
    if (old.environment !== patch.environment) diffLines.push(`environment: “${old.environment}” → “${patch.environment}”`);
    if (diffLines.length === 0) { setModal(null); return; }
    if (!window.confirm(`Update project “${old.name}”?\n\n${diffLines.join("\n")}\n\nAgents resolve the on-disk file until re-saved — re-check the project file on the Project page afterwards.`)) return;
    const updated: Project = { ...old, name: patch.name, initials: initialsFor(patch.name), path: patch.path, repo: patch.repo || "Not connected", branch: patch.branch || "main", environment: patch.environment, lastSeen: "Updated just now" };
    setProjects((current) => current.map((item) => item.id === projectId ? updated : item));
    setModal(null);
    setNotice("Project updated. Re-check the project file on the Project page so agents resolve the new details.");
    // Best-effort manifest re-sync for the new workspace details.
    void (async () => {
      if (!desktopAvailable()) return;
      const first = updated.connections[0];
      if (!first) return;
      try {
        await syncNexusProjectFile(updated, first);
      } catch (error) {
        reportError("Saving project file", error, { kind: "write-file", projectId: updated.id, connectionId: first.id });
      }
    })();
  }

  async function removeProject(projectId: string) {
    const target = projects.find((item) => item.id === projectId);
    if (!target) return;
    if (projects.length <= 1) {
      setNotice("Keep at least one project. Edit it instead of removing the last one.");
      return;
    }
    if (!window.confirm(`Remove project “${target.name}” from Nexus? Its ${target.connections.length} saved approval${target.connections.length === 1 ? "" : "s"} will also be deleted from this desktop vault.`)) return;
    for (const connection of target.connections) {
      await removeMcpTokens(projectId, connection.id, connection.provider).catch(() => undefined);
      await invoke("set_write_grant", { projectId, connectionId: connection.id, allowed: false }).catch(() => undefined);
      await invoke("set_binding_scope", { projectId, connectionId: connection.id, value: null }).catch(() => undefined);
    await invoke("set_binding_scope", { projectId, connectionId: connection.id, value: null }).catch(() => undefined);
    }
    const remaining = projects.filter((item) => item.id !== projectId);
    setProjects(remaining);
    if (selectedProject === projectId) setSelectedProject(remaining[0].id);
    setNotice(`Project ${target.name} removed, approvals deleted from this vault. Its folders on disk are untouched.`);
  }

  function updateConnection(projectId: string, connectionId: string, patch: { target: string; detail: string; tone: Connection["tone"]; projectRef?: string; url?: string; accountId?: string }) {
    const owner = projects.find((item) => item.id === projectId);
    const old = owner?.connections.find((c) => c.id === connectionId);
    if (!owner || !old) return;
    const cleared = patch.accountId === "";
    const accountEntry = !cleared && patch.accountId ? accounts.find((a) => a.id === patch.accountId) : undefined;
    const nextAccountId = cleared ? undefined : (accountEntry?.id ?? old.accountId);
    const nextAccount = cleared ? undefined : (accountEntry ? (accountEntry.label ?? accountEntry.id) : old.account);
    // Paper: manifest edits need dev confirm. Diff old vs patch first.
    const diffLines: string[] = [];
    if (old.target !== patch.target) diffLines.push(`display name: “${old.target}” → “${patch.target}”`);
    if ((old.resource ?? old.target) !== patch.target && old.method !== "mcp") diffLines.push(`resource: “${old.resource ?? old.target}” → “${patch.target}”`);
    if (old.detail !== (patch.detail || old.detail)) diffLines.push(`provides: “${old.detail}” → “${patch.detail}”`);
    if (old.tone !== patch.tone) diffLines.push(`color: “${old.tone}” → “${patch.tone}”`);
    if ((old.projectRef ?? "") !== (patch.projectRef ?? "")) diffLines.push(`project ref: “${old.projectRef ?? "—"}” → “${patch.projectRef ?? "—"}”`);
    if ((old.url ?? "") !== (patch.url ?? "")) diffLines.push(`url: “${old.url ?? "—"}” → “${patch.url ?? "—"}”`);
    if ((old.accountId ?? old.account ?? "") !== (patch.accountId ?? "")) diffLines.push(`account: “${old.accountId ?? old.account ?? "Not linked"}” → “${patch.accountId || "Not linked"}”`);
    if (diffLines.length === 0) { setModal(null); return; }
    if (!window.confirm(`Update ${old.provider} binding “${old.target}”?\n\n${diffLines.join("\n")}\n\nAgents resolve the on-disk file until re-saved.`)) return;
    const updatedConnection: Connection = { ...old, target: patch.target, resource: old.method === "mcp" ? old.resource : patch.target, detail: patch.detail, tone: patch.tone, projectRef: old.method === "mcp" ? old.projectRef : patch.projectRef, url: old.method === "mcp" ? old.url : patch.url, accountId: nextAccountId, account: nextAccount };
    setProjects((current) => current.map((item) => item.id === projectId
      ? { ...item, connections: item.connections.map((c) => c.id === connectionId ? updatedConnection : c) }
      : item));
    setModal(null);
    setNotice("Binding updated. Nexus re-saved the on-disk project file.");
    void (async () => {
      if (!desktopAvailable()) return;
      try {
        await syncNexusProjectFile({ ...owner, connections: owner.connections.map((c) => c.id === connectionId ? updatedConnection : c) }, updatedConnection);
      } catch (error) {
        reportError("Saving project file", error, { kind: "write-file", projectId, connectionId });
        setNotice("Updated here, but Nexus could not re-save the project file. Retry from Activity.");
      }
    })();
  }

  async function syncNexusProjectFile(owner: Project, connection: Connection, status = connection.authState ?? "not_connected") {
    if (!desktopAvailable()) return null;
    // Canonical duality (store.ts): accountId is the stable registry id,
    // account is the display label. The backend accepts either side and
    // persists both, so send both.
    const manifested = manifestAccountFor(connection, accounts);
    return invoke<string>("write_nexus_project_file", {
      workspacePath: owner.path,
      projectId: owner.id,
      projectName: owner.name,
      provider: connection.provider,
      target: connection.target,
      projectRef: connection.projectRef ?? null,
      connectionId: connection.id,
      method: connection.method ?? "manual",
      status,
      environment: owner.environment ?? "development",
      repo: owner.repo && owner.repo !== "Not connected" ? owner.repo : null,
      branch: owner.branch ?? null,
      account: manifested.account ?? connection.account ?? null,
      accountId: manifested.accountId ?? connection.accountId ?? null,
    });
  }

  function addConnection(input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string; accountId?: string }) {
    if (!project) return;
    const accountEntry = accountsRef.current.find((a) => a.id === input.accountId && a.provider.toLowerCase() === input.provider.toLowerCase());
    const accountId = accountEntry?.id;
    const accountLabel = accountEntry?.label;
    const newConnection: Connection = {
      id: makeId("connection"),
      provider: input.provider,
      short: initialsFor(input.provider),
      target: input.target,
      resource: input.target,
      accountId,
      account: accountLabel ?? accountId,
      environment: project.environment ?? "development",
      detail: input.detail || "Resource",
      tone: input.tone,
      state: "Needs review",
      method: input.method,
      authState: input.authState,
      keySaved: false,
      projectRef: input.projectRef,
      url: input.url,
    };
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, connections: [...item.connections, newConnection] } : item));
    setModal(null);
    const owner = project;
    void syncNexusProjectFile(owner, newConnection).then((filePath) => {
      if (filePath) setNotice(`Saved the safe Nexus project file at ${filePath}.`);
    }).catch((error) => { reportError("Saving project file", error, { kind: "write-file", projectId: owner.id, connectionId: newConnection.id }); setNotice("Binding saved, but Nexus could not write the project file. Check the folder still exists and is writable, then retry from Activity."); });
  }

  /** Retry a kept failure from the Activity error log. */
  async function retryError(record: ErrorRecord) {
    // Capture everything up front: the selected project may change while the
    // retry's Tauri call is in flight, so never re-read it afterwards.
    const retry = record.retry;
    if (!retry) return;
    const retryProjectId = retry.projectId;
    const retryConnectionId = retry.connectionId;
    const retryKind = retry.kind;
    const target = projects.find((item) => item.id === retryProjectId);
    const connection = target?.connections.find((c) => c.id === retryConnectionId);
    if (!target || !connection) {
      setNotice("That binding is gone, so there is nothing to retry. The error is kept for reference.");
      return;
    }
    if (retryKind === "remove") {
      await removeConnection(connection, target, true);
      return;
    }
    // write-file / link: re-run the project-file write for the kept connection.
    setNotice("");
    try {
      const manifested = manifestAccountFor(connection, accounts);
      const filePath = await invoke<string>("write_nexus_project_file", {
        workspacePath: target.path,
        projectId: target.id,
        projectName: target.name,
        provider: connection.provider,
        target: connection.target,
        projectRef: connection.projectRef ?? null,
        connectionId: connection.id,
        method: connection.method ?? "manual",
        status: connection.authState ?? "not_connected",
        environment: target.environment ?? "development",
        repo: target.repo && target.repo !== "Not connected" ? target.repo : null,
        branch: target.branch ?? null,
        account: manifested.account ?? connection.account ?? null,
        accountId: manifested.accountId ?? connection.accountId ?? null,
      });
      setNotice(`Retried. Nexus wrote ${filePath}.`);
      // Remove only this exact record: filtering by timestamp alone drops
      // distinct errors that landed in the same millisecond.
      setErrorLog((current) => current.filter((entry) => errorIdentity(entry) !== errorIdentity(record)));
    } catch (error) {
      setNotice(reportError(record.where, error, retry));
    }
  }

  type McpOAuthTokens = { accessToken: string; refreshToken?: string; scope?: string };
  type SupabaseChoice = { ref: string; name: string; region?: string | null; organization_name?: string | null };

  /** Backend detail is never shown — surface the plain fallback with its next step. */
  function commandMessage(_error: unknown, fallback: string): string {
    return fallback;
  }

  // Abort handle + pending-connection pointer for the in-flight browser
  // approval. If the modal closes or unmounts mid-poll, aborting drives the
  // authorize catch below, which removes the pending connection — the cancel
  // path always runs, never leaving a stray "pending" binding.
  const mcpPollAbort = useRef<AbortController | null>(null);
  const pendingMcp = useRef<{ projectId: string; connectionId: string } | null>(null);

  function abortMcpAuthorize() {
    mcpPollAbort.current?.abort();
  }

  async function pollMcpOAuth(signal?: AbortSignal): Promise<McpOAuthTokens> {
    function cancelledError(): Error {
      const error = new Error("The browser approval was cancelled.");
      error.name = "AbortError";
      return error;
    }
    type OAuthResult = { success: boolean; access_token?: string; refresh_token?: string; scope?: string; error?: string };
    for (let attempt = 0; attempt < 360; attempt += 1) {
      if (signal?.aborted) throw cancelledError();
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (signal?.aborted) throw cancelledError();
      const result = await invoke<OAuthResult | null>("poll_supabase_mcp_oauth");
      if (result) {
        if (!result.success || !result.access_token) throw new Error("The browser approval timed out. Start again and approve within a few minutes.");
        return { accessToken: result.access_token, refreshToken: result.refresh_token, scope: result.scope };
      }
    }
    throw new Error("The browser approval timed out. Start again and approve within a few minutes.");
  }

  // ---- Services the user added themselves (a name and an MCP address) ----
  const [customServices, setCustomServiceState] = useState<CustomService[]>([]);
  async function refreshCustomServices() {
    if (!desktopAvailable()) return;
    const list = await invoke<CustomService[]>("list_custom_services").catch(() => [] as CustomService[]);
    setCustomServices(list);
    setCustomServiceState(list);
  }
  useEffect(() => { void refreshCustomServices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCustomService(name: string, mcpUrl: string): Promise<void> {
    if (!desktopAvailable()) throw new Error("Open the desktop app to add a service.");
    try {
      await invoke("add_custom_service", { name, mcpUrl });
    } catch (error) {
      throw new Error(githubText(error, "Could not add this service. Check the name and address, then try again."));
    }
    await refreshCustomServices();
    setNotice(`${name} added. Link an account and add a binding to sign in to it.`);
  }

  async function removeCustomService(entry: CustomService) {
    const using = projects.filter((item) => item.connections.some((c) => c.provider.toLowerCase() === entry.slug));
    if (!window.confirm(`Remove ${entry.name} from Nexus?${using.length ? `\n\nIt is bound in ${using.map((item) => item.name).join(", ")}. Those bindings will stop working until you add the service again.` : ""}`)) return;
    await invoke("remove_custom_service", { slug: entry.slug }).catch(() => undefined);
    await refreshCustomServices();
    setNotice(`${entry.name} removed.`);
  }

  // ---- Any other service on the launch list: sign in with its own remote MCP server ----

  /** Sign in to a service, then save the binding. Rejects with a plain-language message; cancelling
   *  or failing removes the pending binding and anything saved for it. */
  async function connectRemoteService(provider: string, accountId: string | undefined, signal: AbortSignal): Promise<void> {
    const url = remoteServiceUrl(provider);
    if (!url) throw new Error(`${provider} cannot be connected this way yet.`);
    if (!project) throw new Error("No project is selected. Select a project before connecting.");
    if (!desktopAvailable()) throw new Error("Open the desktop app to connect a service.");
    const owner = project;
    const slug = serviceSlug(provider);
    const name = PROVIDER_CATALOG.find((entry) => entry.provider.toLowerCase() === slug)?.provider ?? provider;
    const accountEntry = accountId ? accountsRef.current.find((a) => a.id === accountId) : undefined;
    const pending: Connection = {
      id: makeId("connection"),
      provider: name,
      short: initialsFor(name),
      target: name,
      resource: name,
      accountId: accountEntry?.id,
      account: accountEntry?.label ?? accountEntry?.id,
      environment: owner.environment ?? "development",
      detail: "Whole account",
      tone: "blue",
      state: "Needs review",
      method: "mcp",
      authState: "pending",
    };
    setProjects((current) => current.map((item) => item.id === owner.id ? { ...item, connections: [...item.connections, pending] } : item));
    const cleanUp = async () => {
      await invoke("cancel_mcp_oauth").catch(() => undefined);
      await removeMcpTokens(owner.id, pending.id, slug).catch(() => undefined);
      setProjects((current) => current.map((item) => item.id === owner.id ? { ...item, connections: item.connections.filter((c) => c.id !== pending.id) } : item));
    };
    try {
      const started = await invoke<{ authorization_url: string }>("start_mcp_oauth", { serverUrl: url, service: slug, projectId: owner.id, connectionId: pending.id }).catch((error) => {
        throw new Error(githubText(error, `Could not start the ${name} sign-in. Try again.`));
      });
      await openUrl(started.authorization_url);
      for (let attempt = 0; attempt < 860; attempt += 1) {
        if (signal.aborted) { const cancelled = new Error(`The ${name} sign-in was cancelled.`); cancelled.name = "AbortError"; throw cancelled; }
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const result = await invoke<{ success: boolean; error?: string | null } | null>("poll_mcp_oauth");
        if (!result) continue;
        if (!result.success) throw new Error(result.error || `${name} did not complete the sign-in. Try again.`);
        const connected: Connection = { ...pending, authState: "connected" };
        setProjects((current) => current.map((item) => item.id === owner.id ? { ...item, connections: item.connections.map((c) => c.id === pending.id ? connected : c) } : item));
        setModal(null);
        try {
          const filePath = await syncNexusProjectFile(owner, connected, "connected");
          setNotice(`${name} is connected${connected.account ? ` as “${connected.account}”` : ""}. ${filePath ? `Nexus wrote ${filePath}. ` : ""}It can read your whole ${name} account; anything that changes data needs your approval.`);
        } catch (error) {
          reportError(`Linking ${name}`, error, { kind: "link", projectId: owner.id, connectionId: pending.id });
          setNotice("Connected, but Nexus could not write the project file. Check the folder still exists and is writable, then retry from Activity.");
        }
        return;
      }
      throw new Error(`The ${name} sign-in timed out. Start again and approve within a few minutes.`);
    } catch (error) {
      await cleanUp();
      throw error;
    }
  }

  // ---- GitHub: the user approves Nexus with their own GitHub account (device flow) ----
  const [githubStatus, setGithubStatus] = useState<{ configured: boolean; install_url?: string | null }>({ configured: false });
  useEffect(() => {
    if (!desktopAvailable()) return;
    invoke<{ configured: boolean; install_url?: string | null }>("github_status").then(setGithubStatus).catch(() => undefined);
  }, []);

  type GithubRepoChoice = { full_name: string; private: boolean };
  const githubText = (error: unknown, fallback: string) => (typeof error === "string" && error ? error : fallback);

  /** Step 1: ask GitHub for a code and open its approval page. Adds a pending binding that cancel or failure removes. */
  async function githubStart(): Promise<{ connectionId: string; userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresIn: number }> {
    if (!project) throw new Error("No project is selected. Select a project before connecting.");
    if (!desktopAvailable()) throw new Error("Open the desktop app to connect GitHub.");
    const owner = project;
    let flow: { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
    try {
      flow = await invoke("start_github_device_flow");
    } catch (error) {
      throw new Error(githubText(error, "Could not start the GitHub sign-in. Try again."));
    }
    const connection: Connection = {
      id: makeId("connection"),
      provider: "GitHub",
      short: "GH",
      target: "GitHub",
      resource: "GitHub",
      environment: owner.environment ?? "development",
      detail: "Code and issues",
      tone: "blue",
      state: "Needs review",
      method: "mcp",
      authState: "pending",
    };
    setProjects((current) => current.map((item) => item.id === owner.id ? { ...item, connections: [...item.connections, connection] } : item));
    pendingMcp.current = { projectId: owner.id, connectionId: connection.id };
    await openUrl(flow.verification_uri).catch(() => undefined);
    return { connectionId: connection.id, userCode: flow.user_code, verificationUri: flow.verification_uri, deviceCode: flow.device_code, interval: flow.interval, expiresIn: flow.expires_in };
  }

  async function githubDropPending(projectId: string, connectionId: string) {
    await removeMcpTokens(projectId, connectionId, "github").catch(() => undefined);
    setProjects((current) => current.map((item) => item.id === projectId ? { ...item, connections: item.connections.filter((c) => c.id !== connectionId) } : item));
    if (pendingMcp.current?.connectionId === connectionId) pendingMcp.current = null;
  }

  /** Step 2: wait for the user to approve, then list the repositories the Nexus GitHub App can see. */
  async function githubWait(start: { connectionId: string; deviceCode: string; interval: number; expiresIn: number }, signal: AbortSignal): Promise<{ login: string | null; repos: GithubRepoChoice[] }> {
    const projectId = pendingMcp.current?.projectId ?? project?.id ?? "";
    let wait = Math.max(1, start.interval);
    const deadline = Date.now() + start.expiresIn * 1000;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, wait * 1000));
        if (signal.aborted) { const cancelled = new Error("The GitHub approval was cancelled."); cancelled.name = "AbortError"; throw cancelled; }
        let result: { status: string; login?: string | null };
        try {
          result = await invoke("poll_github_device_flow", { deviceCode: start.deviceCode, projectId, connectionId: start.connectionId });
        } catch (error) {
          throw new Error(githubText(error, "Could not finish the GitHub sign-in. Try again."));
        }
        if (result.status === "slow_down") wait += 5;
        if (result.status === "denied") throw new Error("GitHub approval was declined. Start again if that was a mistake.");
        if (result.status === "expired") throw new Error("The GitHub code expired. Start again and approve within a few minutes.");
        if (result.status === "done") {
          const repos = await githubRepos(start.connectionId, projectId).catch(() => [] as GithubRepoChoice[]);
          return { login: result.login ?? null, repos };
        }
      }
      throw new Error("The GitHub code expired. Start again and approve within a few minutes.");
    } catch (error) {
      await githubDropPending(projectId, start.connectionId);
      throw error;
    }
  }

  async function githubRepos(connectionId: string, projectId?: string): Promise<GithubRepoChoice[]> {
    const owner = projectId ?? pendingMcp.current?.projectId ?? project?.id ?? "";
    try {
      return await invoke<GithubRepoChoice[]>("list_github_repos", { projectId: owner, connectionId });
    } catch (error) {
      throw new Error(githubText(error, "Could not load your GitHub repositories. Try again."));
    }
  }

  /** Step 3: bind the chosen repository. The account is named after the GitHub user. */
  async function githubConfirm(ownerProjectId: string, connectionId: string, repo: string, login: string | null) {
    const owner = projects.find((item) => item.id === ownerProjectId);
    const linked = owner?.connections.find((c) => c.id === connectionId);
    if (!owner || !linked) throw new Error("That GitHub request is gone. Start again.");
    const accountId = createAccount({ provider: "GitHub", label: login?.trim() || "personal" });
    const accountEntry = accountsRef.current.find((a) => a.id === accountId);
    const sharedWith = projects.filter((item) => item.id !== ownerProjectId && item.connections.some((c) => c.provider === "GitHub" && c.accountId === accountId));
    const connected: Connection = { ...linked, accountId, account: accountEntry?.label ?? accountId, target: repo, resource: repo, authState: "connected" };
    setProjects((current) => current.map((item) => item.id === ownerProjectId ? { ...item, connections: item.connections.map((c) => c.id === connectionId ? connected : c) } : item));
    pendingMcp.current = null;
    setModal(null);
    try {
      const filePath = await syncNexusProjectFile(owner, connected, "connected");
      const shared = sharedWith.length > 0 ? ` This GitHub account is also used by ${sharedWith.map((item) => item.name).join(", ")}.` : "";
      setNotice(`GitHub is connected to ${repo} as “${connected.account}”.${filePath ? ` Nexus wrote ${filePath}.` : ""}${shared}`);
    } catch (error) {
      reportError("Linking GitHub repository", error, { kind: "link", projectId: ownerProjectId, connectionId });
      setNotice("Connected, but Nexus could not write the project file. Check the folder still exists and is writable, then retry from Activity.");
    }
  }

  /** Step 1 of connect-first MCP: browser approval + token save under a pending connection. Returns the user's Supabase projects to pick from. */
  async function authorizeMcpConnection(detail: string, accountId?: string): Promise<{ connectionId: string; projects: SupabaseChoice[]; listError?: string }> {
    if (!project) throw new Error("No project is selected. Select a project before connecting.");
    if (!desktopAvailable()) throw new Error("Open the desktop app to start browser approval.");
    // Snapshot the owner up front: the selected project may change while the
    // browser approval is in flight, and the pending binding belongs here.
    const owner = project;
    const projectId = owner.id;
    const accountEntry = accountId ? accountsRef.current.find((a) => a.id === accountId) : undefined;
    const connection: Connection = {
      id: makeId("connection"),
      provider: "Supabase",
      short: "SB",
      target: detail.trim() || "Supabase",
      resource: detail.trim() || "Supabase",
      accountId: accountEntry?.id,
      account: accountEntry?.label ?? accountEntry?.id,
      environment: owner.environment ?? "development",
      detail: "Database and services",
      tone: "green",
      state: "Needs review",
      method: "mcp",
      authState: "pending",
    };
    setProjects((current) => current.map((item) => item.id === projectId ? { ...item, connections: [...item.connections, connection] } : item));
    mcpPollAbort.current?.abort();
    const controller = new AbortController();
    mcpPollAbort.current = controller;
    pendingMcp.current = { projectId, connectionId: connection.id };
    try {
      const start = await invoke<{ authorization_url: string }>("start_supabase_mcp_oauth");
      setNotice("Supabase approval is open in your browser.");
      await openUrl(start.authorization_url);
      const tokens = await pollMcpOAuth(controller.signal);
      await saveMcpTokens(projectId, connection.id, tokens);
      // Project list is convenience, not gate: failure still lands on the pick
      // step with manual entry so a network blip does not waste the approval.
      try {
        const fetched = await listSupabaseProjects(tokens.accessToken);
        return { connectionId: connection.id, projects: fetched };
      } catch (listError) {
        return { connectionId: connection.id, projects: [], listError: commandMessage(listError, "Could not load your Supabase projects.") };
      }
    } catch (error) {
      await removeMcpTokens(projectId, connection.id).catch(() => undefined);
      setProjects((current) => current.map((item) => item.id === projectId ? { ...item, connections: item.connections.filter((c) => c.id !== connection.id) } : item));
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(commandMessage(error, "Could not finish the browser approval. Try connecting again."));
    } finally {
      if (mcpPollAbort.current === controller) mcpPollAbort.current = null;
      pendingMcp.current = null;
    }
  }

  /** Step 2: link the pending connection to the chosen Supabase project. Details come from Supabase, not typing. */
  async function confirmMcpConnection(ownerProjectId: string, connectionId: string, choice: SupabaseChoice) {
    // Resolve the owner by id, not by current selection: the user may have
    // switched projects while the browser approval was in flight.
    const owner = projects.find((item) => item.id === ownerProjectId);
    const linked: Connection | undefined = owner?.connections.find((c) => c.id === connectionId);
    if (!owner || !linked) throw new Error("That approval request is gone. Start again.");
    // The approval proves which Supabase account this is, so name ours after its organization
    // and reuse it for every project in that organization. An account picked earlier is kept.
    const accountId = linked.accountId ?? createAccount({ provider: "Supabase", label: choice.organization_name?.trim() || "personal" });
    const accountEntry = accountsRef.current.find((a) => a.id === accountId);
    const sharedWith = projects.filter((item) => item.id !== ownerProjectId && item.connections.some((c) => c.provider === "Supabase" && c.accountId === accountId));
    const connectedConnection: Connection = {
      ...linked,
      accountId,
      account: accountEntry?.label ?? accountId,
      target: choice.name,
      resource: choice.name,
      projectRef: choice.ref,
      url: `https://${choice.ref}.supabase.co`,
      authState: "connected",
    };
    setProjects((current) => current.map((item) => item.id === ownerProjectId ? { ...item, connections: item.connections.map((c) => c.id === connectionId ? connectedConnection : c) } : item));
    setModal(null);
    try {
      const filePath = await syncNexusProjectFile(owner, connectedConnection, "connected");
      const shared = sharedWith.length > 0 ? ` This Supabase account is also used by ${sharedWith.map((item) => item.name).join(", ")}, so one credential reaches all of them.` : "";
      const suffix = ` Linked to your Supabase account “${connectedConnection.account}”. Its approval is stored in the desktop vault.${shared}`;
      setNotice(filePath ? `Supabase is connected. Nexus wrote ${filePath}.${suffix}` : `Supabase is connected.${suffix}`);
    } catch (error) {
      reportError("Linking Supabase project", error, { kind: "link", projectId: ownerProjectId, connectionId });
      setNotice("Connected, but Nexus could not write the project file. Check the folder still exists and is writable, then retry from Activity.");
    }
  }

  async function cancelMcpConnection(ownerProjectId: string, connectionId: string) {
    // Stop a still-running browser-approval poll first; its cleanup removes
    // the same pending connection, and both paths are idempotent.
    if (pendingMcp.current?.connectionId === connectionId) abortMcpAuthorize();
    const pendingProvider = projects.find((item) => item.id === ownerProjectId)?.connections.find((c) => c.id === connectionId)?.provider;
    await removeMcpTokens(ownerProjectId, connectionId, pendingProvider).catch(() => undefined);
    setProjects((current) => current.map((item) => item.id === ownerProjectId ? { ...item, connections: item.connections.filter((c) => c.id !== connectionId) } : item));
  }

  async function removeConnection(connection: Connection, owner?: Project, skipConfirm?: boolean) {
    const holder = owner ?? project;
    if (!holder) return;
    if (!skipConfirm && !window.confirm(`Remove the ${connection.provider} connection “${connection.target}” from ${holder.name}? Its saved approval is deleted from this desktop vault.`)) return;
    const projectId = holder.id;
    setNotice("");
    // Best-effort vault cleanup first; a missing entry is not an error.
    await removeMcpTokens(projectId, connection.id, connection.provider).catch(() => undefined);
    await invoke("set_write_grant", { projectId, connectionId: connection.id, allowed: false }).catch(() => undefined);
    await removePublishableKey(projectId, connection.id).catch(() => undefined);
    setProjects((current) => current.map((item) => item.id === projectId ? { ...item, connections: item.connections.filter((c) => c.id !== connection.id) } : item));
    setSavedKeys((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
    if (!desktopAvailable()) {
      setNotice("Binding removed from this app. Open the desktop app to also unlink its Nexus project file.");
      return;
    }
    try {
      const filePath = await invoke<string>("remove_nexus_connection", { workspacePath: holder.path, provider: connection.provider });
      setNotice(`Binding removed. Nexus updated ${filePath}.`);
    } catch (error) {
      reportError("Removing binding", error, { kind: "remove", projectId, connectionId: connection.id });
      setNotice("Removed here, but the project file still lists it. Retry from Activity to finish removing it.");
    }
  }

  /** Create a linked account without a notice and return its id (the existing id when the same account is already linked). */
  function createAccount(input: { provider: string; label: string }): string {
    const provider = input.provider.trim();
    const label = input.label.trim() || "personal";
    const current = accountsRef.current;
    // Linking the same login twice reuses it. makeAccountId alone would mint "-2".
    const existing = current.find((a) => a.provider.toLowerCase() === provider.toLowerCase() && a.label.trim().toLowerCase() === label.toLowerCase());
    if (existing) return existing.id;
    const id = makeAccountId(provider, label, current);
    const next = [...current, { id, label, provider, authState: "not_connected" as const }];
    accountsRef.current = next;
    setAccounts(next);
    return id;
  }

  function addAccount(input: { provider: string; label: string }) {
    const provider = input.provider.trim();
    const label = input.label.trim() || "personal";
    if (!provider) return;
    const id = makeAccountId(provider, label, accounts);
    if (accounts.some((a) => a.id === id)) {
      setNotice("That account already exists.");
      return;
    }
    setAccounts((current) => [...current, { id, label, provider, authState: "not_connected" }]);
    setNotice(`${provider} account “${label}” added. Bind it to a project from the Project page (Bindings).`);
  }

  async function removeAccount(accountId: string) {
    const target = accounts.find((a) => a.id === accountId);
    if (!target) return;
    const users = projects.filter((p) =>
      (p.connections ?? []).some((c) => (c.accountId ?? c.account) === accountId),
    );
    const suffix = users.length > 0
      ? ` It is still bound by ${users.map((p) => p.name).join(", ")} — removing it leaves those bindings pointing at a missing account.`
      : "";
    if (!window.confirm(`Remove ${target.provider} account “${target.label}”?${suffix}`)) return;
    setAccounts((current) => current.filter((a) => a.id !== accountId));
    setNotice(`Account “${target.label}” removed.${users.length > 0 ? " Re-bind those projects to a remaining account." : ""}`);
  }

  function setConnectionOverride(_projectId: string, _connectionId: string, _override: string | null) {
    // Paper: Guard is OUT of MVP. No new override writes — keep the function
    // signature so GuardView (hidden, not removed) still compiles.
    setNotice("Guard rules are hidden in this build — per-binding rules are not editable. Calls are logged on Home and Activity.");
  }

  /** Open a page; older names (overview, bindings, services, agents) land on the right section. */
  function navigate(target: NavTarget) {
    switch (target) {
      case "overview": case "projects": setProjectTab("status"); setView("project"); break;
      case "bindings": setProjectTab("bindings"); setView("project"); break;
      case "services": setConnectionsTab("accounts"); setView("connections"); break;
      case "agents": setConnectionsTab("agents"); setView("connections"); break;
      default: setView(target);
    }
  }

  const viewLabels: Record<View, string> = {
    home: "Home",
    project: "Project",
    connections: "Accounts & agents",
    guard: "Guard rules",
    activity: "Activity",
    settings: "Settings",
  };

  const currentLabel = viewLabels[view] ?? view;
  const scopedView = view === "project" || view === "activity";

  // Connections whose account is also bound to another project (paper §6):
  // marked on the canvas and named in the link/unlink confirm steps.
  const sharedConnectionIds = useMemo(() => {
    const shared = new Set(detectBlastRadius(projects, accounts).map((entry) => entry.accountKey));
    const ids = new Set<string>();
    for (const item of projects) {
      for (const connection of item.connections ?? []) {
        const key = accountGroupKey(connection.provider, connection);
        if (key && shared.has(key)) ids.add(connection.id);
      }
    }
    return ids;
  }, [projects, accounts]);

  /** Drag-to-link: the canvas only asks. Open the same binding picker the
   *  Project page uses, prefilled from the drag; nothing saves until confirmed. */
  function requestLink(request: PendingLinkRequest) {
    const nodes = [request.from, request.to];
    const projectNode = nodes.find((node) => node.kind === "project");
    const serviceNode = nodes.find((node) => node.kind === "service");
    if (!projectNode || !serviceNode) {
      setNotice(nodes.some((node) => node.kind === "agent")
        ? "Agents connect from Accounts, and the project they work in is resolved automatically. Drag a service onto a project to link it."
        : "Drag a service onto a project to link it.");
      return;
    }
    const source = projects.flatMap((item) => (item.connections ?? []).map((connection) => ({ owner: item, connection }))).find(({ connection }) => connection.id === serviceNode.id);
    if (!source) return;
    if (source.owner.id === projectNode.id) {
      setNotice(`${source.connection.provider} is already bound to ${source.owner.name}.`);
      return;
    }
    setSelectedProject(projectNode.id);
    setLinkDraft({ projectId: projectNode.id, provider: source.connection.provider, accountId: source.connection.accountId });
  }

  /** Confirmed from the in-canvas card: the only place a drop saves. */
  function confirmLink(input: { provider: string; target: string; accountId?: string }) {
    if (!linkDraft) return;
    addConnection({ provider: input.provider, target: input.target, detail: "Resource", tone: "blue", method: "manual", authState: "not_connected", accountId: input.accountId });
    setLinkDraft(null);
  }

  function unlinkFromCanvas(projectId: string, connectionId: string) {
    const owner = projects.find((item) => item.id === projectId);
    const connection = owner?.connections.find((item) => item.id === connectionId);
    if (owner && connection) void removeConnection(connection, owner, true);
  }

  const navItems: NavItem<View>[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "project", label: "Project", icon: "folder" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "connections", label: "Accounts", icon: "link" },
    ...(GUARD_VISIBLE ? [{ id: "guard" as const, label: "Guard", icon: "shield" as const }] : []),
  ];

  const railFooter = (
    <>
      <button type="button" className="nx-nav-item" aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")} title={vaultUnlocked ? "Settings · vault unlocked" : "Settings · vault locked"}>
        <NxIcon name={vaultUnlocked ? "unlock" : "settings"} size={20} />
        Settings
      </button>
      <span className="nx-user" title={osUser}>{osUser.slice(0, 1).toUpperCase()}</span>
    </>
  );

  return (
    <>
      <AppShell
        nav={navItems}
        active={view}
        onNavigate={navigate}
        railFooter={railFooter}
        crumbs={scopedView ? ["Nexus", project.name] : ["Nexus"]}
        title={currentLabel}
        fill={view === "home" || view === "project" || view === "connections"}
        actions={
          <>
            <ThemeButton />
            {view === "home" && (
              <>
                {setupIncomplete && <Button variant="ghost" size="sm" onPress={() => setOnboardingOpen(true)}>{resumeProject ? `Finish setting up ${resumeProject.name}` : "Finish setup"}</Button>}
                <Button size="sm" onPress={() => navigate("agents")}><NxIcon name="plus" size={15} />Connect agent</Button>
              </>
            )}
          </>
        }
        status={scopedView ? <Badge tone={project.environment.toLowerCase().startsWith("prod") ? "warning" : "success"} dot>{project.environment}</Badge> : undefined}
        banner={
          <>
            {!desktopAvailable() && (
              <Notice tone="warning">Browser preview shows saved project details only. Connecting services, vault, activity logs, and agent detection need the desktop app.</Notice>
            )}
            {notice && <Notice tone={notice.includes("connected") ? "success" : "warning"} onDismiss={() => setNotice("")}>{notice}</Notice>}
          </>
        }
      >
              {view === "home" && <HomeView projects={projects} accounts={accounts} sharedConnectionIds={sharedConnectionIds} linkDraft={linkDraft} onConfirmLink={confirmLink} onCancelLink={() => setLinkDraft(null)} onContinueInPicker={() => { if (linkDraft) { setLinkPrefill({ provider: linkDraft.provider, accountId: linkDraft.accountId }); setLinkDraft(null); setModal("connection"); } }} onView={navigate} onSelectProject={selectProject} onRequestLink={requestLink} onUnlink={unlinkFromCanvas} />}
      {view === "project" && (
        <ProjectPage project={project} projects={projects} tab={projectTab} onTab={setProjectTab} onSelect={selectProject} onAdd={() => setModal("project")} onEdit={openEditProject} onRemove={(item) => void removeProject(item.id)}>
          {project && (projectTab === "status"
            ? <Overview project={project} projects={projects} accounts={accounts} onView={navigate} onAddConnection={() => setModal("connection")} onConnectAgent={() => openConnectAgent(project.id, null)} />
            : <BindingsView project={project} projects={projects} accounts={accounts} vaultUnlocked={vaultUnlocked} savedKeys={savedKeys} onSaveKey={openKeyModal} onAdd={() => setModal("connection")} onUpdate={updateConnection} onRemove={(connection) => void removeConnection(connection)} onOpenServices={() => navigate("services")} />)}
        </ProjectPage>
      )}
      {view === "connections" && (
        <ConnectionsPage tab={connectionsTab} onTab={setConnectionsTab}>
          {connectionsTab === "accounts"
            ? <ServicesView projects={projects} accounts={accounts} customServices={customServices} onAddCustomService={addCustomService} onRemoveCustomService={(entry) => void removeCustomService(entry)} onAddAccount={addAccount} onRemoveAccount={(id) => void removeAccount(id)} onOpenBindings={() => navigate("bindings")} />
            : <AgentsView projects={projects} onConnect={(projectId, agentId) => openConnectAgent(projectId, agentId)} />}
        </ConnectionsPage>
      )}
      {GUARD_VISIBLE && view === "guard" && <GuardView projects={projects} onSetOverride={setConnectionOverride} />}
      {view === "activity" && <ActivityView projects={projects} errorLog={errorLog} onClearErrors={() => setErrorLog([])} onRetryError={(record) => void retryError(record)} />}
      {view === "settings" && <SettingsView projects={projects} savedKeys={savedKeys} vaultUnlocked={vaultUnlocked} onUnlocked={() => setVaultUnlocked(true)} onLocked={() => setVaultUnlocked(false)} onReset={() => {
        if (!window.confirm("Reset all local Nexus data? Projects, setup, and the error log return to starter examples. Vault approvals in the OS keychain are untouched.")) return;
        try {
          window.localStorage.removeItem("nexus-guard.projects");
          window.localStorage.removeItem("nexus-guard.accounts");
          window.localStorage.removeItem("nexus-guard.errors");
          window.localStorage.removeItem("nexus-guard.selected-project");
        } catch { /* ignore */ }
        setProjects(starterProjects);
        setAccounts(starterAccounts);
        setSelectedProject(starterProjects[0].id);
        setErrorLog([]);
        navigate("overview");
        setNotice("Local data reset to starter examples. Keychain approvals untouched — remove those per binding if needed.");
      }} />}
      </AppShell>

      {onboardingOpen && (
        <FirstRun
          resumeProject={resumeProject}
          projects={projects}
          onRegister={(input) => addProject(input, { stay: true })}
          onOpenAddBinding={(projectId) => { setSelectedProject(projectId); setModal("connection"); }}
          onOpenConnectAgent={openConnectAgent}
          onSkip={dismissOnboarding}
          onFinish={() => { dismissOnboarding(); navigate("home"); }}
        />
      )}
      {modal === "project" && <AddProjectModal onClose={() => setModal(null)} onSave={addProject} existingNames={projects.map((item) => item.name)} />}
      {modal === "edit-project" && editingProject && <EditProjectModal project={editingProject} onClose={() => setModal(null)} onSave={(patch) => updateProject(editingProject.id, patch)} existingNames={projects.filter((item) => item.id !== editingProject.id).map((item) => item.name)} />}
      {modal === "agent" && agentTarget && projects.some((item) => item.id === agentTarget.projectId) && <ConnectAgentModal project={projects.find((item) => item.id === agentTarget.projectId)!} initialAgentId={agentTarget.agentId} onClose={() => setModal(null)} />}
      {modal === "connection" && project && <AddConnectionModal initialProvider={linkPrefill?.provider} initialAccountId={linkPrefill?.accountId} projectId={project.id} projectName={project.name} environment={project.environment} projects={projects} accounts={accounts} onCreateAccount={createAccount} customNames={customServices.map((entry) => entry.name)} github={{ ...githubStatus, start: githubStart, wait: githubWait, repos: githubRepos, confirm: githubConfirm }} remote={{ available: desktopAvailable(), connect: connectRemoteService }} onClose={() => { setModal(null); setLinkPrefill(null); }} onSave={addConnection} onAuthorizeMcp={authorizeMcpConnection} onConfirmMcp={(ownerProjectId, connectionId, choice) => void confirmMcpConnection(ownerProjectId, connectionId, choice).catch((error) => setNotice(reportError("Linking Supabase project", error, { kind: "link", projectId: ownerProjectId, connectionId })))} onCancelMcp={(ownerProjectId, connectionId) => void cancelMcpConnection(ownerProjectId, connectionId)} onAbortMcp={abortMcpAuthorize} />}
      {modal === "key" && project && keyConnection && <PublishableKeyModal project={project} connection={keyConnection} saved={!!savedKeys[keyConnection.id]} vaultUnlocked={vaultUnlocked} onUnlocked={() => setVaultUnlocked(true)} onClose={() => setModal(null)} onChanged={(saved) => { setSavedKeys((current) => ({ ...current, [keyConnection.id]: saved })); setProjects((current) => current.map((item) => item.id === project.id ? { ...item, connections: item.connections.map((itemConnection) => itemConnection.id === keyConnection.id ? { ...itemConnection, keySaved: saved } : itemConnection) } : item)); setModal(null); }} />}
    </>
  );
}

export default App;

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { desktopAvailable, hasPublishableKey, listSupabaseProjects, lockVault, removeMcpTokens, removePublishableKey, saveMcpTokens } from "./vault";
import { initialsFor, loadAccounts, loadProjects, makeAccountId, makeId, manifestAccountFor, saveAccounts, saveProjects, starterAccounts, starterProjects, type Account, type Connection, type Project } from "./store";
import { accountGroupKey, detectBlastRadius } from "./accounts";
import { HomeView } from "./home";
import { type PendingLinkRequest } from "./topology";
import { OnboardingModal, ThemeButton, initTheme } from "./onboarding";
import { Button } from "@heroui/react";
import { AppShell, Badge, Icon as NxIcon, Notice, type NavItem } from "./ui";
import { type View, type ErrorRetry, type ErrorRecord } from "./app/types";
import { GUARD_VISIBLE } from "./app/styles";
import { errorIdentity, loadErrorLog } from "./app/errors";
import { Overview } from "./views/OverviewView";
import { ProjectsView } from "./views/ProjectsView";
import { AgentsView } from "./views/AgentsView";
import { BindingsView } from "./views/BindingsView";
import { ServicesView } from "./views/ServicesView";
import { GuardView } from "./views/GuardView";
import { ActivityView } from "./views/ActivityView";
import { SettingsView } from "./views/SettingsView";
import { AddProjectModal } from "./modals/AddProjectModal";
import { EditProjectModal } from "./modals/EditProjectModal";
import { EditConnectionModal } from "./modals/EditConnectionModal";
import { AddConnectionModal } from "./modals/AddConnectionModal";
import { PublishableKeyModal } from "./modals/PublishableKeyModal";
import { ConnectAgentModal } from "./modals/ConnectAgentModal";
import "./App.css";

function App() {
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [selectedProject, setSelectedProject] = useState(() => window.localStorage.getItem("nexus-guard.selected-project") ?? "koupa");
  const [linkDraft, setLinkDraft] = useState<{ projectId: string; provider: string; accountId?: string } | null>(null);
  const [linkPrefill, setLinkPrefill] = useState<{ provider: string; accountId?: string } | null>(null);
  const [modal, setModal] = useState<"project" | "connection" | "key" | "edit-project" | "edit-connection" | "agent" | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try { return !window.localStorage.getItem("nexus-guard.onboarded"); } catch { return false; }
  });
  const [agentTarget, setAgentTarget] = useState<{ projectId: string; agentId: string | null } | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingConnection, setEditingConnection] = useState<{ projectId: string; connection: Connection } | null>(null);
  const [keyConnection, setKeyConnection] = useState<Connection | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [errorLog, setErrorLog] = useState<ErrorRecord[]>(loadErrorLog);
  const [osUser, setOsUser] = useState("Local");
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const project = useMemo(() => projects.find((item) => item.id === selectedProject || item.name === selectedProject) ?? projects[0], [projects, selectedProject]);

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
        : where === "Removing connection"
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

  function openEditConnection(projectId: string, connection: Connection) {
    setEditingConnection({ projectId, connection });
    setModal("edit-connection");
  }

  function openKeyModal(connection: Connection) {
    setKeyConnection(connection);
    setModal("key");
  }

  function selectProject(id: string) {
    setSelectedProject(id);
    setView("overview");
  }

  function dismissOnboarding() {
    try { window.localStorage.setItem("nexus-guard.onboarded", "1"); } catch { /* ignore */ }
    setOnboardingOpen(false);
  }

  function finishOnboarding(input: { name: string; path: string; repo: string; branch: string; environment?: string; binding?: { provider: string; accountId: string; resource: string } }) {
    if (!projects.some((item) => item.name.toLowerCase() === input.name.toLowerCase())) {
      addProject(input);
    }
    dismissOnboarding();
  }

  function addProject(input: { name: string; path: string; repo: string; branch: string; environment?: string; binding?: { provider: string; accountId: string; resource: string } }) {
    if (projects.some((item) => item.name.toLowerCase() === input.name.toLowerCase())) return;
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
    setView("overview");
    setModal(null);
    // Manifest sync (paper: discovery != registration — local create is not
    // on-disk until the project file is written). Runs async; the local
    // create above is already done so the UI never blocks on the backend.
    void (async () => {
      if (!desktopAvailable()) return;
      try {
        const inspection = await invoke<{ exists: boolean; is_dir: boolean }>("inspect_project_folder", { workspacePath: newProject.path });
        if (!inspection.exists || !inspection.is_dir) {
          if (!window.confirm(`Project folder “${newProject.path}” does not exist yet. Create it now?`)) {
            setNotice("Project saved here. Its folder does not exist yet — create it, then verify on Overview so agents resolve it.");
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
          setNotice(`Saved the safe Nexus project file at ${filePath}. Link a service under Services, then bind it, to add its resource.`);
        } catch (error) {
          reportError("Saving project file", error);
          setNotice("Project saved here, but Nexus could not write the project file. Check the folder still exists and is writable, then verify on Overview.");
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
    if (!window.confirm(`Update project “${old.name}”?\n\n${diffLines.join("\n")}\n\nAgents resolve the on-disk file until re-saved — re-verify the folder on Overview afterwards.`)) return;
    const updated: Project = { ...old, name: patch.name, initials: initialsFor(patch.name), path: patch.path, repo: patch.repo || "Not connected", branch: patch.branch || "main", environment: patch.environment, lastSeen: "Updated just now" };
    setProjects((current) => current.map((item) => item.id === projectId ? updated : item));
    setModal(null);
    setNotice("Project updated. Re-verify the folder on Overview so agents resolve the new details.");
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
      await removeMcpTokens(projectId, connection.id).catch(() => undefined);
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
    setNotice("Connection updated. Nexus re-saved the on-disk project file.");
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
    const accountEntry = accounts.find((a) => a.id === input.accountId && a.provider.toLowerCase() === input.provider.toLowerCase());
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
    }).catch((error) => { reportError("Saving project file", error, { kind: "write-file", projectId: owner.id, connectionId: newConnection.id }); setNotice("Connection saved, but Nexus could not write the project file. Check the folder still exists and is writable, then retry from Activity."); });
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
      setNotice("That connection is gone, so there is nothing to retry. The error is kept for reference.");
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
  type SupabaseChoice = { ref: string; name: string; region?: string | null };

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
      const error = new Error("The connection request was cancelled.");
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
        if (!result.success || !result.access_token) throw new Error("The browser approval timed out. Start the connection again and approve within a few minutes.");
        return { accessToken: result.access_token, refreshToken: result.refresh_token, scope: result.scope };
      }
    }
    throw new Error("The browser approval timed out. Start the connection again and approve within a few minutes.");
  }

  /** Step 1 of connect-first MCP: browser approval + token save under a pending connection. Returns the user's Supabase projects to pick from. */
  async function authorizeMcpConnection(detail: string, accountId?: string): Promise<{ connectionId: string; projects: SupabaseChoice[]; listError?: string }> {
    if (!project) throw new Error("No project is selected. Select a project before connecting.");
    if (!desktopAvailable()) throw new Error("Open the desktop app to start browser approval.");
    // Snapshot the owner up front: the selected project may change while the
    // browser approval is in flight, and the pending binding belongs here.
    const owner = project;
    const projectId = owner.id;
    const accountEntry = accountId ? accounts.find((a) => a.id === accountId) : undefined;
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
    if (!owner || !linked) throw new Error("That connection request is gone. Start the connection again.");
    const connectedConnection: Connection = {
      ...linked,
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
      const unlinked = !connectedConnection.accountId && !connectedConnection.account;
      const suffix = unlinked ? " No Services account is linked — open Bindings → Edit on this connection to pick one so the topology shows the right login." : " Its approval is stored in the desktop vault.";
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
    await removeMcpTokens(ownerProjectId, connectionId).catch(() => undefined);
    setProjects((current) => current.map((item) => item.id === ownerProjectId ? { ...item, connections: item.connections.filter((c) => c.id !== connectionId) } : item));
  }

  async function removeConnection(connection: Connection, owner?: Project, skipConfirm?: boolean) {
    const holder = owner ?? project;
    if (!holder) return;
    if (!skipConfirm && !window.confirm(`Remove the ${connection.provider} connection “${connection.target}” from ${holder.name}? Its saved approval is deleted from this desktop vault.`)) return;
    const projectId = holder.id;
    setNotice("");
    // Best-effort vault cleanup first; a missing entry is not an error.
    await removeMcpTokens(projectId, connection.id).catch(() => undefined);
    await removePublishableKey(projectId, connection.id).catch(() => undefined);
    setProjects((current) => current.map((item) => item.id === projectId ? { ...item, connections: item.connections.filter((c) => c.id !== connection.id) } : item));
    setSavedKeys((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
    if (!desktopAvailable()) {
      setNotice("Connection removed from this app. Open the desktop app to also unlink its Nexus project file.");
      return;
    }
    try {
      const filePath = await invoke<string>("remove_nexus_connection", { workspacePath: holder.path, provider: connection.provider });
      setNotice(`Connection removed. Nexus updated ${filePath}.`);
    } catch (error) {
      reportError("Removing connection", error, { kind: "remove", projectId, connectionId: connection.id });
      setNotice("Removed here, but the project file still lists it. Retry from Activity to finish removing it.");
    }
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
    setNotice(`${provider} account “${label}” added. Bind it to a project under Bindings.`);
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

  const viewLabels: Record<View, string> = {
    home: "Home",
    overview: "Overview",
    projects: "Projects",
    agents: "Agents",
    bindings: "Bindings",
    services: "Services",
    guard: "Guard rules",
    activity: "Activity",
    settings: "Settings",
  };

  const connectedApprovals = projects.reduce((count, item) => count + item.connections.filter((c) => c.authState === "connected").length, 0);
  const currentLabel = viewLabels[view] ?? view;
  const scopedView = view === "overview" || view === "bindings" || view === "activity";

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
   *  Bindings tab uses, prefilled from the drag; nothing saves until confirmed. */
  function requestLink(request: PendingLinkRequest) {
    const nodes = [request.from, request.to];
    const projectNode = nodes.find((node) => node.kind === "project");
    const serviceNode = nodes.find((node) => node.kind === "service");
    if (!projectNode || !serviceNode) {
      setNotice(nodes.some((node) => node.kind === "agent")
        ? "Agents connect from the Agents tab, and the project they work in is resolved automatically. Drag a service onto a project to link it."
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
    { id: "projects", label: "Projects", icon: "folder" },
    { id: "overview", label: "Overview", icon: "grid" },
    { id: "bindings", label: "Bindings", icon: "link" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "services", label: "Services", icon: "services" },
    { id: "agents", label: "Agents", icon: "agents" },
    ...(GUARD_VISIBLE ? [{ id: "guard" as const, label: "Guard", icon: "shield" as const }] : []),
  ];

  const railFooter = (
    <>
      <div className="relative w-full">
        <button type="button" aria-expanded={vaultMenuOpen} onClick={() => setVaultMenuOpen((open) => !open)} className="nx-nav-item" title={vaultUnlocked ? "Vault unlocked" : "Vault locked"}>
          <NxIcon name={vaultUnlocked ? "unlock" : "lock"} size={20} />
          {vaultUnlocked ? "Unlocked" : "Locked"}
        </button>
        {vaultMenuOpen && (
          <div className="nx-notice absolute bottom-2 left-full z-40 ml-3 w-[280px] flex-col !items-stretch gap-1" style={{ boxShadow: "var(--shadow-pop)" }} role="status">
            <strong>{vaultUnlocked ? "Desktop vault unlocked" : "Desktop vault locked"}</strong>
            <span className="nx-muted">{connectedApprovals} approval{connectedApprovals === 1 ? "" : "s"} saved · OS keychain holds the secrets</span>
            <span className="nx-muted">{desktopAvailable() ? "MCP approvals save without unlocking. Typed keys unlock inline." : "Open the desktop app to manage the vault."}</span>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onPress={() => { setVaultMenuOpen(false); setView("settings"); }}>Open settings</Button>
              {vaultUnlocked && <Button size="sm" variant="outline" onPress={() => { setVaultMenuOpen(false); void lockVault().then(() => setVaultUnlocked(false)).catch(() => undefined); }}>Lock now</Button>}
            </div>
          </div>
        )}
      </div>
      <button type="button" className="nx-nav-item" aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}>
        <NxIcon name="settings" size={20} />
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
        onNavigate={setView}
        railFooter={railFooter}
        crumbs={scopedView ? ["Nexus", project.name] : ["Nexus"]}
        title={currentLabel}
        fill={view === "home" || view === "overview"}
        actions={
          <>
            <ThemeButton />
            {view === "home" && (
              <>
                <Button variant="ghost" size="sm" onPress={() => setOnboardingOpen(true)}>Finish setup</Button>
                <Button size="sm" onPress={() => setView("agents")}><NxIcon name="plus" size={15} />Connect agent</Button>
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
              {view === "home" && <HomeView projects={projects} accounts={accounts} sharedConnectionIds={sharedConnectionIds} linkDraft={linkDraft} onConfirmLink={confirmLink} onCancelLink={() => setLinkDraft(null)} onContinueInPicker={() => { if (linkDraft) { setLinkPrefill({ provider: linkDraft.provider, accountId: linkDraft.accountId }); setLinkDraft(null); setModal("connection"); } }} onView={setView} onSelectProject={selectProject} onRequestLink={requestLink} onUnlink={unlinkFromCanvas} />}
      {view === "overview" && <Overview project={project} projects={projects} accounts={accounts} onView={setView} onAddConnection={() => setModal("connection")} onConnectAgent={() => openConnectAgent(project.id, null)} />}
      {view === "projects" && <ProjectsView projects={projects} selectedProject={project.id} onSelect={selectProject} onAdd={() => setModal("project")} onEdit={openEditProject} onRemove={(item) => void removeProject(item.id)} />}
      {view === "agents" && <AgentsView projects={projects} onConnect={(projectId, agentId) => openConnectAgent(projectId, agentId)} />}
      {view === "bindings" && <BindingsView project={project} projects={projects} accounts={accounts} vaultUnlocked={vaultUnlocked} savedKeys={savedKeys} onSaveKey={openKeyModal} onAdd={() => setModal("connection")} onRemove={(connection) => void removeConnection(connection)} onEdit={(connection) => openEditConnection(project.id, connection)} onOpenServices={() => setView("services")} />}
      {view === "services" && <ServicesView projects={projects} accounts={accounts} onAddAccount={addAccount} onRemoveAccount={(id) => void removeAccount(id)} />}
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
        setView("overview");
        setNotice("Local data reset to starter examples. Keychain approvals untouched — remove those per connection if needed.");
      }} />}
      </AppShell>

      {onboardingOpen && <OnboardingModal onClose={dismissOnboarding} onSave={finishOnboarding} onAddAccount={addAccount} accounts={accounts} existingNames={projects.map((item) => item.name)} onWatchPulse={() => { dismissOnboarding(); setView("home"); }} />}
      {modal === "project" && <AddProjectModal onClose={() => setModal(null)} onSave={addProject} existingNames={projects.map((item) => item.name)} />}
      {modal === "edit-project" && editingProject && <EditProjectModal project={editingProject} onClose={() => setModal(null)} onSave={(patch) => updateProject(editingProject.id, patch)} existingNames={projects.filter((item) => item.id !== editingProject.id).map((item) => item.name)} />}
      {modal === "edit-connection" && editingConnection && <EditConnectionModal connection={editingConnection.connection} accounts={accounts} onClose={() => setModal(null)} onOpenServices={() => { setModal(null); setView("services"); }} onSave={(patch) => updateConnection(editingConnection.projectId, editingConnection.connection.id, patch)} />}
      {modal === "agent" && agentTarget && projects.some((item) => item.id === agentTarget.projectId) && <ConnectAgentModal project={projects.find((item) => item.id === agentTarget.projectId)!} initialAgentId={agentTarget.agentId} onClose={() => setModal(null)} />}
      {modal === "connection" && project && <AddConnectionModal initialProvider={linkPrefill?.provider} initialAccountId={linkPrefill?.accountId} projectId={project.id} projectName={project.name} accounts={accounts} onClose={() => { setModal(null); setLinkPrefill(null); }} onOpenServices={() => { setModal(null); setLinkPrefill(null); setView("services"); }} onSave={addConnection} onAuthorizeMcp={authorizeMcpConnection} onConfirmMcp={(ownerProjectId, connectionId, choice) => void confirmMcpConnection(ownerProjectId, connectionId, choice).catch((error) => setNotice(reportError("Linking Supabase project", error, { kind: "link", projectId: ownerProjectId, connectionId })))} onCancelMcp={(ownerProjectId, connectionId) => void cancelMcpConnection(ownerProjectId, connectionId)} onAbortMcp={abortMcpAuthorize} />}
      {modal === "key" && project && keyConnection && <PublishableKeyModal project={project} connection={keyConnection} saved={!!savedKeys[keyConnection.id]} vaultUnlocked={vaultUnlocked} onUnlocked={() => setVaultUnlocked(true)} onClose={() => setModal(null)} onChanged={(saved) => { setSavedKeys((current) => ({ ...current, [keyConnection.id]: saved })); setProjects((current) => current.map((item) => item.id === project.id ? { ...item, connections: item.connections.map((itemConnection) => itemConnection.id === keyConnection.id ? { ...itemConnection, keySaved: saved } : itemConnection) } : item)); setModal(null); }} />}
    </>
  );
}

export default App;

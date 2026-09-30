import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { desktopAvailable, hasPublishableKey, listSupabaseProjects, lockVault, removeMcpTokens, removePublishableKey, saveMcpTokens, savePublishableKey, unlockVault } from "./vault";
import { initialsFor, loadAccounts, loadProjects, makeAccountId, makeId, manifestAccountFor, saveAccounts, saveProjects, starterAccounts, starterProjects, tierForProvider, PROVIDER_CATALOG, accountLabelForConnection, type Account, type Connection, type Project } from "./store";
import { accountGroupKey, blastRadiusWarningsFor, detectBlastRadius } from "./accounts";
import { CENTRAL_TABLE, VOCAB, resolveOverride } from "./guard";
import { HomeView } from "./home";
import { agentDisplayName, projectDisplayName, type PendingLinkRequest } from "./topology";
import { OnboardingModal, ThemeButton, ThemeToggle, initTheme, nexusHttpUrlFor, claudeHttpCommand, codexHttpCommand } from "./onboarding";
import { Button } from "@heroui/react";
import { AppShell, Badge, Empty, Icon as NxIcon, Notice, Segmented, type NavItem, type StepState, type Tone } from "./ui";
import "./App.css";

type View = "home" | "overview" | "projects" | "agents" | "bindings" | "services" | "guard" | "activity" | "settings";

/** Paper alignment: Guard is OUT of MVP. Hidden, not removed — the "guard"
 *  View member stays so home.tsx / other files keep compiling. */
const GUARD_VISIBLE = false;

/** Backend AgentConfigEdit shape (connect/import/remove return this).
 *  Kept local: no shared types module owns it yet. */
type AgentConfigEdit = { path: string; backup: string; diff: string };

/** Backend unmanaged-entry shape from detect_agents (found,unmanaged). */
type UnmanagedMcpEntry = { source: string; name: string; kind: string };

const primaryBtn =
  "rounded-[10px] bg-(--text) px-4 py-2 text-[13px] font-medium text-(--canvas) transition-[background-color,transform,opacity] duration-200 hover:opacity-85 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn =
  "rounded-[10px] border border-(--line) bg-(--panel) px-4 py-2 text-[13px] font-medium text-(--text) transition-[transform,opacity] duration-200 hover:border-(--muted-2) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const smallBtn =
  "shrink-0 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-1.5 text-[12px] font-medium text-(--text) transition-[transform,opacity] duration-200 hover:border-(--muted-2) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtn =
  "shrink-0 rounded-[10px] border border-(--red-bg) bg-(--panel) px-3 py-1.5 text-[12px] font-medium text-(--red) transition-[transform,opacity] duration-200 hover:bg-(--red-bg) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--red) disabled:cursor-not-allowed disabled:opacity-50";
const ghostLink =
  "rounded-[10px] px-2 py-1 text-[13px] font-medium text-(--muted) transition-[transform,opacity] duration-200 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)";
const inputClass =
  "h-10 w-full rounded-[10px] border border-(--line) bg-(--panel) px-3 text-[13px] text-(--text) placeholder:text-(--muted-2) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-1";
const selectClass =
  "h-10 w-full rounded-[10px] border border-(--line) bg-(--panel) px-3 text-[13px] text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-1";

function badgeStyle(tone: string): { background: string; color: string } {
  if (tone === "green" || tone === "allow" || tone === "connected" || tone === "success" || tone === "folder ok") return { background: "var(--green-bg)", color: "var(--green)" };
  if (tone === "yellow" || tone === "warning" || tone === "pending" || tone === "approval_required" || tone === "shared") return { background: "var(--orange-bg)", color: "var(--orange)" };
  if (tone === "red" || tone === "danger" || tone === "block" || tone === "failed" || tone === "missing") return { background: "var(--red-bg)", color: "var(--red)" };
  if (tone === "blue") return { background: "var(--blue-bg)", color: "var(--blue)" };
  return { background: "var(--raised)", color: "var(--muted)" };
}

function StatusDot({ tone = "green" }: { tone?: string }) {
  const color = tone === "green" ? "var(--green)" : tone === "orange" || tone === "yellow" ? "var(--orange)" : tone === "red" ? "var(--red)" : tone === "blue" ? "var(--blue)" : "var(--muted)";
  return <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 9999, background: color, flexShrink: 0 }} />;
}

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
        fill={view === "home"}
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

/** The shell header already names the screen; this row only carries the
 *  screen's one-line explanation and its primary actions. */
function PageTitle({ description, action }: { eyebrow?: string; title?: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <p className="max-w-[72ch] text-[13px] leading-[1.6] text-(--muted)">{description}</p>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

function Card({ children, flush = false, className = "" }: { children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`nx-card${flush ? " nx-card-flush" : ""} ${className}`}>{children}</section>;
}

function CardHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="nx-card-head shrink-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="nx-eyebrow">{eyebrow}</span>
        <h2 className="nx-card-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-start gap-2.5 rounded-[12px] bg-(--raised) p-3 text-[12px] leading-[1.6] text-(--muted)">
      <span className="mt-0.5 text-(--muted)"><NxIcon name="shield" size={15} /></span>
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

function Overview({ project, projects, accounts, onView, onAddConnection, onConnectAgent }: { project: Project; projects: Project[]; accounts: Account[]; onView: (view: View) => void; onAddConnection: () => void; onConnectAgent: () => void }) {
  const { entries } = useAuditLog(projects);
  const [diskCheck, setDiskCheck] = useState<FolderInspection | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [overwriting, setOverwriting] = useState(false);
  const [liveCheck, setLiveCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [liveChecking, setLiveChecking] = useState(false);
  const connected = project.connections.filter((c) => c.authState === "connected");
  const pending = project.connections.filter((c) => c.authState === "pending");
  const mine = entries.filter((e) => e.project === project.name || (e.project_id && e.project_id === project.id));
  const allowed = mine.filter((e) => e.decision === "allow").length;
  const blocked = mine.filter((e) => e.decision !== "allow").length;
  const last = mine.length > 0 ? mine[mine.length - 1] : null;
  const lastBlock = [...mine].reverse().find((e) => e.decision !== "allow");
  const live = connected.find((c) => c.provider === "Supabase" && c.projectRef);
  const protectedNow = connected.length > 0;
  const setupDone = connected.length > 0 && !!diskCheck?.nexus_project_id;
  // Guard copy: approval_required reads as denied (blocked/denied wording).
  const decisionLabel = (d?: string | null) => (d === "approval_required" ? "denied" : (d ?? "unknown"));
  // Per-project shared-account warning (accounts.ts helper; Services-first).
  const blastWarnings = blastRadiusWarningsFor(project.id, projects, accounts);

  async function verifyOnDisk() {
    if (!desktopAvailable()) return;
    setVerifying(true);
    try {
      const result = await invoke<FolderInspection>("inspect_project_folder", { workspacePath: project.path });
      setDiskCheck(result);
    } catch {
      setDiskCheck(null);
    } finally {
      setVerifying(false);
    }
  }
  useEffect(() => { setDiskCheck(null); setLiveCheck(null); }, [project.id]);

  // Surface-and-ask: compare what agents on disk resolve vs what is shown
  // here. Rendered as a Keep disk / Overwrite disk / Dismiss panel below
  // (not display-only).
  const hereSummary = project.connections.length === 0
    ? "no bindings"
    : project.connections.map((c) => {
        const manifested = manifestAccountFor(c, accounts);
        return `${c.provider}:${c.resource ?? c.target}@${manifested.account ?? manifested.accountId ?? "Not linked"}`;
      }).join(" · ");
  const diskSummary = !diskCheck
    ? ""
    : !(diskCheck.nexus_project_id || (diskCheck.nexus_connections ?? []).length > 0)
      ? "no project file"
      : `${diskCheck.nexus_project ?? "?"} · ${diskCheck.nexus_environment ?? "?"} · ${((diskCheck.nexus_connections ?? []).length === 0 ? "no bindings" : (diskCheck.nexus_connections ?? []).map((c) => `${c.provider}:${c.resource ?? c.target ?? "?"}@${c.account ?? "—"}`).join(" · "))}`;
  const diskDiffers = !!diskCheck && (
    (diskCheck.nexus_project != null && diskCheck.nexus_project !== project.name) ||
    (diskCheck.nexus_project_id != null && diskCheck.nexus_project_id !== project.id) ||
    (diskCheck.nexus_environment != null && diskCheck.nexus_environment !== project.environment) ||
    ((diskCheck.nexus_connections ?? []).length !== project.connections.length) ||
    (diskCheck.nexus_connections ?? []).some((d) => !project.connections.some((c) => {
      const manifested = manifestAccountFor(c, accounts);
      const hereAccount = manifested.accountId ?? manifested.account ?? "";
      return c.provider.toLowerCase() === d.provider.toLowerCase() &&
        (c.resource ?? c.target) === (d.resource ?? d.target) &&
        hereAccount === (d.account ?? "");
    }))
  );

  async function overwriteDisk() {
    if (!desktopAvailable() || project.connections.length === 0) return;
    if (!window.confirm(`Overwrite the on-disk project file for “${project.name}” with what is shown here?\n\nHere: ${project.name} · ${project.environment} · ${hereSummary}\nAgents will then resolve these details.`)) return;
    setOverwriting(true);
    try {
      for (const c of project.connections) {
        const manifested = manifestAccountFor(c, accounts);
        await invoke<string>("write_nexus_project_file", {
          workspacePath: project.path,
          projectId: project.id,
          projectName: project.name,
          provider: c.provider,
          target: c.target,
          projectRef: c.projectRef ?? null,
          connectionId: c.id,
          method: c.method ?? "manual",
          status: c.authState ?? "not_connected",
          environment: project.environment ?? "development",
          repo: project.repo && project.repo !== "Not connected" ? project.repo : null,
          branch: project.branch ?? null,
          account: manifested.account ?? c.account ?? null,
          accountId: manifested.accountId ?? c.accountId ?? null,
        });
      }
      await verifyOnDisk();
    } catch {
      // Keep the panel open so the mismatch stays visible for retry.
    } finally {
      setOverwriting(false);
    }
  }

  async function runGuardedRead() {
    if (!live || !desktopAvailable()) return;
    setLiveChecking(true);
    setLiveCheck(null);
    try {
      const answer = await invoke<{ name: string; status?: string | null; region?: string | null }>("verify_supabase_connection", { projectId: project.id, connectionId: live.id, projectRef: live.projectRef });
      setLiveCheck({ ok: true, text: `${answer.name}${answer.status ? ` · ${answer.status}` : ""}${answer.region ? ` · ${answer.region}` : ""}` });
    } catch (error) {
      const message = "Could not reach Supabase. Check your network connection, then try again.";
      setLiveCheck({ ok: false, text: message });
    } finally {
      setLiveChecking(false);
    }
  }

  const steps = [
    { done: true, label: "Folder registered", detail: project.path },
    { done: connected.length > 0, label: connected.length > 0 ? `${connected.length} resource${connected.length === 1 ? "" : "s"} connected` : "Connect a resource", detail: connected.length > 0 ? connected.map((c) => `${c.provider} → ${c.resource ?? c.target}`).join(" · ") : "Browser approval, nothing to type" },
    { done: !!diskCheck?.nexus_project_id, label: "Agents resolve it", detail: diskCheck ? (diskCheck.nexus_project_id ? `On disk as ${diskCheck.nexus_project}${(diskCheck.nexus_connections ?? []).length > 0 ? ` · ${(diskCheck.nexus_connections ?? []).map((c) => `${c.provider}:${c.resource ?? c.target ?? "?"}`).join(" · ")}` : ""}` : "No project file in that folder yet") : "Verify what agents opening the folder get" },
  ];

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        description={`${project.path} → ${project.name} · ${project.environment}`}
        action={
          <>
            <Button size="sm" onPress={protectedNow ? onConnectAgent : onAddConnection}>
              {protectedNow ? "Connect agent" : "Connect a service"}
            </Button>
            <Button size="sm" variant="outline" onPress={() => onView("bindings")}>Bindings</Button>
          </>
        }
      />

      <Card className="shrink-0">
        <div className="flex flex-wrap items-center gap-5">
          <span className="nx-tile" data-tone={protectedNow ? "success" : pending.length > 0 ? "info" : "warning"} style={{ width: 44, height: 44 }}>
            <NxIcon name="shield" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[12px] font-semibold">
              <StatusDot tone={protectedNow ? "green" : pending.length > 0 ? "blue" : "orange"} />
              <span style={{ color: protectedNow ? "var(--green)" : pending.length > 0 ? "var(--blue)" : "var(--orange)" }}>
                {protectedNow ? "Protected" : pending.length > 0 ? "Approval in browser" : "Setup needed"}
              </span>
            </p>
            <h2 className="mt-1 text-[16px] font-semibold leading-[1.3] tracking-[-0.01em] text-(--text)">
              {protectedNow ? `Every call resolves to ${connected[0].resource ?? connected[0].target}` : pending.length > 0 ? "Finish the approval waiting in your browser" : "Connect one resource to guard this folder"}
            </h2>
            <p className="mt-1 max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
              {protectedNow ? "Agents on this folder get this resource only. Anything else is blocked before it reaches the provider." : "Two minutes: approve in the browser, pick the project, done."}
            </p>
          </div>
          <div className="flex min-w-[170px] flex-col gap-1 border-l border-(--line-soft) pl-5 text-[12px] tabular-nums text-(--muted)">
            <span>Identity</span>
            <strong className="font-semibold text-(--text)">{diskCheck?.nexus_project_id ? "On disk" : "Unverified"}</strong>
            <span>Last guard call: {last ? `${decisionLabel(last.decision)} ${timeAgo(last.ts)}` : "never"}</span>
          </div>
        </div>
      </Card>

      {blastWarnings.length > 0 && (
        <details className="nx-card shrink-0 !py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-(--text)">
            Shared account warning — {blastWarnings.length} login{blastWarnings.length === 1 ? "" : "s"} used by other projects
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-[12px] leading-[1.6] tabular-nums text-(--muted)">
            {blastWarnings.map((entry) => (
              <li key={entry.accountKey}>
                {entry.provider} · {entry.accountLabel} — also bound by {entry.projectIds.filter((id) => id !== project.id).map((id) => projects.find((p) => p.id === id)?.name ?? id).join(", ") || "another project"}.
                A compromised credential here reaches multiple workspaces.
              </li>
            ))}
          </ul>
        </details>
      )}

      {diskCheck && (
        <Card className="shrink-0">
          <CardHeading
            eyebrow="Verify on disk"
            title={diskDiffers ? "Folder differs — choose which wins" : "On disk matches"}
            action={<button type="button" onClick={() => setDiskCheck(null)} className={ghostLink}>Dismiss</button>}
          />
          <div className="flex flex-col gap-2 text-[13px] leading-[1.6]">
            <p className="tabular-nums text-(--text)">On disk: <span className="text-(--muted)">{diskSummary}</span></p>
            <p className="tabular-nums text-(--text)">Here: <span className="text-(--muted)">{project.name} · {project.environment} · {hereSummary}</span></p>
            {diskDiffers
              ? <p className="text-[12px] text-(--muted)">Agents opening this folder resolve the on-disk file until re-saved. Keep the disk version, or overwrite it with what is shown here.</p>
              : <p className="text-[12px] text-(--muted)">Agents opening this folder resolve exactly what is shown here.</p>}
          </div>
          {diskDiffers && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={() => setDiskCheck(null)} className={secondaryBtn}>Keep disk</button>
              <button type="button" onClick={() => void overwriteDisk()} disabled={overwriting || project.connections.length === 0} className={primaryBtn}>
                {overwriting ? "Overwriting…" : "Overwrite disk"}
              </button>
            </div>
          )}
        </Card>
      )}

      {!setupDone && (
        <Card className="flex min-h-[280px] shrink-0 flex-col overflow-visible">
          <CardHeading eyebrow="Setup" title={`${steps.filter((s) => s.done).length} of 3`} />
          <ol className="flex flex-col gap-1">
            {steps.map((step, i) => (
              <li key={step.label} className="flex items-center gap-3 border-t border-(--line) py-3 first:border-t-0 first:pt-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--raised) text-[11px] font-semibold tabular-nums text-(--muted)">{i + 1}</span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(step.done ? "green" : "pending")}>
                  {step.done ? "Done" : "Next"}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                  {step.label}
                  <small className="block truncate text-[12px] font-normal tabular-nums text-(--muted)">{step.detail}</small>
                </span>
                {i === 1 && !step.done && <button type="button" onClick={onAddConnection} className={smallBtn}>Connect</button>}
                {i === 2 && !step.done && <button type="button" onClick={() => void verifyOnDisk()} disabled={verifying} className={smallBtn}>{verifying ? "Checking…" : "Verify"}</button>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid shrink-0 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeading
            eyebrow="Guard"
            title={mine.length === 0 ? "No calls yet" : `${allowed} allowed · ${blocked} blocked`}
            action={GUARD_VISIBLE ? <button type="button" onClick={() => onView("guard")} className={ghostLink}>Open guard →</button> : undefined}
          />
          {lastBlock ? (
            <div className="flex flex-col gap-2"><AuditRow entry={lastBlock} /></div>
          ) : (
            <p className="text-[13px] leading-[1.6] text-(--muted)">
              {mine.length === 0 ? "Nothing mediated yet. Route an agent through Nexus and the verdicts land here." : "No blocks — every mediated call was allowed."}
            </p>
          )}
          {live && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-(--line) pt-4">
              <button type="button" onClick={() => void runGuardedRead()} disabled={liveChecking} className={smallBtn}>
                {liveChecking ? "Asking Supabase…" : liveCheck ? "Re-check approval live" : "Check approval live"}
              </button>
              {liveCheck && <small className="text-[12px] tabular-nums" style={{ color: liveCheck.ok ? "var(--green)" : "var(--red)" }}>{liveCheck.ok ? "✓ " : ""}{liveCheck.text}</small>}
            </div>
          )}
        </Card>
        <Card>
          <CardHeading
            eyebrow="Recent decisions"
            title={mine.length === 0 ? "Quiet" : `${mine.length} total`}
            action={<button type="button" onClick={() => onView("activity")} className={ghostLink}>View all →</button>}
          />
          {mine.length === 0 ? (
            <p className="text-[13px] leading-[1.6] text-(--muted)">Allowed, blocked, denied — each mediated call shows here with its reason.</p>
          ) : (
            <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto">{[...mine].slice(-4).reverse().map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} />)}</div>
          )}
        </Card>
      </div>

      <Card flush className="flex shrink-0 flex-col">
        <div className="px-5 pt-4"><CardHeading
          eyebrow="Bindings"
          title={project.connections.length === 0 ? "None yet — Supabase first" : `${connected.length}/${project.connections.length} connected`}
          action={<Button size="sm" variant="ghost" onPress={() => onView("bindings")}>Manage</Button>}
        /></div>
        {project.connections.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] leading-[1.6] text-(--muted)">
            No resources yet.{" "}
            <button type="button" onClick={onAddConnection} className="font-medium text-(--text) underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
              Connect a service in your browser
            </button>{" "}
            — pick the account and resource, the rest fills in.
          </p>
        ) : (
          <div className="flex min-h-0 flex-col">{project.connections.map((connection) => <ConnectionRow key={connection.id} connection={connection} accounts={accounts} />)}</div>
        )}
      </Card>
    </div>
  );
}

type ErrorRetry = { kind: "remove" | "write-file" | "link"; projectId: string; connectionId: string };

type ErrorRecord = { id: string; ts: string; where: string; message: string; debug?: string; retry?: ErrorRetry };

/** Stable identity for one kept error: the id when present, else the full
 *  composite so two distinct errors sharing a timestamp never collapse. */
function errorIdentity(record: ErrorRecord): string {
  if (record.id) return record.id;
  return [record.ts, record.where, record.message, record.retry?.projectId ?? "", record.retry?.connectionId ?? "", record.retry?.kind ?? ""].join("|");
}

function loadErrorLog(): ErrorRecord[] {
  try {
    const saved = window.localStorage.getItem("nexus-guard.errors");
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    // Backfill ids for logs kept before stable ids existed.
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Partial<ErrorRecord>;
      if (typeof record.ts !== "string" || typeof record.where !== "string" || typeof record.message !== "string") return [];
      return [{ id: typeof record.id === "string" && record.id ? record.id : makeId("error"), ts: record.ts, where: record.where, message: record.message, debug: typeof record.debug === "string" ? record.debug : undefined, retry: record.retry }];
    });
  } catch {
    return [];
  }
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[10px] border border-(--line) bg-(--panel) p-5 transition-[transform,opacity] duration-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--muted-2)">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-(--text)">{value}</p>
      <p className="mt-1.5 text-[12px] tabular-nums text-(--muted)">{detail}</p>
    </div>
  );
}

function ConnectionRow({ connection, accounts, keySaved, onSaveKey, onRemove, onEdit }: { connection: Connection; accounts?: Account[]; keySaved?: boolean; onSaveKey?: () => void; onRemove?: () => void; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);
  const eligible = connection.provider === "Supabase" && !!connection.projectRef && !!connection.url;
  const methodLabel = connection.method === "mcp" ? "Browser approval" : "Manual details";
  const connected = connection.authState === "connected";
  const accountLabel = accountLabelForConnection(connection, accounts ?? starterAccounts);
  const resourceLabel = connection.resource ?? connection.target;
  const stateLabel = connected ? "Connected" : connection.authState === "pending" ? "Pending" : keySaved ? "Key saved" : "Not verified";
  const stateTone = connected ? "success" : connection.authState === "pending" ? "warning" : keySaved ? "info" : "neutral";
  const tier = tierForProvider(connection.provider);
  function copyRef() {
    if (!connection.projectRef) return;
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(connection.projectRef).then(done).catch(() => undefined);
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-(--line-soft) px-5 py-3 first:border-t-0">
      <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{connection.short}</span>
      <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-[13.5px] font-semibold text-(--text)">{connection.provider}</strong>
          <Badge tone={tier === "native" ? "success" : tier === "curated" ? "info" : "warning"}>{tier}</Badge>
        </span>
        <span className="nx-mono truncate text-(--text)">{resourceLabel}</span>
        <span className="truncate text-[12px] text-(--muted)">
          {accountLabel ?? "Not linked"}{connection.environment ? ` · ${connection.environment}` : ""} · {methodLabel}
          {connection.projectRef && (
            <>
              {" · "}<span className="nx-mono">{connection.projectRef}</span>{" "}
              <button type="button" aria-label="Copy project reference" onClick={copyRef} className="underline underline-offset-2 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">{copied ? "Copied" : "Copy"}</button>
            </>
          )}
        </span>
      </span>
      <Badge tone={stateTone} dot>{stateLabel}</Badge>
      <span className="flex shrink-0 gap-1.5">
        {onSaveKey && eligible && (
          <Button size="sm" variant="outline" isDisabled={!desktopAvailable()} onPress={desktopAvailable() ? onSaveKey : undefined}>
            {!desktopAvailable() ? "Desktop only" : keySaved ? "Manage key" : "Save key"}
          </Button>
        )}
        {onEdit && <Button size="sm" variant="outline" onPress={onEdit}>Edit</Button>}
        {onRemove && <Button size="sm" variant="danger-soft" onPress={onRemove}>Remove</Button>}
      </span>
    </div>
  );
}

function ProjectsView({ projects, selectedProject, onSelect, onAdd, onEdit, onRemove }: { projects: Project[]; selectedProject: string; onSelect: (name: string) => void; onAdd: () => void; onEdit: (project: Project) => void; onRemove: (project: Project) => void }) {
  return (
    <div className="app-view flex w-full flex-col gap-4">
      <PageTitle
        description="One card per project: its folder, environment, and the resources it is bound to."
        action={<Button size="sm" onPress={onAdd}><NxIcon name="plus" size={15} />Add project</Button>}
      />
      {projects.length === 0 ? (
        <Card><Empty title="No projects yet" action={<Button size="sm" onPress={onAdd}>Add your first project</Button>}>Register a folder so Nexus knows which project an agent is in.</Empty></Card>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {projects.map((item) => {
            const selected = item.id === selectedProject;
            const shown = item.connections.slice(0, 4);
            return (
              <article key={item.id} className="nx-card flex flex-col gap-3" style={selected ? { borderColor: "var(--text)" } : undefined}>
                <button type="button" onClick={() => onSelect(item.id)} aria-label={`Select ${item.name}`} className="flex items-start gap-3 rounded-[10px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
                  <span className="nx-tile"><NxIcon name="folder" size={17} /></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className="truncate text-[15px] font-semibold text-(--text)">{item.name}</strong>
                    <span className="nx-mono truncate text-(--muted)">{item.path}</span>
                  </span>
                  <Badge tone={selected ? "success" : "neutral"} dot={selected}>{selected ? "Selected" : "Saved"}</Badge>
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={item.environment.toLowerCase().startsWith("prod") ? "warning" : "neutral"}>{item.environment}</Badge>
                  {shown.map((connection) => <span key={connection.id} className="nx-badge">{connection.provider} · {connection.resource ?? connection.target}</span>)}
                  {item.connections.length > shown.length && <span className="nx-badge">+{item.connections.length - shown.length}</span>}
                  {item.connections.length === 0 && <span className="text-[12px] text-(--muted)">No resources yet</span>}
                </div>
                <p className="truncate text-[12px] text-(--muted-2)">Branch {item.branch} · {item.repo}</p>
                <div className="mt-auto flex items-center justify-between border-t border-(--line-soft) pt-3">
                  <span className="text-[12px] tabular-nums text-(--muted)">{item.connections.length} connection{item.connections.length === 1 ? "" : "s"}</span>
                  <span className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onPress={() => onEdit(item)}>Edit</Button>
                    <Button size="sm" variant="danger-soft" onPress={() => onRemove(item)}>Remove</Button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DetectedAgent = { id: string; name: string; found: boolean; detail: string; nexus_config: string; http_reachable?: boolean; unmanaged?: UnmanagedMcpEntry[] };

function ConnectAgentPicker({ projects, agentId, onConnect }: { projects: Project[]; agentId: string; onConnect: (projectId: string, agentId: string | null) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  useEffect(() => { if (!projects.some((p) => p.id === projectId) && projects[0]) setProjectId(projects[0].id); }, [projects, projectId]);
  return (
    <span className="flex items-center gap-2">
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project to connect" className="h-8 max-w-[140px] rounded-[6px] border border-(--line) bg-(--panel) px-2 text-[12px] tabular-nums text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" onClick={() => projectId && onConnect(projectId, agentId)} className={smallBtn}>Connect</button>
    </span>
  );
}

type AgentTestStep = { step: string; ok: boolean; detail: string };

function ConnectAgentModal({ project, initialAgentId, onClose }: { project: Project; initialAgentId: string | null; onClose: () => void }) {
  const agentOptions = [
    { id: "claude", name: "Claude Code", file: ".mcp.json" },
    { id: "pi", name: "Pi agent", file: ".mcp.json" },
    { id: "opencode", name: "OpenCode", file: "opencode.json" },
    { id: "codex", name: "Codex", file: ".codex/config.toml" },
    { id: "other", name: "Other agent (manual)", file: "your agent's MCP config" },
  ];
  const [agentId, setAgentId] = useState(initialAgentId ?? "claude");
  const isManual = agentId === "other";
  const [copied, setCopied] = useState("");
  // Bridge/keychain paths: no absolute defaults are baked in — a personal
  // checkout path would break every other machine. Resolution order:
  //   1. the developer's explicit override, persisted in localStorage;
  //   2. empty = unresolved: pick via Browse below (dev checkout:
  //      <repo>/mcp/nexus-server.mjs with the helper at
  //      target/debug/nexus-keyring; packaged app: both next to app
  //      resources) or type the path. The backend re-validates presence and
  //      the readiness check reports a missing bridge per project.
  // Node itself is resolved at runtime via the backend `node_binary_path`
  // command (PATH search + nvm fallback), never a baked-in path.
  const [bridgePath, setBridgePath] = useState(() => window.localStorage.getItem("nexus-guard.bridge-path") ?? "");
  const [keyringPath, setKeyringPath] = useState(() => window.localStorage.getItem("nexus-guard.keyring-path") ?? "");
  const [picking, setPicking] = useState<"bridge" | "keyring" | null>(null);
  const [busy, setBusy] = useState(false);
  const [writtenEdit, setWrittenEdit] = useState<AgentConfigEdit | null>(null);
  const [steps, setSteps] = useState<AgentTestStep[]>([]);
  const [error, setError] = useState("");
  const [nodeBin, setNodeBin] = useState("node");
  const desktop = desktopAvailable();
  const agent = agentOptions.find((a) => a.id === agentId)!;
  // CLI-first (single HTTP instance): workspace-bound via the shared
  // onboarding helpers. One server, one registration per project.
  const httpUrl = nexusHttpUrlFor(project.path);
  const claudeCmd = claudeHttpCommand(project.path);
  const codexCmd = codexHttpCommand(project.path);

  useEffect(() => {
    if (!desktop) return;
    invoke<string>("node_binary_path").then(setNodeBin).catch(() => undefined);
  }, [desktop]);

  async function browseFor(kind: "bridge" | "keyring") {
    setPicking(kind);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, title: kind === "bridge" ? "Locate nexus-server.mjs" : "Locate the Nexus keychain helper" });
      if (typeof selected === "string" && selected) {
        if (kind === "bridge") setBridgePath(selected); else setKeyringPath(selected);
      }
    } catch { /* keep the typed path */ }
    finally { setPicking(null); }
  }

  async function retestOnly() {
    if (!desktop) { setError("Open the desktop app to write agent configs."); return; }
    setBusy(true); setError("");
    try {
      const results = await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, bridgePath });
      setSteps(results);
    } catch {
      setError("Could not check this project. Check the project folder path, then try again.");
    } finally {
      setBusy(false);
    }
  }

  async function writeAndTest() {
    if (!desktop) { setError("Open the desktop app to write agent configs."); return; }
    if (isManual) {
      await retestOnly();
      return;
    }
    if (!bridgePath.trim() || !keyringPath.trim()) {
      setError("Pick the bridge script and keychain helper under “Bridge paths” first — Nexus assumes no default until you point it at this install.");
      return;
    }
    // Pre-write confirm: the fallback writer merges into the agent's project
    // config, backs up first, and the backend returns the diff + backup path.
    if (!window.confirm(`Write the Nexus fallback entry into ${agent.file} in “${project.path}”?\n\nNexus backs up the existing file first and shows the diff + backup path afterwards. Prefer the CLI commands above (HTTP-only); this file fallback writes a stdio bridge.`)) return;
    setBusy(true); setError(""); setSteps([]); setWrittenEdit(null);
    try {
      window.localStorage.setItem("nexus-guard.bridge-path", bridgePath);
      window.localStorage.setItem("nexus-guard.keyring-path", keyringPath);
      const result = await invoke<string | AgentConfigEdit>("connect_agent_to_project", { workspacePath: project.path, agentId, bridgePath, keyringPath, nodePath: null, httpUrl });
      const edit: AgentConfigEdit = typeof result === "string" ? { path: result, backup: "", diff: "" } : result;
      setWrittenEdit(edit);
      const results = await invoke<AgentTestStep[]>("test_agent_setup", { workspacePath: project.path, agentId, bridgePath });
      setSteps(results);
    } catch {
      setError("Could not connect that agent. Check the project folder path, then try again.");
    } finally {
      setBusy(false);
    }
  }

  // Manual snippets reflect the same fields; unresolved paths render as
  // placeholders the developer must replace before pasting.
  const manualBridge = bridgePath.trim() || "<path-to>/nexus-server.mjs";
  const manualKeyring = keyringPath.trim() || "<path-to>/nexus-keyring";
  const manualJson = JSON.stringify({ mcpServers: { nexus: { command: nodeBin, args: [manualBridge], env: { NEXUS_KEYRING_BIN: manualKeyring } } } }, null, 2);
  const manualToml = `# Nexus Guard MCP bridge for ${project.name}\n[mcp_servers.nexus]\ncommand = "${nodeBin}"\nargs = ["${manualBridge}"]\ncwd = "${project.path}"\ntool_timeout_sec = 30\nenv = { NEXUS_KEYRING_BIN = "${manualKeyring}" }`;

  function copyText(kind: string, text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(kind);
        window.setTimeout(() => setCopied(""), 1500);
      }).catch(() => undefined);
    }
  }

  const allOk = steps.length > 0 && steps.every((s) => s.ok);
  const anyFail = steps.some((s) => !s.ok);
  return (
    <Modal title={`Connect ${agent.name} to ${project.name}`} description="Register the agent CLI against the single Nexus HTTP instance first; the file writer below is a legacy fallback." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-[8px] border border-(--line)">
          <div className="border-b border-(--line) bg-(--canvas) px-3 py-2">
            <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">Preferred · CLI-first over HTTP (bound to {project.name})</strong>
          </div>
          <ul className="divide-y divide-(--line-soft)">
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-(--text)">{claudeCmd}</span>
              <button type="button" onClick={() => copyText("cli-claude", claudeCmd)} className={ghostLink}>{copied === "cli-claude" ? "Copied" : "Copy"}</button>
            </li>
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-(--text)">{codexCmd}</span>
              <button type="button" onClick={() => copyText("cli-codex", codexCmd)} className={ghostLink}>{copied === "cli-codex" ? "Copied" : "Copy"}</button>
            </li>
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-(--text)">{httpUrl}</span>
              <button type="button" onClick={() => copyText("cli-url", httpUrl)} className={ghostLink}>{copied === "cli-url" ? "Copied" : "Copy"}</button>
            </li>
          </ul>
          <p className="border-t border-(--line) bg-(--canvas) px-3 py-2 text-[12px] leading-[1.6] text-(--muted)">
            HTTP-only: run one command per project — the workspace in the URL is what pins the agent to {project.name}. A registration without a workspace is refused, never guessed.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Agent (legacy file fallback)</span>
          <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setSteps([]); setWrittenEdit(null); }} disabled={busy} className={selectClass}>
            {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name} → {a.file}</option>)}
          </select>
        </label>
        <Note>
          {isManual
            ? <>Copy the snippet into your agent&apos;s MCP settings, pointed at <strong>{project.path}</strong> as its working directory. Then run the readiness check below, mint a session (<kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">POST /session</kbd> with this workspace), and call <kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">nexus.context</kbd> with that session from the agent — it must answer {project.name}.</>
            : <>Fallback writes <strong>{agent.file}</strong> in <strong>{project.path}</strong> as a stdio bridge — that defeats the single-HTTP-instance lock, so prefer the CLI commands above. The fallback still checks the project file, bridge script, saved approval, and the written config. Restart {agent.name} in that folder afterwards.</>}
        </Note>
        {isManual && (
          <>
            <div className="overflow-hidden rounded-[8px] border border-(--line)">
              <div className="flex items-center justify-between border-b border-(--line) bg-(--canvas) px-3 py-2">
                <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">JSON style (Claude / Pi / Cursor / Windsurf)</strong>
                <button type="button" onClick={() => copyText("json", manualJson)} className={ghostLink}>{copied === "json" ? "Copied" : "Copy"}</button>
              </div>
              <pre className="m-0 overflow-x-auto whitespace-pre bg-(--panel) px-3 py-3 font-mono text-[11px] leading-[1.6] tabular-nums">{manualJson}</pre>
            </div>
            <div className="overflow-hidden rounded-[8px] border border-(--line)">
              <div className="flex items-center justify-between border-b border-(--line) bg-(--canvas) px-3 py-2">
                <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">TOML style (Codex)</strong>
                <button type="button" onClick={() => copyText("toml", manualToml)} className={ghostLink}>{copied === "toml" ? "Copied" : "Copy"}</button>
              </div>
              <pre className="m-0 overflow-x-auto whitespace-pre bg-(--panel) px-3 py-3 font-mono text-[11px] leading-[1.6] tabular-nums">{manualToml}</pre>
            </div>
            <Note>
              Launch the agent with {project.path} as its working directory — that folder is what pins it to {project.name}. A different working directory resolves a different project (or none).
            </Note>
          </>
        )}
        <details className="rounded-[8px] border border-(--line) px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-(--muted)">Bridge paths (advanced)</summary>
          <div className="flex flex-col gap-3 py-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Bridge script</span>
              <span className="flex gap-2">
                <input value={bridgePath} onChange={(e) => setBridgePath(e.target.value)} placeholder="…/mcp/nexus-server.mjs" className={inputClass} />
                {desktop && <button type="button" onClick={() => void browseFor("bridge")} disabled={picking !== null} className={secondaryBtn}>{picking === "bridge" ? "…" : "Browse"}</button>}
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Keychain helper</span>
              <span className="flex gap-2">
                <input value={keyringPath} onChange={(e) => setKeyringPath(e.target.value)} placeholder="…/nexus-keyring" className={inputClass} />
                {desktop && <button type="button" onClick={() => void browseFor("keyring")} disabled={picking !== null} className={secondaryBtn}>{picking === "keyring" ? "…" : "Browse"}</button>}
              </span>
            </label>
            <small className="text-[12px] leading-[1.6] text-(--muted)">No default is assumed: in a dev checkout the bridge is {"<repo>/mcp/nexus-server.mjs"} and the helper is {"target/debug/nexus-keyring"}; in a packaged app both sit next to app resources. Browse once and Nexus remembers.</small>
          </div>
        </details>
        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
        {!isManual && writtenEdit && (
          <div className="rounded-[8px] border border-(--line) bg-(--canvas) px-3 py-2.5 text-[12px] leading-[1.6] tabular-nums text-(--muted)">
            <p className="font-medium text-(--text)">Wrote {writtenEdit.path}</p>
            {writtenEdit.diff && <p>Diff: {writtenEdit.diff}</p>}
            {writtenEdit.backup
              ? <p>Backup: {writtenEdit.backup} — existing entries for other servers were kept.</p>
              : <p>No backup — new file; existing entries for other servers were kept.</p>}
          </div>
        )}
        {steps.length > 0 && (
          <div className="flex flex-col gap-2">
          <ul className="divide-y divide-(--line-soft) rounded-[8px] border border-(--line)">
            {steps.map((step) => (
              <li key={step.step} className="flex items-center gap-3 px-3 py-2.5">
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(step.ok ? "green" : "red")}>
                  {step.ok ? "Pass" : "Fail"}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                  {step.step}
                  <small className="block text-[12px] font-normal tabular-nums text-(--muted)">{step.detail}</small>
                </span>
              </li>
            ))}
          </ul>
          {anyFail && (
            <button type="button" onClick={() => void retestOnly()} disabled={busy || !desktop} className={secondaryBtn} style={{ alignSelf: "flex-start" }}>
              {busy ? "Retrying…" : "Retry failed checks"}
            </button>
          )}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>Close</button>
          <button type="button" onClick={() => void writeAndTest()} disabled={busy || !desktop} className={primaryBtn}>
            {busy ? "Working…" : isManual ? "Check project readiness" : writtenEdit ? "Re-run test" : "Write fallback config and test"}
          </button>
        </div>
        {allOk && !isManual && <Note>All Nexus-side checks pass. Restart {agent.name} in the project folder; its Supabase calls now go through guard.</Note>}
        {allOk && isManual && <Note>Project side is ready. Paste a snippet above, restart your agent in the project folder, mint a session via <kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">POST /session</kbd>, and confirm <kbd className="rounded-[4px] border border-(--line) bg-(--panel) px-1.5 py-0.5 font-mono text-[11px]">nexus.context</kbd> answers {project.name}.</Note>}
      </div>
    </Modal>
  );
}

function AgentsView({ projects, onConnect }: { projects: Project[]; onConnect: (projectId: string, agentId: string | null) => void }) {
  const [agents, setAgents] = useState<DetectedAgent[] | null>(null);
  const [cliCopied, setCliCopied] = useState("");
  const [entryBusy, setEntryBusy] = useState<string | null>(null);
  const [entryMsg, setEntryMsg] = useState<Record<string, string>>({});
  // Registration is per project: the endpoint is shared, but the workspace is
  // what tells Nexus which project an agent is in. A command without one is
  // refused by the bridge, so the snippets bind to a chosen project.
  const [cliProjectId, setCliProjectId] = useState(projects[0]?.id ?? "");
  const cliProject = projects.find((p) => p.id === cliProjectId) ?? projects[0];
  const boundHttpUrl = nexusHttpUrlFor(cliProject?.path ?? "");
  const claudeHttpCmd = claudeHttpCommand(cliProject?.path ?? "");
  const codexHttpCmd = codexHttpCommand(cliProject?.path ?? "");
  // Project-level scan (scan_project_mcp): direct entries living in this
  // project's workspace configs (.mcp.json, opencode.json,
  // .codex/config.toml), listed alongside the global unmanaged[] that
  // detect_agents reports per agent below. Read-only until Import/Remove.
  const [projectEntries, setProjectEntries] = useState<UnmanagedMcpEntry[] | null>(null);
  const cliWorkspace = cliProject?.path ?? "";
  function refreshProjectEntries(workspace: string) {
    if (!desktopAvailable() || !workspace) { setProjectEntries(null); return; }
    invoke<UnmanagedMcpEntry[]>("scan_project_mcp", { workspacePath: workspace })
      .then(setProjectEntries)
      .catch(() => setProjectEntries([]));
  }
  function copyCli(kind: string, text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCliCopied(kind);
        window.setTimeout(() => setCliCopied(""), 1500);
      }).catch(() => undefined);
    }
  }
  function refreshAgents() {
    if (!desktopAvailable()) return;
    invoke<DetectedAgent[]>("detect_agents").then(setAgents).catch(() => setAgents([]));
  }
  async function importEntry(agentId: string, entry: UnmanagedMcpEntry) {
    if (!cliProject) return;
    if (!window.confirm(`Import “${entry.name}” (${entry.source}) onto Nexus for “${cliProject.name}”?\n\nNexus backs up the agent config first, then points this entry at the workspace-bound HTTP URL. Unknown entries are never silently re-routed.`)) return;
    setEntryBusy(`${agentId}:${entry.name}:import`); setEntryMsg((m) => ({ ...m }));
    try {
      const edit = await invoke<AgentConfigEdit>("import_agent_entry", { workspacePath: cliProject.path, agentId, name: entry.name, url: boundHttpUrl });
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: `Imported at ${edit.path}. Diff: ${edit.diff}${edit.backup ? ` Backup: ${edit.backup}` : " (new file, no backup)"}` }));
      refreshAgents();
      refreshProjectEntries(cliProject.path);
    } catch (e) {
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: e instanceof Error ? e.message : "Could not import that entry." }));
    } finally {
      setEntryBusy(null);
    }
  }
  async function removeEntry(agentId: string, entry: UnmanagedMcpEntry) {
    if (!cliProject) return;
    if (!window.confirm(`Remove direct entry “${entry.name}” (${entry.source}) for “${cliProject.name}”?\n\nNexus backs up the agent config first and shows the removed value + backup path afterwards. This deletes the direct route — the agent loses that provider until re-added.`)) return;
    setEntryBusy(`${agentId}:${entry.name}:remove`); setEntryMsg((m) => ({ ...m }));
    try {
      const edit = await invoke<AgentConfigEdit>("remove_agent_entry", { workspacePath: cliProject.path, agentId, name: entry.name });
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: `Removed from ${edit.path}. Diff: ${edit.diff}${edit.backup ? ` Backup: ${edit.backup}` : ""}` }));
      refreshAgents();
      refreshProjectEntries(cliProject.path);
    } catch (e) {
      setEntryMsg((m) => ({ ...m, [`${agentId}:${entry.name}`]: e instanceof Error ? e.message : "Could not remove that entry." }));
    } finally {
      setEntryBusy(null);
    }
  }
  /** Workspace config file → owning agent for import/remove.
   *  Claude and Pi share .mcp.json, so either id writes the same file. */
  function agentForProjectEntry(entry: UnmanagedMcpEntry): string {
    const source = entry.source.toLowerCase();
    if (source.includes("opencode")) return "opencode";
    if (source.includes("codex") || source.includes("config.toml")) return "codex";
    return "claude";
  }
  const desktop = desktopAvailable();
  useEffect(() => {
    if (!desktop) return;
    refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);
  useEffect(() => {
    refreshProjectEntries(cliWorkspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, cliWorkspace]);
  const found = (agents ?? []).filter((a) => a.found);

  /** One direct (unmanaged) MCP entry with Import / Remove, shared by the
   *  project scan and each detected agent. */
  function entryRow(entry: UnmanagedMcpEntry, agentId: string, where: string) {
    const key = `${agentId}:${entry.name}`;
    const busy = entryBusy === `${key}:import` || entryBusy === `${key}:remove`;
    return (
      <li key={`${entry.source}:${entry.name}`} className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <Badge tone="warning">Unmanaged</Badge>
        <span className="nx-row-body min-w-[160px]">
          <span className="nx-mono text-(--text)">{entry.name}</span>
          <span className="nx-row-sub">{where} · bypasses Nexus until imported</span>
        </span>
        <Button size="sm" variant="outline" isDisabled={busy || !desktop || !cliProject} onPress={() => void importEntry(agentId, entry)}>{entryBusy === `${key}:import` ? "Importing…" : "Import onto Nexus"}</Button>
        <Button size="sm" variant="danger-soft" isDisabled={busy || !desktop || !cliProject} onPress={() => void removeEntry(agentId, entry)}>{entryBusy === `${key}:remove` ? "Removing…" : "Remove direct"}</Button>
        {entryMsg[key] && <small className="w-full text-[11.5px] leading-[1.6] text-(--muted)">{entryMsg[key]}</small>}
      </li>
    );
  }

  function commandRow(kind: string, text: string, label: string) {
    return (
      <li className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="nx-row-body">
          <span className="nx-mono break-all text-(--text)" style={{ whiteSpace: "normal" }}>{text}</span>
          <span className="nx-row-sub" style={{ whiteSpace: "normal" }}>{label}</span>
        </span>
        <Button size="sm" variant="outline" onPress={() => copyCli(kind, text)}>{cliCopied === kind ? "Copied" : "Copy"}</Button>
      </li>
    );
  }

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle description="Coding agents detected on this machine. Detection is not registration: an agent only goes through Nexus once it is registered against the single HTTP instance for its project." />
      <Card flush>
        <div className="px-5 pt-4">
          <CardHeading
            eyebrow="Recommended · CLI over HTTP"
            title="Point the agent at Nexus, not the provider"
            action={
              projects.length > 0 ? (
                <label className="flex items-center gap-2 text-[12px] text-(--muted)">
                  <span>Register for</span>
                  <select value={cliProject?.id ?? ""} onChange={(event) => setCliProjectId(event.target.value)} aria-label="Project these commands register" className="h-8 rounded-[10px] border border-(--line) bg-(--panel) px-2 text-[12px] text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
                    {projects.map((project) => (<option key={project.id} value={project.id}>{project.name}</option>))}
                  </select>
                </label>
              ) : (
                <Badge tone="warning">Register a project first</Badge>
              )
            }
          />
        </div>
        <ul>
          {commandRow("url", boundHttpUrl, `Nexus HTTP endpoint · port 3939 by default · ${cliProject ? `bound to ${cliProject.name}. Register each project separately; a request with no workspace is refused, never guessed.` : "add a project to get a registration command."}`)}
          {commandRow("claude", claudeHttpCmd, "Claude Code · HTTP transport, bound to this project")}
          {commandRow("codex", codexHttpCmd, "Codex · URL registration, bound to this project")}
        </ul>
        <p className="border-t border-(--line-soft) px-5 py-3 text-[12px] leading-[1.6] text-(--muted)">
          Register with the CLI commands above. The per-folder fallback below writes a stdio bridge, which defeats the single-instance lock, so prefer the CLI. A direct <span className="nx-mono">supabase-direct-unmanaged</span> entry bypasses Nexus entirely: calls there are not guarded and never appear in Activity.
        </p>
      </Card>

      {desktop && cliProject && projectEntries !== null && projectEntries.length > 0 && (
        <Card flush>
          <div className="px-5 pt-4"><CardHeading eyebrow={`Project scan · ${cliProject.name}`} title={`${projectEntries.length} direct ${projectEntries.length === 1 ? "entry" : "entries"} in workspace configs`} /></div>
          <ul>{projectEntries.map((entry) => entryRow(entry, agentForProjectEntry(entry), `${entry.source} · ${agentForProjectEntry(entry)}`))}</ul>
        </Card>
      )}

      {!desktop && (
        <Card><Empty title="Open the desktop app">Agent detection needs local machine access. The browser preview cannot see installed agents.</Empty></Card>
      )}
      {desktop && agents === null && (
        <Card>
          <div className="mx-auto flex max-w-[420px] flex-col gap-2 py-4" aria-label="Scanning for agents">
            <div className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />
            <div className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />
            <p className="mt-2 text-center text-[13px] text-(--muted)">Looking for known agent commands and configs.</p>
          </div>
        </Card>
      )}
      {desktop && agents !== null && agents.length === 0 && (
        <Card><Empty title="No agents detected">None of the known agent commands or configs were found. An agent appearing later still bypasses Nexus until its project config points at the bridge.</Empty></Card>
      )}
      {desktop && found.length > 0 && (
        <Card flush>
          <div className="px-5 pt-4"><CardHeading eyebrow="Detected on this machine" title={`${found.length} agent${found.length === 1 ? "" : "s"} found`} /></div>
          <ul>
            {found.map((agent) => {
              const unmanaged = agent.unmanaged ?? [];
              return (
                <li key={agent.id} style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="nx-tile text-[11px] font-semibold" data-tone="success" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
                    <span className="nx-row-body min-w-[140px]">
                      <span className="nx-row-title">{agent.name}</span>
                      <span className="nx-row-sub">{agent.detail}</span>
                    </span>
                    <span className="nx-row-body min-w-[140px]">
                      <span className="nx-row-sub">Route via Nexus</span>
                      <span className="nx-row-sub nx-mono" title={agent.nexus_config}>{agent.nexus_config}</span>
                    </span>
                    <ConnectAgentPicker projects={projects} agentId={agent.id} onConnect={onConnect} />
                  </div>
                  {unmanaged.length > 0 && <ul className="bg-(--raised)">{unmanaged.map((entry) => entryRow(entry, agent.id, entry.source))}</ul>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {desktop && <Note>Live traffic lives on Home. This tab only sets agents up and shows whether each one is connected.{agents !== null && agents.some((a) => !a.found) ? ` Not seen: ${agents.filter((a) => !a.found).map((a) => a.name).join(", ")}.` : ""} A detected agent with a direct provider setup bypasses Nexus until its project config points at the bridge.</Note>}
    </div>
  );
}

function BindingsView({ project, projects, accounts, onAdd, vaultUnlocked, savedKeys, onSaveKey, onRemove, onEdit, onOpenServices }: { project: Project; projects?: Project[]; accounts: Account[]; onAdd: () => void; vaultUnlocked: boolean; savedKeys: Record<string, boolean>; onSaveKey: (connection: Connection) => void; onRemove: (connection: Connection) => void; onEdit: (connection: Connection) => void; onOpenServices?: () => void }) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const visible = project.connections.filter((c) => !query || [c.provider, c.target, c.resource, c.accountId, c.account, c.environment, c.detail, c.authState, c.method].some((field) => (field ?? "").toLowerCase().includes(query)));
  const unlinked = project.connections.filter((c) => !c.accountId && !c.account);
  // Per-project shared-account warning (accounts.ts helper).
  const blastWarnings = blastRadiusWarningsFor(project.id, projects ?? [project], accounts);
  return (
    <div className="app-view flex w-full flex-col gap-4">
      <PageTitle
        description="Link a login once under Services, then bind one account and resource per project here. Bindings are per-project pairs, never raw secrets."
        action={<Button size="sm" onPress={onAdd}><NxIcon name="plus" size={15} />Add binding</Button>}
      />
      {blastWarnings.length > 0 && (
        <details className="nx-card shrink-0 !py-3">
          <summary className="cursor-pointer text-[13px] font-medium text-(--text)">
            <Badge tone="warning">Shared</Badge>{" "}{blastWarnings.length} login{blastWarnings.length === 1 ? "" : "s"} also bound elsewhere
          </summary>
          <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] leading-[1.6] text-(--muted)">
            {blastWarnings.map((entry) => (
              <li key={entry.accountKey}>
                <strong className="font-medium text-(--text)">{entry.provider} · {entry.accountLabel}</strong> is also bound by {(projects ?? [project]).filter((p) => p.id !== project.id && entry.projectIds.includes(p.id)).map((p) => p.name).join(", ") || "another project"}.
                A compromised credential here reaches multiple workspaces.
              </li>
            ))}
          </ul>
        </details>
      )}
      {unlinked.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-[12px] bg-(--orange-bg) px-4 py-3 text-[12.5px] leading-[1.5] text-(--orange)">
          <span className="min-w-0 flex-1">{unlinked.length} binding{unlinked.length === 1 ? "" : "s"} without a linked account. Link the login under Services first, then Edit the binding to pick it.</span>
          {onOpenServices && <Button size="sm" variant="outline" onPress={onOpenServices}>Open Services</Button>}
        </div>
      )}
      {project.connections.length > 3 && (
        <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter bindings" placeholder="Filter bindings…" className={inputClass} style={{ maxWidth: 340 }} />
      )}
      <Card flush className="flex min-h-0 flex-col">
        {visible.length === 0 ? (
          <Empty title={project.connections.length === 0 ? "Nothing bound yet" : "No bindings match that filter"} action={project.connections.length === 0 ? <Button size="sm" onPress={onAdd}>Add the first binding</Button> : undefined}>
            {project.connections.length === 0 ? "Bind one account and resource so agents in this project reach the right service." : "Try a different word."}
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {visible.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} accounts={accounts} keySaved={connection.keySaved || (vaultUnlocked && savedKeys[connection.id])} onSaveKey={() => onSaveKey(connection)} onRemove={() => onRemove(connection)} onEdit={() => onEdit(connection)} />
            ))}
          </div>
        )}
      </Card>
      <Note><strong className="font-semibold text-(--text)">Bindings are not services.</strong> A binding is this project&apos;s account and resource pair. A saved publishable key stays in this desktop vault. Agents receive guarded tools.</Note>
    </div>
  );
}

function ServicesView({ projects, accounts, onAddAccount, onRemoveAccount }: { projects: Project[]; accounts: Account[]; onAddAccount: (input: { provider: string; label: string }) => void; onRemoveAccount: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [accountModal, setAccountModal] = useState(false);
  const blastRadius = detectBlastRadius(projects, accounts);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const q = query.trim().toLowerCase();
  const categories = ["All", ...[...new Set(PROVIDER_CATALOG.flatMap((p) => p.tags))].sort()];
  const visibleAccounts = accounts.filter((a) => !q || [a.provider, a.label, a.id, a.authState].some((f) => (f ?? "").toLowerCase().includes(q)));
  const visibleCatalog = PROVIDER_CATALOG.filter((p) => (category === "All" || p.tags.includes(category)) && (!q || [p.provider, p.tier, ...p.tags].some((f) => f.toLowerCase().includes(q))));
  const tierTone = (tier: string): Tone => (tier === "native" ? "success" : tier === "curated" ? "info" : "warning");

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        description="Link provider accounts once, then bind one account and resource per project under Bindings. Unreviewed services stay fail-closed until you allow them."
        action={<Button size="sm" onPress={() => setAccountModal(true)}><NxIcon name="plus" size={15} />Link account</Button>}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <label className="flex min-w-[240px] items-center gap-2 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-2 text-(--muted)">
          <NxIcon name="search" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter services" placeholder="Search services…" className="min-w-0 flex-1 bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted-2)" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          {categories.map((name) => (
            <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)} className="nx-badge cursor-pointer !px-3 !py-1.5 text-[12px]" data-tone={category === name ? "success" : undefined} style={category === name ? { background: "var(--text)", color: "var(--canvas)" } : undefined}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <Card flush className="flex min-h-[320px] flex-col lg:max-h-[620px]">
          <div className="px-5 pt-4"><CardHeading eyebrow="Service catalog" title={`${visibleCatalog.length} known`} /></div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visibleCatalog.map((entry) => (
              <li key={entry.provider} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{entry.provider.slice(0, 2).toUpperCase()}</span>
                <span className="nx-row-body">
                  <span className="nx-row-title">{entry.provider}</span>
                  <span className="nx-row-sub">{entry.tags.join(" · ")}</span>
                </span>
                <Badge tone={tierTone(entry.tier)}>{entry.tier}</Badge>
              </li>
            ))}
            {visibleCatalog.length === 0 && <li><Empty title="No services match">Try a different word or category.</Empty></li>}
          </ul>
          <p className="shrink-0 border-t border-(--line-soft) px-5 py-3 text-[12px] leading-[1.6] text-(--muted)">Anything outside this list can be linked as self-added. Every action stays fail-closed until you reclassify it.</p>
        </Card>
        <div className="flex min-h-0 flex-col gap-4">
          <Card flush className="flex flex-col">
            <div className="px-5 pt-4"><CardHeading eyebrow="Account registry" title={`${visibleAccounts.length} account${visibleAccounts.length === 1 ? "" : "s"}`} /></div>
            {visibleAccounts.length === 0 ? (
              <Empty title="No accounts match">Link a login to bind it to projects.</Empty>
            ) : (
              <ul className="max-h-[360px] overflow-y-auto">
                {visibleAccounts.map((account) => {
                  const inUse = projects.filter((p) => (p.connections ?? []).some((c) => (c.accountId ?? c.account) === account.id)).length;
                  const tier = tierForProvider(account.provider);
                  return (
                    <li key={account.id} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{account.provider.slice(0, 2).toUpperCase()}</span>
                      <span className="nx-row-body">
                        <span className="nx-row-title">{account.provider} · {account.label}</span>
                        <span className="nx-row-sub"><span className="nx-mono" title={account.id}>{account.id}</span>{inUse > 0 ? ` · bound by ${inUse}` : ""}</span>
                      </span>
                      <Badge tone={tierTone(tier)}>{tier}</Badge>
                      <Button size="sm" variant="danger-soft" onPress={() => onRemoveAccount(account.id)}>Remove</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card flush>
            <div className="px-5 pt-4"><CardHeading eyebrow="Blast radius" title={blastRadius.length === 0 ? "No shared accounts" : `${blastRadius.length} shared account${blastRadius.length === 1 ? "" : "s"}`} /></div>
            {blastRadius.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] leading-[1.6] text-(--muted)">Each account is used by a single project. Sharing one login across projects widens what a compromised credential can reach.</p>
            ) : (
              <ul>
                {blastRadius.map((entry) => (
                  <li key={entry.accountKey} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                    <Badge tone="warning">Shared</Badge>
                    <span className="nx-row-body">
                      <span className="nx-row-title">{entry.provider} · {entry.accountLabel}</span>
                      <span className="nx-row-sub">{entry.projectIds.map(projectName).join(" · ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {accountModal && <AddAccountModal onClose={() => setAccountModal(false)} onSave={(input) => { onAddAccount(input); setAccountModal(false); }} />}
    </div>
  );
}

function AddAccountModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { provider: string; label: string }) => void }) {
  const [provider, setProvider] = useState("Supabase");
  const [customProvider, setCustomProvider] = useState("");
  const [label, setLabel] = useState("personal");
  const catalogProviders = [...PROVIDER_CATALOG.map((p) => p.provider), "Other…"];
  const effectiveProvider = provider === "Other…" ? customProvider.trim() : provider;
  const tier = effectiveProvider ? tierForProvider(effectiveProvider) : "self-added";
  // Paper: self-added services need an explicit 2-step confirm — fail-closed
  // restated, explicit confirm click before save.
  const [selfAddedConfirm, setSelfAddedConfirm] = useState(false);
  useEffect(() => { setSelfAddedConfirm(false); }, [effectiveProvider]);
  const canSave = effectiveProvider.length > 0 && (tier !== "self-added" || selfAddedConfirm);

  return (
    <Modal title="Link a new login" description="Link a provider login once, then bind it to projects under Bindings." onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave({ provider: effectiveProvider, label: label.trim() || "personal" });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Service</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={selectClass}>
              {catalogProviders.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Account label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="personal" className={inputClass} />
          </label>
        </div>
        {provider === "Other…" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Custom service name</span>
            <input value={customProvider} onChange={(e) => setCustomProvider(e.target.value)} placeholder="Acme API" className={inputClass} />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(tier === "native" ? "green" : tier === "curated" ? "blue" : "pending")}>
            {tier}
          </span>
          {tier === "self-added" && <small className="text-[12px] text-(--muted)">This service hasn&apos;t been reviewed by Nexus — every action stays fail-closed (denied until you allow it) until you reclassify it.</small>}
        </div>
        {tier === "self-added" && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-(--line) bg-(--canvas) p-3 text-[12px] leading-[1.6] text-(--muted)">
            <input type="checkbox" checked={selfAddedConfirm} onChange={(e) => setSelfAddedConfirm(e.target.checked)} className="mt-1 accent-(--text)" />
            <span>I understand this login is unreviewed and fail-closed — agents get nothing from it until I bind it and explicitly allow calls.</span>
          </label>
        )}
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Add account</button>
        </div>
      </form>
    </Modal>
  );
}

type AuditEntry = {
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
  workspace?: string;
};

async function readAuditLogs(projects: Project[], limit = 50): Promise<AuditEntry[]> {
  if (!desktopAvailable()) return [];
  const settled = await Promise.allSettled(projects.map(async (item) => {
    const entries = await invoke<AuditEntry[]>("read_audit_log", { workspacePath: item.path, limit });
    return entries.map((entry) => ({ ...entry, workspace: item.path }));
  }));
  const merged = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return merged.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
}

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

function useAuditLog(projects: Project[]) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  // Stable identity: only workspace membership drives refetch. Editing names,
  // connections, or other fields on every keystroke-save must not re-hit
  // `read_audit_log` for every project.
  const workspacesKey = projects.map((item) => `${item.id}:${item.path}`).join("|");
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setEntries(await readAuditLogs(projectsRef.current)); } catch { setEntries([]); }
    finally { setBusy(false); setLoaded(true); }
  }, []);
  useEffect(() => {
    // Debounced so rapid folder edits collapse into a single read.
    const timer = window.setTimeout(() => { void refresh(); }, 150);
    return () => window.clearTimeout(timer);
  }, [workspacesKey, refresh]);
  return { entries, loaded, busy, refresh };
}

function GuardView({ projects, onSetOverride }: { projects: Project[]; onSetOverride: (projectId: string, connectionId: string, override: string | null) => void }) {
  const { entries, loaded, busy, refresh } = useAuditLog(projects);
  const desktop = desktopAvailable();
  const allowed = entries.filter((e) => e.decision === "allow").length;
  const blocked = entries.filter((e) => e.decision === "block").length;
  const approvals = entries.filter((e) => e.decision === "approval_required").length;
  const recentBlocks = entries.filter((e) => e.decision !== "allow").slice(-5).reverse();
  const exampleOverride = resolveOverride({ serviceOverride: null, tagOverride: null, default: "review-each-time" });
  const vocabHelp: Record<string, string> = {
    read: "Reads, metadata",
    write: "Mutating writes",
    destructive: "Deletes, drops, revocations",
    sensitive: "Secrets, tokens, credentials",
  };
  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        eyebrow="Monitor"
        title="Guard rules"
        description="Reads go through fast; writes and destructive actions are denied, and are refused in production. Per-binding rules are hidden in this build — values below are read-only."
        action={<button type="button" onClick={() => void refresh()} disabled={busy} className={secondaryBtn}>{busy ? "Refreshing…" : "Refresh"}</button>}
      />
      <div className="grid shrink-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Allowed" value={loaded ? String(allowed) : "…"} detail="Low-risk reads via Nexus" />
        <Metric label="Blocked" value={loaded ? String(blocked) : "…"} detail="Writes · mismatches" />
        <Metric label="Denied" value={loaded ? String(approvals) : "…"} detail="Denied — expired or revoked auth" />
        <Metric label="Sessions seen" value={loaded ? String(new Set(entries.map((e) => e.session ?? "?")).size) : "…"} detail="Server-held sessions" />
      </div>
      <div className="app-columns flex min-h-0 flex-1 flex-col gap-6 overflow-visible lg:grid lg:grid-cols-2">
      <div className="app-column flex min-h-0 flex-col gap-6 overflow-visible lg:h-full">
      <details className="nx-card shrink-0 !py-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-(--text)">How Guard classifies calls (reference)</summary>
        <div className="max-h-[30vh] overflow-y-auto pt-2">
        <ul className="divide-y divide-(--line-soft)">
          {VOCAB.map((term) => (
            <li key={term} className="flex items-center gap-4 py-3">
              <span className="w-28 shrink-0 rounded-full px-2.5 py-1 text-center text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(term === "read" ? "green" : term === "write" ? "pending" : "red")}>
                {term}
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                {vocabHelp[term]}
                <small className="block text-[12px] font-normal tabular-nums text-(--muted)">
                  dev: {CENTRAL_TABLE[`${term}:development`]} · test: {CENTRAL_TABLE[`${term}:test`]} · staging: {CENTRAL_TABLE[`${term}:staging`]} · prod: {CENTRAL_TABLE[`${term}:production`]}
                </small>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-[1.6] text-(--muted)">Unmapped terms fail closed to denied — never silently allowed.</p>
        </div>
      </details>
      <Card className="flex max-h-[620px] min-h-[360px] flex-col overflow-hidden">
        <CardHeading eyebrow="Per-binding rules" title="Service rules — most specific wins" />
        <p className="mb-2 shrink-0 text-[12px] leading-[1.6] text-(--muted)">Hidden in this build — rule selects are disabled and write nothing. Values below are what is stored.</p>
        <ul className="min-h-0 flex-1 divide-y divide-(--line-soft) overflow-y-auto">
          {projects.flatMap((item) => (item.connections ?? []).map((connection) => ({ item, connection }))).map(({ item, connection }) => {
            const current = connection.serviceOverride ?? connection.override ?? "";
            const effective = resolveOverride({ serviceOverride: current || null, tagOverride: connection.tagOverride ?? null, default: "review-each-time" });
            return (
              <li key={connection.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                  {item.name} · {connection.provider} → {connection.resource ?? connection.target}
                  <small className="block text-[12px] font-normal tabular-nums text-(--muted)">
                    now: {effective.override === "auto-approve" ? "allowed without asking (still logged)" : effective.override === "always-block" ? "refused — stays connected" : "asks each time"}
                  </small>
                </span>
                <select
                  value={current}
                  onChange={(e) => onSetOverride(item.id, connection.id, e.target.value || null)}
                  disabled
                  title="Guard rules are hidden in this build"
                  aria-label={`Rule for ${item.name} ${connection.provider} (read-only)`}
                  className={selectClass}
                  style={{ maxWidth: 220 }}
                >
                  <option value="">Ask each time (default)</option>
                  <option value="auto-approve">Allow without asking</option>
                  <option value="review-each-time">Ask each time</option>
                  <option value="always-block">Always refuse</option>
                </select>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 shrink-0 text-[12px] leading-[1.6] text-(--muted)">
          Refusing never disconnects the binding — it just says no to that one call. Allowing without asking still writes every call to the audit log. Source: service rule beats tag and default rules.
        </p>
      </Card>
      </div>
      <div className="app-column flex min-h-0 flex-col gap-6 overflow-visible lg:h-full">
      <details className="nx-card shrink-0 !py-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-(--text)">How overrides resolve (reference)</summary>
        <div className="max-h-[30vh] overflow-y-auto pt-2">
        <ol className="divide-y divide-(--line-soft)">
          {(["service", "tag", "default"] as const).map((level, i) => (
            <li key={level} className="flex items-center gap-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--raised) text-[11px] font-semibold tabular-nums text-(--muted)">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[13px] font-medium capitalize text-(--text)">
                {level}
                <small className="block text-[12px] font-normal normal-case tabular-nums text-(--muted)">
                  {level === "service" ? "Highest precedence — one service only" : level === "tag" ? "Middle — a group of services" : `Fallback — currently ${exampleOverride.override} → ${exampleOverride.decision}`}
                </small>
              </span>
              {level === "default" && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle("default")}>
                  {exampleOverride.override}
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] leading-[1.6] text-(--muted)">
          A block decision never tears down the connection. Auto-approve is still audited. Source: {exampleOverride.source}.
        </p>
        </div>
      </details>
      <Card className="flex min-h-[220px] shrink-0 flex-col overflow-hidden">
        <CardHeading
          eyebrow="Recent enforcement"
          title={!desktop ? "Open the desktop app to read the local activity log" : !loaded ? "Loading" : recentBlocks.length === 0 ? "No blocks recorded" : `${recentBlocks.length} recent block${recentBlocks.length === 1 ? "" : "s"}`}
        />
        {recentBlocks.length > 0 && (
          <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto">{recentBlocks.map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} />)}</div>
        )}
        {!desktop && <p className="text-[13px] leading-[1.6] text-(--muted)">The browser preview cannot read workspace files. Enforcement itself happens in the MCP bridge regardless.</p>}
        {desktop && loaded && recentBlocks.length === 0 && (
          <p className="text-[13px] leading-[1.6] text-(--muted)">Nothing blocked. Every mediated call so far was allowed or denied.</p>
        )}
      </Card>
      <Note><strong className="font-semibold text-(--text)">Unmanaged is not protected.</strong> Direct provider CLIs, direct MCP connections, or browser actions outside Nexus are not visible here.</Note>
      </div>
      </div>
    </div>
  );
}

function ActivityView({ projects, errorLog, onClearErrors, onRetryError }: { projects: Project[]; errorLog: ErrorRecord[]; onClearErrors: () => void; onRetryError: (record: ErrorRecord) => void }) {
  const { entries, loaded, busy, refresh } = useAuditLog(projects);
  const [filter, setFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"all" | "allowed" | "blocked">("all");
  const desktop = desktopAvailable();
  const query = filter.trim().toLowerCase();
  const matching = (entry: AuditEntry) => {
    if (decisionFilter === "allowed" && entry.decision !== "allow") return false;
    if (decisionFilter === "blocked" && entry.decision === "allow") return false;
    return !query || [entry.agent, entry.project, entry.environment, entry.provider, entry.resource, entry.operation, entry.decision, entry.reason, entry.session].some((field) => (field ?? "").toLowerCase().includes(query));
  };
  const recent = entries.filter(matching).slice(-50).reverse();
  const errors = [...errorLog].reverse();
  const allowedCount = entries.filter((e) => e.decision === "allow").length;
  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        description="A record of what Nexus handled: session, project, resource, operation and decision. No secrets."
        action={<Button size="sm" variant="outline" isDisabled={busy} onPress={() => void refresh()}><NxIcon name="refresh" size={15} />{busy ? "Refreshing…" : "Refresh"}</Button>}
      />
      {desktop && entries.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented label="Decision filter" value={decisionFilter} onChange={setDecisionFilter} options={[{ value: "all", label: `All ${entries.length}` }, { value: "allowed", label: `Allowed ${allowedCount}` }, { value: "blocked", label: `Blocked ${entries.length - allowedCount}` }]} />
          <label className="flex min-w-[240px] items-center gap-2 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-2 text-(--muted)">
            <NxIcon name="search" size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter activity" placeholder="Project, operation, reason…" className="min-w-0 flex-1 bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted-2)" />
          </label>
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card flush className="flex min-h-[280px] flex-col lg:max-h-[640px]">
          <div className="px-5 pt-4"><CardHeading eyebrow="Activity log" title={!desktop ? "Desktop only" : !loaded ? "Loading" : recent.length === 0 ? "No recorded activity" : `${recent.length} recent decision${recent.length === 1 ? "" : "s"}`} /></div>
          {!loaded && desktop ? (
            <ul className="flex flex-col gap-2 px-5 pb-5" aria-label="Loading activity">
              {[0, 1, 2, 3].map((i) => <li key={i} className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />)}
            </ul>
          ) : recent.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{recent.map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} inset />)}</div>
          ) : (
            <Empty title={query || decisionFilter !== "all" ? "No decisions match that filter" : "No activity recorded"}>
              {!desktop ? "Open the desktop app to read the local activity log. Nexus does not track commands run outside the app." : query || decisionFilter !== "all" ? "Clear the filter to see everything." : "No agent has used Nexus yet. Connect one from Agents and its calls will show up here."}
            </Empty>
          )}
        </Card>
        <Card flush className="flex min-h-[200px] flex-col lg:max-h-[640px]">
          <div className="px-5 pt-4">
            <CardHeading
              eyebrow="App errors"
              title={errors.length === 0 ? "No errors kept" : `${errors.length} kept`}
              action={errors.length > 0 ? <Button size="sm" variant="ghost" onPress={onClearErrors}>Clear</Button> : undefined}
            />
          </div>
          {errors.length > 0 ? (
            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {errors.map((record) => (
                <li key={record.id} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <span className="nx-tile" data-tone="danger"><NxIcon name="alert" size={16} /></span>
                  <span className="nx-row-body">
                    <span className="nx-row-title">{record.where}</span>
                    <span className="nx-row-sub" style={{ whiteSpace: "normal" }}>{record.message}</span>
                    {record.debug && <span className="nx-row-sub nx-mono" title="Error class for debugging (no secrets)">{record.debug}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="nx-mono nx-muted" title={new Date(record.ts).toLocaleString()}>{timeAgo(record.ts)}</span>
                    {record.retry && <Button size="sm" variant="outline" onPress={() => onRetryError(record)}>Retry</Button>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-5 text-[13px] leading-[1.6] text-(--muted)">Failures to save, link, or remove stay here with what to retry. Nothing has failed yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function AuditRow({ entry, inset = false }: { entry: AuditEntry; inset?: boolean }) {
  const when = timeAgo(entry.ts);
  const full = entry.ts ? new Date(entry.ts).toLocaleString() : "Unknown time";
  // Paper: approval_required reads as denied (Blocked/denied wording).
  const decision = entry.decision === "approval_required" ? "denied" : (entry.decision ?? "unknown");
  const state: StepState = decision === "allow" ? "done" : decision === "block" ? "failed" : "skipped";
  const tone: Tone = decision === "allow" ? "success" : decision === "block" ? "danger" : "warning";
  return (
    <div className="nx-row" style={inset ? undefined : { paddingInline: 0 }}>
      <span className="nx-check" data-state={state} aria-label={decision}>
        {state === "done" && <NxIcon name="check" size={13} />}
        {state === "failed" && <NxIcon name="x" size={13} />}
      </span>
      <span className="nx-row-body">
        <span className="nx-row-title">{entry.operation ?? "unknown operation"}</span>
        <span className="nx-row-sub">{entry.agent ? `${agentDisplayName(entry.agent)} · ` : ""}{projectDisplayName(entry.project)} · {entry.environment ?? "?"} · {entry.resource ?? entry.provider ?? "?"}</span>
        {entry.reason && <span className="nx-row-sub" style={{ whiteSpace: "normal" }}>{entry.reason}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={tone}>{decision}</Badge>
        <span className="nx-mono nx-muted" title={full}>{when}</span>
      </span>
    </div>
  );
}

function SettingsView({ projects, savedKeys, vaultUnlocked, onUnlocked, onLocked, onReset }: { projects: Project[]; savedKeys: Record<string, boolean>; vaultUnlocked: boolean; onUnlocked: () => void; onLocked: () => void; onReset: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await unlockVault(password);
      setPassword("");
      onUnlocked();
    } catch (error) {
      setMessage("Could not unlock the vault. Check the password and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    setBusy(true);
    setMessage("");
    try {
      await lockVault();
      onLocked();
    } catch (error) {
      setMessage("Could not lock the vault. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const desktop = desktopAvailable();

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle description="Appearance, the desktop vault, and local data." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeading eyebrow="Appearance" title="Theme" />
          <p className="mb-3 text-[13px] leading-[1.6] text-(--muted)">System follows your operating system. Your choice is remembered on this device.</p>
          <ThemeToggle />
        </Card>
        <Card>
          <CardHeading eyebrow="Desktop vault" title={!desktop ? "Open Nexus Guard on your desktop" : vaultUnlocked ? "Vault unlocked" : "Unlock or create your vault"} action={desktop ? <Badge tone={vaultUnlocked ? "success" : "warning"} dot>{vaultUnlocked ? "Unlocked" : "Locked"}</Badge> : undefined} />
          <p className="max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
            {!desktop ? "This browser preview never accepts or stores keys. Use the desktop app to manage them." : vaultUnlocked ? "Your secure system keychain is ready. Keys are kept out of project files." : "Enter a password with at least 12 characters to unlock your vault, or to create it the first time."}
          </p>
          {desktop && !vaultUnlocked && (
            <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">Vault password</span>
                <input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required placeholder="At least 12 characters" className={inputClass} />
              </label>
              {message && <p className="text-[12px] text-(--red)" role="alert">{message}</p>}
              <Button type="submit" size="sm" isDisabled={busy || password.length < 12} className="self-start">{busy ? "Opening vault…" : "Open vault"}</Button>
            </form>
          )}
          {desktop && vaultUnlocked && (
            <div className="mt-4"><Button size="sm" variant="outline" isDisabled={busy} onPress={() => void lock()}>{busy ? "Locking…" : "Lock vault"}</Button></div>
          )}
          {message && vaultUnlocked && <p className="mt-2 text-[12px] text-(--red)" role="alert">{message}</p>}
          {desktop && vaultUnlocked && <VaultItems projects={projects} savedKeys={savedKeys} />}
        </Card>
      </div>
      <Card className="shrink-0">
        <CardHeading eyebrow="Danger zone" title="Reset local data" />
        <p className="max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
          Projects, setup progress, and the kept error log return to starter examples. Folders on disk and OS-keychain approvals are untouched.
        </p>
        <Button size="sm" variant="danger-soft" className="mt-4" onPress={onReset}>Reset local data</Button>
      </Card>
    </div>
  );
}

function VaultItems({ projects, savedKeys }: { projects: Project[]; savedKeys: Record<string, boolean> }) {
  const items = projects.flatMap((item) => item.connections.flatMap((connection) => {
    const publishable = connection.provider === "Supabase" && (connection.keySaved || savedKeys[connection.id]);
    const mcp = connection.authState === "connected";
    if (!publishable && !mcp) return [];
    return [{ project: item.name, service: connection.provider, target: connection.target, kind: publishable ? "Publishable key" : "MCP approval" }];
  }));
  return (
    <div className="mt-5 border-t border-(--line-soft) pt-4">
      <span className="nx-eyebrow">Stored items</span>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-(--muted)">No keys or approvals are saved yet.</p>
      ) : (
        <ul className="mt-2 flex max-h-[280px] flex-col overflow-y-auto">
          {items.map((item) => (
            <li key={`${item.project}-${item.service}-${item.kind}`} className="nx-row" style={{ paddingInline: 0 }}>
              <span className="nx-tile" data-tone="success"><NxIcon name="key" size={16} /></span>
              <span className="nx-row-body">
                <span className="nx-row-title">{item.service} · {item.project}</span>
                <span className="nx-row-sub">{item.kind} · {item.target}</span>
              </span>
              <Badge tone="success" dot>Saved</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type FolderInspection = { exists: boolean; is_dir: boolean; git_remote?: string | null; git_branch?: string | null; nexus_project?: string | null; nexus_project_id?: string | null; nexus_environment?: string | null; nexus_connections?: { provider: string; account?: string | null; resource?: string | null; target?: string | null }[] };

function AddProjectModal({ onClose, onSave, existingNames }: { onClose: () => void; onSave: (input: { name: string; path: string; repo: string; branch: string; environment?: string }) => void; existingNames: string[] }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [environment, setEnvironment] = useState("");
  const [repoAuto, setRepoAuto] = useState(true);
  const [branchAuto, setBranchAuto] = useState(true);
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [inspectNonce, setInspectNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const desktop = desktopAvailable();
  const [busyPick, setBusyPick] = useState(false);
  const [error, setError] = useState("");
  const nameUsed = existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase());

  function pickPath(value: string) {
    setPath(value);
    if (!name.trim()) {
      const base = value.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
      const cleaned = base.replace(/^~/, "").trim();
      if (cleaned) setName(cleaned);
    }
  }

  async function browseFolder() {
    setBusyPick(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose project folder" });
      if (typeof selected === "string" && selected) pickPath(selected);
    } catch {
      setError("Could not open the folder picker. Type the folder path instead.");
    } finally {
      setBusyPick(false);
    }
  }

  useEffect(() => {
    if (!desktop || !path.trim()) { setInspection(null); return; }
    setChecking(true);
    const timer = window.setTimeout(() => {
      invoke<FolderInspection>("inspect_project_folder", { workspacePath: path.trim() })
        .then((result) => {
          setInspection(result);
          if (result.git_remote && repoAuto) setRepo(result.git_remote);
          if (result.git_branch && branchAuto) setBranch(result.git_branch);
          if (!name.trim() && result.nexus_project) setName(result.nexus_project);
        })
        .catch(() => setInspection(null))
        .finally(() => setChecking(false));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [path, inspectNonce, desktop, repoAuto, branchAuto, name]);

  const folderMissing = !!inspection && (!inspection.exists || !inspection.is_dir);
  const alreadyRegistered = !!inspection?.nexus_project;
  // Paper: gate saves on inspection completion when desktop — the folder
  // check must finish (not just start) before Nexus accepts the project.
  const inspected = !desktop || !path.trim() || (inspection !== null && !checking);
  const canSave = name.trim().length > 0 && path.trim().length > 0 && !nameUsed && !alreadyRegistered && !folderMissing && inspected;

  async function createFolder() {
    setCreating(true); setError("");
    try {
      if (!desktopAvailable()) throw new Error("Open the desktop app to create folders.");
      await invoke<string>("create_project_folder", { workspacePath: path.trim() });
      setInspectNonce((n) => n + 1);
    } catch (caught) {
      setError("Could not create that folder. Check the path and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title="Add a project" description="Tell Nexus where this project lives. Repo and branch fill in from the folder by themselves." onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ name: name.trim(), path: path.trim(), repo: repo.trim(), branch: branch.trim() || "main", environment: environment || undefined }); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Project name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Koupa" autoFocus className={inputClass} required />
          {nameUsed ? <span className="text-[12px] text-(--red)" role="alert">A project with this name already exists. Choose another name.</span> : null}
        </label>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Project folder</span>
            <input value={path} onChange={(e) => pickPath(e.target.value)} placeholder="~/Projects/Koupa" className={inputClass} required />
          </label>
          {desktop && <button type="button" onClick={() => void browseFolder()} disabled={busyPick} className={secondaryBtn}>{busyPick ? "…" : "Browse"}</button>}
        </div>
        {desktop && path.trim() && (
          <p className="flex flex-wrap items-center gap-2 text-[12px] tabular-nums text-(--muted)">
            <StatusDot tone={checking ? "blue" : inspection ? (inspection.exists && inspection.is_dir ? "green" : "orange") : "orange"} />
            {checking ? "Checking folder…" : inspection ? (inspection.exists && inspection.is_dir
              ? `Folder found${inspection.git_branch ? ` · git: ${inspection.git_branch}` : " · no git — manifest only"}${inspection.nexus_project ? ` · already registered as ${inspection.nexus_project}` : ""}`
              : "That folder does not exist yet.") : ""}
            {desktop && path.trim() && folderMissing && !checking && (
              <button type="button" onClick={() => void createFolder()} disabled={creating} className={ghostLink}>{creating ? "Creating…" : "Create it"}</button>
            )}
          </p>
        )}
        {!desktop && <Note>Open the desktop app and Nexus checks the folder for you.</Note>}
        {inspection?.nexus_project && <p className="text-[12px] text-(--red)" role="alert">This folder already belongs to “{inspection.nexus_project}”. Pick another folder or remove it there first.</p>}
        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
        <details className="rounded-[8px] border border-(--line) px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-(--muted)">Repo, branch, environment (auto-detected)</summary>
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Git repository</span>
              <input value={repo} onChange={(e) => { setRepo(e.target.value); setRepoAuto(false); }} placeholder="Detected from folder" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Branch</span>
              <input value={branch} onChange={(e) => { setBranch(e.target.value); setBranchAuto(false); }} placeholder="main" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Environment</span>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className={selectClass}>
                <option value="">Auto from branch</option>
                <option value="development">Development</option>
                <option value="staging">Staging</option>
                <option value="production">Production</option>
              </select>
            </label>
          </div>
        </details>
        <Note>Only project information is saved. No passwords are requested here.</Note>
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Save project</button>
        </div>
      </form>
    </Modal>
  );
}

function EditProjectModal({ project, onClose, onSave, existingNames }: { project: Project; onClose: () => void; onSave: (patch: { name: string; path: string; repo: string; branch: string; environment: string }) => void; existingNames: string[] }) {
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path);
  const [repo, setRepo] = useState(project.repo === "Not connected" ? "" : project.repo);
  const [branch, setBranch] = useState(project.branch);
  const [environment, setEnvironment] = useState(project.environment);
  const nameUsed = existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase());
  const canSave = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;

  async function browse() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose project folder" });
      if (typeof selected === "string" && selected) setPath(selected);
    } catch { /* keep typed path */ }
  }

  const environments = ["development", "staging", "production"];

  return (
    <Modal title={`Edit ${project.name}`} description="Rename, move, or retarget this project. Agents resolve the new details after you re-verify the folder." onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ name: name.trim(), path: path.trim(), repo: repo.trim(), branch: branch.trim() || "main", environment }); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Project name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} required />
          {nameUsed ? <span className="text-[12px] text-(--red)" role="alert">Another project already uses this name. Choose another name.</span> : null}
        </label>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Project folder</span>
            <input value={path} onChange={(e) => setPath(e.target.value)} className={inputClass} required />
          </label>
          {desktopAvailable() && <button type="button" onClick={() => void browse()} className={secondaryBtn}>Browse</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Git repository</span>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/you/repo" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Branch</span>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Environment</span>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className={selectClass}>
            {environments.map((env) => <option key={env} value={env}>{env[0].toUpperCase() + env.slice(1)}</option>)}
          </select>
        </label>
        <Note>Only project information is saved. Saved approvals stay linked by their IDs.</Note>
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}

function EditConnectionModal({ connection, accounts, onClose, onSave, onOpenServices }: { connection: Connection; accounts: Account[]; onClose: () => void; onSave: (patch: { target: string; detail: string; tone: Connection["tone"]; projectRef?: string; url?: string; accountId?: string }) => void; onOpenServices?: () => void }) {
  const locked = connection.method === "mcp";
  const [target, setTarget] = useState(connection.target);
  const [detail, setDetail] = useState(connection.detail);
  const [tone, setTone] = useState<Connection["tone"]>(connection.tone);
  const [projectRef, setProjectRef] = useState(connection.projectRef ?? "");
  const [url, setUrl] = useState(connection.url ?? "");
  const [accountId, setAccountId] = useState(connection.accountId ?? connection.account ?? "");
  const [accountTouched, setAccountTouched] = useState(false);
  const matchingAccounts = accounts.filter((a) => a.provider.toLowerCase() === connection.provider.toLowerCase());
  // Display the canonical id; a legacy bare label stays as-is until the developer picks.
  const resolvedAccountId = matchingAccounts.some((a) => a.id === accountId)
    ? accountId
    : (matchingAccounts.find((a) => a.label === accountId)?.id ?? "");
  // Only an explicit pick changes the binding: untouched legacy values are
  // preserved, while picking "Not linked" clears to undefined via updateConnection.
  const accountForSave = accountTouched ? resolvedAccountId : accountId;
  const canSave = target.trim().length > 0 && (!connection.provider.startsWith("Supabase") || locked || (projectRef.trim().length > 0 && url.trim().length > 0));
  const tones = ["green", "violet", "blue", "orange"] as const;

  return (
    <Modal title={`Edit ${connection.provider} connection`} description={locked ? "Label, login, and color — the approved ref and URL stay exactly as Supabase issued them. To change projects, remove and reconnect." : "Update how Nexus labels and reaches this resource."} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ target: target.trim(), detail: detail.trim() || connection.detail, tone, projectRef: projectRef.trim() || undefined, url: url.trim() || undefined, accountId: accountForSave }); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Display name</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} autoFocus className={inputClass} required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Account (from Services)</span>
          {matchingAccounts.length === 0 && (
            <small className="flex flex-wrap items-center gap-2 text-[12px] leading-[1.6] text-(--muted)">
              <span>No {connection.provider} account linked yet — link one under Services first, then pick it here. Saving “Not linked” clears the account.</span>
              {onOpenServices && <button type="button" onClick={onOpenServices} className={smallBtn}>Open Services</button>}
            </small>
          )}
          <select value={resolvedAccountId} onChange={(e) => { setAccountId(e.target.value); setAccountTouched(true); }} className={selectClass}>
            <option value="">Not linked</option>
            {matchingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
          </select>
        </label>
        {locked && <Note>Approved ref <strong>{connection.projectRef}</strong> · {connection.url} — read-only while the approval lives.</Note>}
        {!locked && connection.provider === "Supabase" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Project reference</span>
              <input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Project URL</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} />
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">What it provides</span>
            <input value={detail} onChange={(e) => setDetail(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Color</span>
            <select value={tone} onChange={(e) => setTone(e.target.value as Connection["tone"])} className={selectClass}>
              {tones.map((toneOption) => <option key={toneOption} value={toneOption}>{toneOption[0].toUpperCase() + toneOption.slice(1)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}

function AddConnectionModal({ initialProvider, initialAccountId, projectId, projectName, accounts, onClose, onSave, onAuthorizeMcp, onConfirmMcp, onCancelMcp, onAbortMcp, onOpenServices }: { projectId: string; initialProvider?: string; initialAccountId?: string; projectName: string; accounts: Account[]; onClose: () => void; onSave: (input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string; accountId?: string }) => void; onAuthorizeMcp: (detail: string, accountId?: string) => Promise<{ connectionId: string; projects: { ref: string; name: string; region?: string | null }[]; listError?: string }>; onConfirmMcp: (projectId: string, connectionId: string, choice: { ref: string; name: string; region?: string | null }) => void; onCancelMcp: (projectId: string, connectionId: string) => void; onAbortMcp: () => void; onOpenServices?: () => void }) {
  const [provider, setProvider] = useState(initialProvider ?? "Supabase");
  const [method, setMethod] = useState<"choose" | "manual" | "mcp">("choose");
  const [target, setTarget] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [url, setUrl] = useState("");
  const [detail, setDetail] = useState("Database and services");
  const [tone, setTone] = useState<Connection["tone"]>("green");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mcpPhase, setMcpPhase] = useState<"auth" | "pick">("auth");
  const [mcpConnectionId, setMcpConnectionId] = useState("");
  const [mcpProjects, setMcpProjects] = useState<{ ref: string; name: string; region?: string | null }[]>([]);
  const [mcpListError, setMcpListError] = useState("");
  const [pickedRef, setPickedRef] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  // Unmount/close guards: never setState on a closed modal, and never leave
  // the browser-approval poll running without a modal to report back to.
  const cancelledRef = useRef(false);
  const authInFlight = useRef(false);
  const abortRef = useRef(onAbortMcp);
  abortRef.current = onAbortMcp;
  useEffect(() => () => {
    cancelledRef.current = true;
    if (authInFlight.current) abortRef.current();
  }, []);
  const matchingAccounts = accounts.filter((a) => a.provider.toLowerCase() === provider.toLowerCase());
  const [accountId, setAccountId] = useState(() => (initialAccountId && matchingAccounts.some((a) => a.id === initialAccountId) ? initialAccountId : matchingAccounts[0]?.id ?? ""));
  // Re-sync when the registry changes under an open modal: a selected id
  // that no longer exists falls back instead of submitting a stale id. A
  // blank (unlinked) choice is always kept as-is.
  useEffect(() => {
    if (accountId && !matchingAccounts.some((a) => a.id === accountId)) {
      setAccountId(matchingAccounts[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, provider]);
  const isSupabase = provider === "Supabase";
  // Paper: an "Other" (self-added) service needs an explicit 2-step confirm —
  // fail-closed restated, explicit confirm click before manual save.
  const providerTier = provider.trim() ? tierForProvider(provider) : "self-added";
  const [selfAddedConfirm, setSelfAddedConfirm] = useState(false);
  useEffect(() => { setSelfAddedConfirm(false); }, [provider]);
  // An account is optional: saving without one stores the binding unlinked,
  // and the confirm step warns so it can be linked later under Bindings.
  const canSaveManual = provider.trim().length > 0 && target.trim().length > 0 && (!isSupabase || (projectRef.trim().length > 0 && url.trim().length > 0)) && (providerTier !== "self-added" || selfAddedConfirm);

  function changeProvider(nextProvider: string) {
    setProvider(nextProvider);
    const first = accounts.find((a) => a.provider.toLowerCase() === nextProvider.toLowerCase());
    setAccountId(first?.id ?? "");
    if (nextProvider !== "Supabase") {
      setDetail(nextProvider === "Clerk" ? "Authentication" : "Resource");
      setTone(nextProvider === "Clerk" ? "violet" : "blue");
    } else {
      setDetail("Database and services");
      setTone("green");
    }
  }

  function saveManual() {
    onSave({ provider: provider.trim(), target: target.trim(), detail: detail.trim(), tone, method: "manual", authState: "not_connected", projectRef: projectRef.trim() || undefined, url: url.trim() || undefined, accountId: accountId || undefined });
  }

  async function authorize() {
    setBusy(true); setError(""); setMcpListError("");
    authInFlight.current = true;
    try {
      const { connectionId, projects, listError } = await onAuthorizeMcp(detail, accountId || undefined);
      if (cancelledRef.current) return;
      setMcpConnectionId(connectionId);
      setMcpProjects(projects);
      setMcpListError(listError ?? "");
      setPickedRef(projects.length === 1 ? projects[0].ref : "");
      setManualEntry(projects.length === 0);
      setMcpPhase("pick");
    } catch (caught) {
      if (cancelledRef.current) return;
      // Abort-driven cancel already cleaned up the pending connection; don't
      // surface it as a failure.
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError("Could not start the connection. Check your network connection and try again.");
    }
    finally {
      authInFlight.current = false;
      if (!cancelledRef.current) setBusy(false);
    }
  }

  function cancelAuthorize() {
    if (mcpConnectionId) onCancelMcp(projectId, mcpConnectionId);
    onClose();
  }

  // Closing mid-approval must run the cancel path: abort the poll (App
  // removes the pending connection) instead of stranding it as "pending".
  function closeWhileAuthorizing() {
    onAbortMcp();
    onClose();
  }

  function confirmPick() {
    const choice = mcpProjects.find((p) => p.ref === pickedRef);
    if (!choice) { setError("Choose one of your Supabase projects."); return; }
    onConfirmMcp(projectId, mcpConnectionId, choice);
  }

  const services = Array.from(new Set([...PROVIDER_CATALOG.map((p) => p.provider), ...accounts.map((a) => a.provider), "Other"]));
  const tones = ["green", "violet", "blue", "orange"] as const;

  return (
    <Modal title={`Add a connection to ${projectName}`} description="Choose how Nexus should connect to this service." onClose={method === "mcp" ? (mcpPhase === "pick" ? cancelAuthorize : (busy ? closeWhileAuthorizing : onClose)) : onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Service</span>
          <select value={provider} onChange={(e) => changeProvider(e.target.value)} disabled={method === "mcp" && mcpPhase === "pick"} className={selectClass}>
            {services.map((service) => <option key={service} value={service}>{service}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Account (from Services)</span>
          {matchingAccounts.length === 0 ? (
            <small className="flex flex-wrap items-center gap-2 text-[12px] leading-[1.6] text-(--muted)">
              <span>No {provider} account linked yet — link one under Services first, then pick it here. Saving now stores the binding without an account.</span>
              {onOpenServices && <button type="button" onClick={onOpenServices} className={smallBtn}>Open Services</button>}
            </small>
          ) : (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={method === "mcp" && mcpPhase === "pick"} className={selectClass}>
              <option value="">Select an account…</option>
              {matchingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
            </select>
          )}
        </label>
        {method === "choose" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMethod("manual")}
              className="flex min-h-[150px] cursor-pointer flex-col items-start gap-2 rounded-[10px] border border-(--line) bg-(--panel) p-4 text-left transition-[transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
            >
              <strong className="text-[13px] font-semibold">Add manually</strong>
              <small className="text-[12px] leading-[1.6] text-(--muted)">Enter the project details and save a key in the desktop vault.</small>
              <span className="mt-auto pt-2 text-[12px] font-semibold">Choose manual →</span>
            </button>
            {provider === "Supabase" ? (
              <button
                type="button"
                onClick={() => setMethod("mcp")}
                className="flex min-h-[150px] cursor-pointer flex-col items-start gap-2 rounded-[10px] border border-(--line) bg-(--panel) p-4 text-left transition-[transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
              >
                <strong className="text-[13px] font-semibold">Connect with MCP</strong>
                <small className="text-[12px] leading-[1.6] text-(--muted)">Sign in in your browser, pick your project, done. No typing refs or URLs.</small>
                <span className="mt-auto pt-2 text-[12px] font-semibold">Choose MCP →</span>
              </button>
            ) : (
              <div className="flex min-h-[150px] flex-col items-start gap-2 rounded-[10px] border border-(--line) bg-(--canvas) p-4 opacity-70">
                <strong className="text-[13px] font-semibold">Connect with MCP</strong>
                <small className="text-[12px] leading-[1.6] text-(--muted)">Browser approval is Supabase-only for now. {provider} saves as manual details.</small>
              </div>
            )}
          </div>
        )}
        {method === "manual" && (
          <>
            <button type="button" onClick={() => setMethod("choose")} className={ghostLink} style={{ alignSelf: "flex-start" }}>← Choose another method</button>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">{isSupabase ? "Display name" : "Project or account name"}</span>
              <input value={target} onChange={(e) => setTarget(e.target.value)} autoFocus placeholder={isSupabase ? "koupa-development" : "For example, koupa-auth"} className={inputClass} required />
            </label>
            {isSupabase && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Project reference</span>
                  <input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="abcdefghijklmnop" className={inputClass} required />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Project URL</span>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://...supabase.co" className={inputClass} required />
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">What it provides</span>
                <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Database · Auth" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">Color</span>
                <select value={tone} onChange={(e) => setTone(e.target.value as Connection["tone"])} className={selectClass}>
                  {tones.map((toneOption) => <option key={toneOption} value={toneOption}>{toneOption[0].toUpperCase() + toneOption.slice(1)}</option>)}
                </select>
              </label>
            </div>
            <Note>Only project details are saved now. Secret keys are never saved in the browser.</Note>
            {providerTier === "self-added" && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-(--line) bg-(--canvas) p-3 text-[12px] leading-[1.6] text-(--muted)">
                <input type="checkbox" checked={selfAddedConfirm} onChange={(e) => setSelfAddedConfirm(e.target.checked)} className="mt-1 accent-(--text)" />
                <span>“{provider}” is unreviewed and fail-closed — agents get nothing from this binding until I explicitly allow calls.</span>
              </label>
            )}
            {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button>
              <button type="button" onClick={saveManual} disabled={!canSaveManual || busy} className={primaryBtn}>Save project details</button>
            </div>
          </>
        )}
        {method === "mcp" && mcpPhase === "auth" && (
          <>
            <button type="button" onClick={() => setMethod("choose")} className={ghostLink} style={{ alignSelf: "flex-start" }}>← Choose another method</button>
            <div className="rounded-[8px] border border-(--line) bg-(--canvas) p-4 text-[12px] leading-[1.6] text-(--muted)">
              <p className="mb-1 text-[13px] font-semibold text-(--text)">Browser approval</p>
              <p>Click below. Nexus opens Supabase in your browser — sign in, approve, then pick which of <em>your</em> projects links to {projectName}. Ref and URL fill in by themselves.</p>
              <ol className="mt-2 list-decimal pl-5 tabular-nums">
                <li>Sign in to Supabase</li>
                <li>Approve Nexus access</li>
                <li>Pick your project here</li>
              </ol>
            </div>
            {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={busy ? closeWhileAuthorizing : onClose} className={secondaryBtn}>Cancel</button>
              <button type="button" onClick={() => void authorize()} disabled={busy} className={primaryBtn}>{busy ? "Waiting for browser…" : "Connect in browser"}</button>
            </div>
          </>
        )}
        {method === "mcp" && mcpPhase === "pick" && (
          <>
            <div className="rounded-[8px] border border-(--line) bg-(--canvas) p-4 text-[12px] leading-[1.6] text-(--muted)">
              <p className="mb-1 text-[13px] font-semibold text-(--text)">Pick your Supabase project</p>
              <p>Approval saved. Which project belongs to {projectName}?</p>
            </div>
            {mcpListError && <p className="text-[12px] text-(--red)" role="alert">{mcpListError} Enter the details manually — your approval is still saved.</p>}
            {mcpProjects.length === 0 ? (
              <Note>No projects came back from Supabase. Enter the details manually instead.</Note>
            ) : (
              <fieldset>
                <legend className="sr-only">Supabase project</legend>
                <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
                  {mcpProjects.map((p) => (
                    <label key={p.ref} className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-(--line) px-3 py-2.5 transition-[transform,opacity] duration-200 hover:-translate-y-px" style={pickedRef === p.ref ? { borderColor: "var(--text)" } : undefined}>
                      <input type="radio" name="supabase-project" value={p.ref} checked={pickedRef === p.ref} onChange={(e) => setPickedRef(e.target.value)} className="accent-(--text)" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <strong className="text-[13px] font-semibold text-(--text)">{p.name}</strong>
                        <small className="text-[11px] tabular-nums text-(--muted)">{p.ref}{p.region ? ` · ${p.region}` : ""}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {(mcpProjects.length === 0 || manualEntry) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Project reference</span>
                  <input value={projectRef} onChange={(e) => { setProjectRef(e.target.value); setPickedRef(`manual:${e.target.value}`); }} placeholder="abcdefghijklmnop" className={inputClass} required />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Display name</span>
                  <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="koupa-development" className={inputClass} required />
                </label>
              </div>
            )}
            {mcpProjects.length > 0 && !manualEntry && <button type="button" onClick={() => setManualEntry(true)} className={ghostLink} style={{ alignSelf: "flex-start" }}>Can&apos;t find it? Enter details manually</button>}
            {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={cancelAuthorize} disabled={busy} className={secondaryBtn}>Cancel</button>
              <button
                type="button"
                onClick={() => {
                  if (manualEntry || pickedRef.startsWith("manual:")) {
                    const ref = projectRef.trim(); const displayName = target.trim() || ref;
                    if (!ref) { setError("Enter the project reference."); return; }
                    onConfirmMcp(projectId, mcpConnectionId, { ref, name: displayName });
                  } else confirmPick();
                }}
                disabled={busy || (!pickedRef && !(manualEntry && projectRef.trim() && target.trim()))}
                className={primaryBtn}
              >
                {busy ? "Linking…" : "Link this project"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PublishableKeyModal({ project, connection, saved, vaultUnlocked, onUnlocked, onClose, onChanged }: { project: Project; connection: Connection; saved: boolean; vaultUnlocked: boolean; onUnlocked: () => void; onClose: () => void; onChanged: (saved: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const desktop = desktopAvailable();

  async function unlockFirst(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await unlockVault(password);
      setPassword("");
      onUnlocked();
    } catch (error) { setMessage("Could not unlock the vault. Check the password and try again."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await savePublishableKey(project.id, connection.id, value);
      setValue(""); onChanged(true);
    } catch (error) { setMessage("Could not save that key. Check the key value and try again."); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMessage("");
    try { await removePublishableKey(project.id, connection.id); onChanged(false); }
    catch { setMessage("Could not remove this key. Unlock the vault and try again."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Publishable key for ${connection.target}`} description="Saved only in this desktop vault. Agents receive tools, never this key." onClose={onClose}>
      {!desktop && <Note>Open the desktop app to save keys. The browser preview never accepts them.</Note>}
      {desktop && !vaultUnlocked && (
        <form className="flex flex-col gap-4" onSubmit={unlockFirst}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Vault password — unlocks here, no detour</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" placeholder="At least 12 characters" minLength={12} className={inputClass} required />
            {message ? <span className="text-[12px] text-(--red)" role="alert">{message}</span> : null}
          </label>
          <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
            <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={busy || password.length < 12} className={primaryBtn}>{busy ? "Unlocking…" : "Unlock and continue"}</button>
          </div>
        </form>
      )}
      {desktop && vaultUnlocked && (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Supabase publishable key</span>
            <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoComplete="off" placeholder="sb_publishable_..." className={`${inputClass} font-mono`} />
            {message ? <span className="text-[12px] text-(--red)" role="alert">{message}</span> : null}
          </label>
          <Note>Do not enter a secret key, service-role key, database password, or personal access token.</Note>
          <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
            {saved && <button type="button" onClick={() => void remove()} disabled={busy} className={dangerBtn}>Remove saved key</button>}
            <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={busy || !value.trim().startsWith("sb_publishable_")} className={primaryBtn}>{busy ? "Saving…" : saved ? "Replace key" : "Save key"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--backdrop, rgb(0 0 0 / 0.5))" }} role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] border border-(--line) bg-(--panel) p-6"
        style={{ boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-(--text)">{title}</h2>
            <p className="mt-1 text-[13px] leading-[1.6] text-(--muted)">{description}</p>
          </div>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Close" onPress={onClose}><NxIcon name="x" size={16} /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default App;

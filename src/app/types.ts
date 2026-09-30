export type View = "home" | "overview" | "projects" | "agents" | "bindings" | "services" | "guard" | "activity" | "settings";

/** Backend AgentConfigEdit shape (connect/import/remove return this).
 *  Kept local: no shared types module owns it yet. */
export type AgentConfigEdit = { path: string; backup: string; diff: string };

/** Backend unmanaged-entry shape from detect_agents (found,unmanaged). */
export type UnmanagedMcpEntry = { source: string; name: string; kind: string };

export type DetectedAgent = { id: string; name: string; found: boolean; detail: string; nexus_config: string; http_reachable?: boolean; unmanaged?: UnmanagedMcpEntry[] };

export type AgentTestStep = { step: string; ok: boolean; detail: string };

export type AuditEntry = {
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

export type ErrorRetry = { kind: "remove" | "write-file" | "link"; projectId: string; connectionId: string };

export type ErrorRecord = { id: string; ts: string; where: string; message: string; debug?: string; retry?: ErrorRetry };

export type FolderInspection = { exists: boolean; is_dir: boolean; git_remote?: string | null; git_branch?: string | null; nexus_project?: string | null; nexus_project_id?: string | null; nexus_environment?: string | null; nexus_connections?: { provider: string; account?: string | null; resource?: string | null; target?: string | null }[] };

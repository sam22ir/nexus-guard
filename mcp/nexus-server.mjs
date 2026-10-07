import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListRootsResultSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { classify, decideGuard, resolveOverride } from "./guard-policy.mjs";
// DEFERRED-PAID (Guard OUT of MVP — hide, don't break routing):
// guard-policy (decideGuard/resolveOverride) + costBearing/escapeHatch axes are
// paid-tier only. MVP routing is read-allow/block via decideExecute below with
// GUARD_ENABLED=false. Enforcement in guard-policy.mjs is kept, never deleted.
import { curatedDecision, isReadTool, normalizeProvider, providerTier, serviceMcpUrl, remoteToolDecision, remoteToolKind, serviceScopeSpec, scopeArgOf, applyResourceScope } from "./providers.mjs";
import { readWriteGrant } from "./write-grants.mjs";
import { readBindingScope } from "./binding-scopes.mjs";

// Phase 1 (Guard hide, MVP): Guard extras (overrides, cost axis, escape hatch)
// are OFF unless GUARD_ENABLED=1/true. Routing enforcement (read-allow/block)
// stays on. Set GUARD_ENABLED=1 only for paid-tier dev.
export const GUARD_ENABLED =
  process.env.GUARD_ENABLED === "1" || String(process.env.GUARD_ENABLED ?? "").toLowerCase() === "true";
export function isGuardEnabled(env = process.env) {
  return env.GUARD_ENABLED === "1" || String(env.GUARD_ENABLED ?? "").toLowerCase() === "true";
}
// Phase 1: stdio is deprecated (paper: single persistent HTTP instance).
// Gate the stdio entrypoint behind NEXUS_ALLOW_STDIO=1 for one release.
export function stdioGateAllows(env = process.env) {
  return env.NEXUS_ALLOW_STDIO === "1";
}

const execFileAsync = promisify(execFile);
const SUPABASE_URL = "https://mcp.supabase.com/mcp";
// Notion §3 risk tiers: only low-risk reads are auto-allowed in MVP.
const DEFAULT_READ_TOOLS = new Set([
  "list_tables", "list_extensions", "list_migrations", "get_project_url",
  "generate_typescript_types", "get_logs", "get_advisors", "list_edge_functions",
  "get_edge_function", "search_docs",
]);
// Notion §6 canonical surface is DOTTED (paper): nexus.context /
// nexus.request_access / nexus.execute. Underscore forms are hidden compat
// aliases (callable, never listed) for one release so strict-client mappings
// keep working. Legacy nexus_get_project_context / nexus_check_target are
// deprecated callable aliases (never listed) for one release.
// Paper: single persistent HTTP instance; revocation surfaces as an execute
// decision ({revoked:true, decision:"block"}), never a tool-list push — so no
// dynamic supabase__*/github__* proxy listing. Proxy names stay callable as
// hidden compat (hide, don't break routing) and forward through nexus_execute.
export const CONTEXT_TOOL = "nexus.context";
export const CONTEXT_TOOL_UNDERSCORE = "nexus_context";
// Deprecated alias for one release (old internal name).
export const CONTEXT_TOOL_DOT = CONTEXT_TOOL;
export const REQUEST_TOOL = "nexus.request_access";
export const REQUEST_TOOL_UNDERSCORE = "nexus_request_access";
export const REQUEST_TOOL_DOT = REQUEST_TOOL;
export const EXECUTE_TOOL = "nexus.execute";
export const EXECUTE_TOOL_UNDERSCORE = "nexus_execute";
export const EXECUTE_TOOL_DOT = EXECUTE_TOOL;
export const PROJECT_TOOL_LEGACY = "nexus_get_project_context";
export const CHECK_TOOL_LEGACY = "nexus_check_target";
export const PROXY_PREFIX = "supabase__";
export const GITHUB_PROXY_PREFIX = "github__";
export const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

// Phase 1: server-held short-lived opaque session tokens, re-validated every
// request. TTL ~30min sliding (each successful validate extends expiry).
// Workspace-bound at mint; per-token verified fingerprint (Notion §7).
export const SESSION_TTL_MS = 30 * 60 * 1000;
export function createSessionStore({ ttlMs = SESSION_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map();
  function createSession(workspace, extra = {}) {
    const token = randomUUID();
    const at = now();
    const rec = {
      token,
      workspace: workspace ? path.resolve(String(workspace)) : null,
      createdAt: at,
      expiresAt: at + ttlMs,
      fingerprint: null,
      ...extra,
    };
    sessions.set(token, rec);
    return { token, workspace: rec.workspace, createdAt: rec.createdAt, expiresAt: rec.expiresAt };
  }
  function validateSession(token) {
    if (typeof token !== "string" || !token) return null;
    const rec = sessions.get(token);
    if (!rec) return null;
    const t = now();
    if (rec.expiresAt <= t) {
      sessions.delete(token);
      return null;
    }
    // Sliding expiry.
    rec.expiresAt = t + ttlMs;
    return rec;
  }
  function revokeSession(token) {
    if (typeof token !== "string" || !token) return false;
    return sessions.delete(token);
  }
  function getSession(token) {
    return sessions.get(token) ?? null;
  }
  return { createSession, validateSession, revokeSession, getSession, _map: sessions, ttlMs };
}

/** Accept token via `session` / `sessionToken` / `session_token` arg (header handled in HTTP layer). */
export function sessionTokenFromArgs(args) {
  if (!args || typeof args !== "object") return null;
  for (const key of ["session", "sessionToken", "session_token", "token"]) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function blocked(reason, extra = {}) {
  return { ...jsonResult({ decision: "block", reason, ...extra }), isError: true };
}

function decisionResult(decision, value, isError = false) {
  return { ...jsonResult({ decision, ...value }), ...(isError ? { isError: true } : {}) };
}

function contextToolDefinitions() {
  // Listed surface is dotted canonical only. Underscore compat + legacy are
  // callable but never listed; no dynamic proxy listing (revocation is an
  // execute decision, never a tool-list push). `session` accepts the opaque
  // Nexus token minted via POST /session (re-validated every request).
  const sessionProp = {
    session: { type: "string", description: "Opaque Nexus session token from POST /session. Re-validated every request." },
  };
  return [
    {
      name: CONTEXT_TOOL,
      title: "Nexus project context",
      description: "Show the project/session/environment tied to this Nexus connection and its safe service resources. Never returns passwords or tokens.",
      inputSchema: { type: "object", properties: { ...sessionProp }, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: REQUEST_TOOL,
      title: "Request scoped capability",
      description: "Request a scoped capability to invoke one operation through Nexus under this session. Returns allow, approval_required, or block — never a credential.",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string" },
          operation: { type: "string" },
          target: { type: "string" },
          ...sessionProp,
        },
        required: ["provider", "operation"], additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: EXECUTE_TOOL,
      title: "Execute protected operation",
      description: "Perform a protected provider operation through Nexus. Nexus resolves project+environment+resource, enforces policy, and forwards read-only Supabase calls.",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string" },
          operation: { type: "string" },
          arguments: { type: "object" },
          ...sessionProp,
        },
        required: ["provider", "operation"], additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
  ];
}

function normalizeRepo(value) {
  return String(value ?? "").trim().replace(/\/+$/, "").replace(/\.git$/, "");
}

async function runGit(args, cwd) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5000, maxBuffer: 16 * 1024 });
    const out = String(stdout ?? "").trim();
    return out ? out : null;
  } catch {
    return null;
  }
}

/** Notion §7 signals 3–4: observed Git identity + auto-discovery hints. Best-effort, never throws. */
async function observeGit(root) {
  const [gitRemote, gitBranch] = await Promise.all([
    runGit(["remote", "get-url", "origin"], root),
    runGit(["branch", "--show-current"], root),
  ]);
  return { gitRemote, gitBranch };
}

/** One process is pinned to one workspace. Tool arguments cannot switch its project. */
export async function readContext(workspace) {
  const root = await fs.realpath(workspace).catch(() => path.resolve(workspace));
  const observed = await observeGit(root);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, ".nexus", "project.json"), "utf8"));
  } catch {
    // Notion §7: discovering signals does not create a project; surface them to aid registration.
    return { status: "unresolved", workspace: root, reason: "This workspace has no readable Nexus project file.", observed };
  }
  if (!manifest || typeof manifest !== "object" || typeof manifest.project !== "string" || !manifest.project.trim()) {
    return { status: "unresolved", workspace: root, reason: "The Nexus project name is missing.", observed };
  }
  if (manifest.connections != null && (typeof manifest.connections !== "object" || Array.isArray(manifest.connections))) {
    return { status: "unresolved", workspace: root, reason: "The Nexus connections are invalid.", observed };
  }
  const declaredRepo = typeof manifest.repo === "string" && manifest.repo ? manifest.repo : undefined;
  const declaredBranch = typeof manifest.branch === "string" && manifest.branch ? manifest.branch : undefined;
  // Notion §7+§8: declared Git identity conflicting with observed state fails closed — ask, never guess.
  if (declaredRepo && observed.gitRemote && normalizeRepo(declaredRepo) !== normalizeRepo(observed.gitRemote)) {
    return { status: "unresolved", workspace: root, reason: "The Git remote does not match this project's registered repo. Developer confirmation is required before Nexus proceeds.", declared: { repo: declaredRepo }, observed };
  }
  if (declaredBranch && observed.gitBranch && declaredBranch !== observed.gitBranch) {
    return { status: "unresolved", workspace: root, reason: "The Git branch changed. Developer confirmation is required before session context changes.", declared: { branch: declaredBranch }, observed };
  }
  const environment = typeof manifest.environment === "string" && manifest.environment ? manifest.environment : "development";
  // Notion §2 Account layer: login/owner scoping the resource, never a bare provider.
  // Accept account/accountId/account_id at top level and per-connection (mirrors
  // src/store.ts migrateConnection alias pattern). Per-connection wins, else top-level.
  const topAccount = typeof manifest.account === "string" && manifest.account ? manifest.account
    : typeof manifest.accountId === "string" && manifest.accountId ? manifest.accountId
    : typeof manifest.account_id === "string" && manifest.account_id ? manifest.account_id : undefined;
  const topAccountId = typeof manifest.accountId === "string" && manifest.accountId ? manifest.accountId
    : typeof manifest.account === "string" && manifest.account ? manifest.account
    : typeof manifest.account_id === "string" && manifest.account_id ? manifest.account_id : undefined;
  const topDefaultOverride = typeof manifest.defaultOverride === "string" ? manifest.defaultOverride
    : manifest.overrides && typeof manifest.overrides === "object" && !Array.isArray(manifest.overrides) && typeof manifest.overrides.default === "string" ? manifest.overrides.default : undefined;
  const connections = Object.entries(manifest.connections ?? {}).map(([provider, entry]) => ({
    provider,
    ...(typeof entry === "string"
      ? { target: entry, resource: entry, environment, account: topAccount, accountId: topAccountId }
      : entry && typeof entry === "object" && !Array.isArray(entry) ? {
        target: typeof entry.target === "string" ? entry.target : (typeof entry.resource === "string" ? entry.resource : ""),
        resource: typeof entry.resource === "string" ? entry.resource : (typeof entry.target === "string" ? entry.target : ""),
        environment: typeof entry.environment === "string" && entry.environment ? entry.environment : environment,
        account: typeof entry.account === "string" && entry.account ? entry.account
          : typeof entry.accountId === "string" && entry.accountId ? entry.accountId
          : typeof entry.account_id === "string" && entry.account_id ? entry.account_id : topAccount,
        accountId: typeof entry.accountId === "string" && entry.accountId ? entry.accountId
          : typeof entry.account === "string" && entry.account ? entry.account
          : typeof entry.account_id === "string" && entry.account_id ? entry.account_id : topAccountId,
        project_ref: typeof entry.project_ref === "string" ? entry.project_ref : undefined,
        connection_id: typeof entry.connection_id === "string" ? entry.connection_id : undefined,
        method: typeof entry.method === "string" ? entry.method : undefined,
        status: typeof entry.status === "string" ? entry.status : undefined,
        serviceOverride: typeof entry.serviceOverride === "string" ? entry.serviceOverride
          : typeof entry.override === "string" ? entry.override : undefined,
        tagOverride: typeof entry.tagOverride === "string" ? entry.tagOverride : undefined,
      } : { target: "", resource: "", environment, account: topAccount, accountId: topAccountId }),
  }));
  return {
    status: "ready", workspace: root, project: manifest.project,
    project_id: typeof manifest.project_id === "string" ? manifest.project_id : undefined,
    environment,
    account: topAccount,
    accountId: topAccountId,
    defaultOverride: topDefaultOverride,
    repo: declaredRepo,
    branch: declaredBranch,
    observed,
    connections,
  };
}

function connectionAccount(connection) {
  if (!connection || typeof connection !== "object") return null;
  const v = connection.accountId ?? connection.account ?? connection.account_id ?? null;
  return typeof v === "string" && v ? v : null;
}

function requestedAccount(requested) {
  if (!requested || typeof requested !== "object") return null;
  const v = requested.accountId ?? requested.account ?? requested.account_id ?? null;
  return typeof v === "string" && v ? v : null;
}

function approvedSupabase(context, requested) {
  if (context.status !== "ready") return null;
  const matches = context.connections.filter(({ provider }) => provider.toLowerCase() === "supabase");
  if (matches.length !== 1) return null;
  const connection = matches[0];
  if (connection.status !== "connected" || connection.method !== "mcp" ||
      !SAFE_ID.test(context.project_id ?? "") || !SAFE_ID.test(connection.connection_id ?? "") ||
      !SAFE_ID.test(connection.project_ref ?? "")) return null;
  // Account layer: cross-account request blocks before any provider contact.
  // Old manifests without account stay working (no configured account => no mismatch).
  // Target and resource are checked independently: either one mismatching blocks,
  // so a matching target cannot mask a cross-project resource (or vice versa).
  if (requested) {
    const want = requestedAccount(requested);
    if (want != null) {
      const configured = connectionAccount(connection) ?? context.accountId ?? context.account ?? context.account_id ?? null;
      if (configured != null && String(want) !== String(configured)) return null;
    }
    const wantTarget = typeof requested.target === "string" && requested.target ? requested.target : null;
    if (wantTarget != null && wantTarget !== connection.target && wantTarget !== connection.resource) return null;
    const wantResource = typeof requested.resource === "string" && requested.resource ? requested.resource : null;
    if (wantResource != null && wantResource !== connection.target && wantResource !== connection.resource) return null;
  }
  return connection;
}

/** Native GitHub approval: one connected github binding per project, account+resource scoped. */
export function approvedGitHub(context, requested) {
  if (context.status !== "ready") return null;
  const matches = context.connections.filter(({ provider }) => normalizeProvider(provider) === "github");
  if (matches.length !== 1) return null;
  const connection = matches[0];
  if (connection.status !== "connected" || !SAFE_ID.test(context.project_id ?? "") ||
      !SAFE_ID.test(connection.connection_id ?? "")) return null;
  if (requested) {
    const want = requestedAccount(requested);
    if (want != null) {
      const configured = connectionAccount(connection) ?? context.accountId ?? context.account ?? context.account_id ?? null;
      if (configured != null && String(want) !== String(configured)) return null;
    }
    const wantTarget = typeof requested.target === "string" && requested.target ? requested.target : null;
    if (wantTarget != null && wantTarget !== connection.target && wantTarget !== connection.resource) return null;
    const wantResource = typeof requested.resource === "string" && requested.resource ? requested.resource : null;
    if (wantResource != null && wantResource !== connection.target && wantResource !== connection.resource) return null;
  }
  return connection;
}

/** Curated / self-added passthrough: any other single connected binding, fail-closed downstream. */
export function approvedCurated(context, provider, requested) {
  const name = normalizeProvider(provider);
  if (!name || name === "supabase" || name === "github") return null;
  if (context.status !== "ready") return null;
  const matches = context.connections.filter(({ provider: p }) => normalizeProvider(p) === name);
  if (matches.length !== 1) return null;
  const connection = matches[0];
  if (connection.status !== "connected") return null;
  if (requested) {
    const want = requestedAccount(requested);
    if (want != null) {
      const configured = connectionAccount(connection) ?? context.accountId ?? context.account ?? context.account_id ?? null;
      if (configured != null && String(want) !== String(configured)) return null;
    }
    const wantTarget = typeof requested.target === "string" && requested.target ? requested.target : null;
    if (wantTarget != null && wantTarget !== connection.target && wantTarget !== connection.resource) return null;
    const wantResource = typeof requested.resource === "string" && requested.resource ? requested.resource : null;
    if (wantResource != null && wantResource !== connection.target && wantResource !== connection.resource) return null;
  }
  return connection;
}

/** Legacy MVP policy kept for compat (REQUEST path + old callers). EXECUTE routes via decideGuard. */
export function decidePolicy({ environment, operation, isExposed }) {
  if (!isExposed) {
    // Writes, unknown tools, destructive ops: blocked by default; production explicit.
    if (environment === "production") {
      return { decision: "block", reason: "Writes and changes are blocked in production. Ask the developer to review this operation." };
    }
    return { decision: "block", reason: "This tool is not enabled. Use an allowed read tool, or ask the developer to enable it." };
  }
  // Low-risk reads auto-allowed but still pass through Nexus (Notion §3).
  return { decision: "allow" };
}

/**
 * EXECUTE policy via central Guard (reuses guard-policy.mjs, no duplicated logic).
 * - read + exposed -> allow (central table read:* = allow)
 * - unmapped (classify null) -> approval_required (fail closed, never silent allow)
 * - known but unexposed (writes/destructive outside read set) -> block (read-only gate)
 * - production destructive/write exposed -> block via central table
 * Phase 1 (Guard hide, MVP): costBearing/escapeHatch are DEFERRED-PAID and
 * ignored unless GUARD_ENABLED=1. MVP routing is read-allow/block only.
 */
export function decideExecute({ operation, env, escapeHatch = false, escapeReason, costBearing = false } = {}) {
  const guardOn = isGuardEnabled();
  const effectiveEscape = guardOn ? escapeHatch : false;
  const effectiveReason = guardOn ? escapeReason : undefined;
  const effectiveCost = guardOn ? costBearing : false;
  const vocab = classify(operation);
  const isExposed = DEFAULT_READ_TOOLS.has(operation);
  if (vocab === null || vocab === undefined) {
    return decideGuard({ vocab: null, env, operation });
  }
  if (!isExposed) {
    return decideGuard({ vocab, env, operation, isExposed: false, costBearing: effectiveCost, escapeHatch: effectiveEscape, escapeReason: effectiveReason });
  }
  return decideGuard({ vocab, env, operation, isExposed: true, costBearing: effectiveCost, escapeHatch: effectiveEscape, escapeReason: effectiveReason });
}

/**
 * GitHub EXECUTE policy: same central Guard, but the read gate is the GitHub
 * allowlist (isReadTool) instead of the Supabase set. Writes/destructive
 * outside the allowlist block; unmapped terms require approval.
 * Phase 1: cost/escape gated as above.
 */
export function decideGitHubExecute({ operation, env, escapeHatch = false, escapeReason, costBearing = false } = {}) {
  const guardOn = isGuardEnabled();
  const effectiveEscape = guardOn ? escapeHatch : false;
  const effectiveReason = guardOn ? escapeReason : undefined;
  const effectiveCost = guardOn ? costBearing : false;
  const vocab = classify(operation);
  const isExposed = isReadTool("github", operation);
  if (vocab === null || vocab === undefined) {
    return decideGuard({ vocab: null, env, operation });
  }
  if (!isExposed) {
    return decideGuard({ vocab, env, operation, isExposed: false, costBearing: effectiveCost, escapeHatch: effectiveEscape, escapeReason: effectiveReason });
  }
  return decideGuard({ vocab, env, operation, isExposed: true, costBearing: effectiveCost, escapeHatch: effectiveEscape, escapeReason: effectiveReason });
}

/** Curated EXECUTE policy: always fail closed to approval (providers.mjs). */
export function decideCuratedExecute({ provider, operation, env } = {}) {
  return curatedDecision({ provider, operation, env });
}

/**
 * Apply explicit service->tag->default override chain (resolveOverride) on top of guard.
 * Phase 1 (Guard hide, MVP OUT): DEFERRED-PAID — ignored unless GUARD_ENABLED=1.
 * MVP returns guardResult unchanged (routing enforcement only). No override
 * configured -> guard stands. Block never disconnects; auto-approve audited.
 * Fail closed: guard block stays block even if override says allow (needs escape hatch).
 */
export function applyOverride(guardResult, connection, context) {
  if (!isGuardEnabled()) return guardResult;
  const serviceOverride = connection?.serviceOverride ?? connection?.override ?? null;
  const tagOverride = connection?.tagOverride ?? null;
  const def = context?.defaultOverride ?? null;
  if (!serviceOverride && !tagOverride && !def) return guardResult;
  const resolved = resolveOverride({ serviceOverride, tagOverride, default: def });
  const base = { ...guardResult, override: resolved.override, overrideSource: resolved.source, disconnect: false, audited: true };
  if (guardResult.decision === "block") return base;
  if (resolved.decision === "block") {
    return { ...base, decision: "block", reason: `The ${resolved.source} rule (${resolved.override}) blocks this operation, and the connection stays connected. Ask the developer to change the rule to allow it.` };
  }
  if (resolved.decision === "approval_required" && guardResult.decision === "allow") {
    return { ...base, decision: "approval_required", reason: `The ${resolved.source} rule (${resolved.override}) requires developer approval. Ask the developer to review this operation.` };
  }
  if (resolved.decision === "allow" && guardResult.decision === "approval_required") {
    return { ...base, decision: "allow", reason: `Override ${resolved.override} (${resolved.source}) auto-approved (audited).` };
  }
  return base;
}

/** The repository a GitHub tool call names, as "owner/repo", or just the owner
 *  when only that is given. GitHub tools address a repository with owner + repo
 *  (or a full "owner/repo"), not with target/resource. Null when none is named. */
export function githubNamedRepo(args) {
  if (!args || typeof args !== "object") return null;
  const owner = typeof args.owner === "string" && args.owner.trim() ? args.owner.trim() : null;
  const repo = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : null;
  if (repo && repo.includes("/")) return { full: repo, owner: repo.split("/")[0] };
  if (owner && repo) return { full: `${owner}/${repo}`, owner };
  if (owner) return { full: null, owner };
  return null;
}

/** True when a call names a repository other than the one bound to this project. */
function namesOtherGithubRepo(connection, args) {
  const named = githubNamedRepo(args);
  if (!named) return false;
  const bound = [connection.target, connection.resource].filter((v) => typeof v === "string" && v).map((v) => v.toLowerCase());
  if (named.full) return !bound.includes(named.full.toLowerCase());
  return !bound.some((v) => v.split("/")[0] === named.owner.toLowerCase());
}

function isCrossAccountTarget(connection, requested) {
  if (!requested || typeof requested !== "object") return false;
  const t = typeof requested.target === "string" && requested.target ? requested.target : null;
  const r = typeof requested.resource === "string" && requested.resource ? requested.resource : null;
  // Either field mismatching is cross-account/cross-project; a matching target
  // never masks a mismatched resource (or vice versa).
  if (t != null && t !== connection.target && t !== connection.resource) return true;
  if (r != null && r !== connection.target && r !== connection.resource) return true;
  return false;
}

function isCrossAccount(requested, connection, context) {
  const want = requestedAccount(requested);
  if (want == null) return false;
  const configured = connectionAccount(connection) ?? context?.accountId ?? context?.account ?? context?.account_id ?? null;
  if (configured == null) return false;
  return String(want) !== String(configured);
}

// EXECUTE scoping: top-level fields and nested arguments.* are checked
// separately so one cannot mask the other (merged objects would let a matching
// nested account hide a cross-account top-level field). Both must approve.
function approvedWithNested(approve, context, args, opArgs) {
  const top = approve(context, args);
  if (!top) return null;
  const nested = approve(context, opArgs);
  if (!nested) return null;
  return top;
}

/** Real provider adapter. New MCP services can add their own URL and policy here. */
async function connectSupabase(connection, accessToken) {
  const url = new URL(SUPABASE_URL);
  url.searchParams.set("project_ref", connection.project_ref);
  url.searchParams.set("read_only", "true");
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "nexus-guard", version: "0.3.0" }, { capabilities: {} });
  await client.connect(transport, { timeout: 15_000 });
  return {
    listTools: (params) => client.listTools(params, { timeout: 15_000 }),
    callTool: (params, schema, options) => client.callTool(params, schema, options),
    close: () => transport.close(),
  };
}

/**
 * GitHub native adapter (scaffold).
 * Upstream is the official github/github-mcp-server. Remote URL is configurable
 * via NEXUS_GITHUB_MCP_URL for HTTP transport; stdio/docker deployments can
 * inject their own connectGithubProvider in makeNexusServer dependencies.
 * Auth is a short-lived token from the OS keychain, never returned to the agent.
 */
const GITHUB_MCP_URL = process.env.NEXUS_GITHUB_MCP_URL ?? "https://api.githubcopilot.com/mcp";
async function connectRemoteMcp(url, accessToken) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "nexus-guard", version: "0.3.0" }, { capabilities: {} });
  await client.connect(transport, { timeout: 15_000 });
  return {
    listTools: (params) => client.listTools(params, { timeout: 15_000 }),
    callTool: (params, schema, options) => client.callTool(params, schema, options),
    close: () => transport.close(),
  };
}

async function connectGitHub(_connection, accessToken) {
  const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "nexus-guard", version: "0.3.0" }, { capabilities: {} });
  await client.connect(transport, { timeout: 15_000 });
  return {
    listTools: (params) => client.listTools(params, { timeout: 15_000 }),
    callTool: (params, schema, options) => client.callTool(params, schema, options),
    close: () => transport.close(),
  };
}

async function readProviderToken(provider, projectId, connectionId) {
  const binary = process.env.NEXUS_KEYRING_BIN ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src-tauri/target/debug/nexus-keyring");
  const { stdout } = await execFileAsync(binary, [normalizeProvider(provider), projectId, connectionId], {
    maxBuffer: 64 * 1024, timeout: 10_000,
  });
  const value = JSON.parse(stdout);
  const token = typeof value.accessToken === "string" && value.accessToken
    ? value.accessToken
    : typeof value.token === "string" && value.token ? value.token : null;
  if (!token) throw new Error("Approval token is missing.");
  return token;
}

async function readSupabaseToken(projectId, connectionId) {
  const binary = process.env.NEXUS_KEYRING_BIN ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src-tauri/target/debug/nexus-keyring");
  const { stdout } = await execFileAsync(binary, ["supabase", projectId, connectionId], {
    maxBuffer: 64 * 1024, timeout: 10_000,
  });
  const value = JSON.parse(stdout);
  if (typeof value.accessToken !== "string" || !value.accessToken) throw new Error("Approval token is missing.");
  return value.accessToken;
}

async function withSupabase(context, dependencies, action) {
  const connection = approvedSupabase(context);
  if (!connection) throw new Error("No approved Supabase connection is set up for this project.");
  let token;
  try {
    token = await dependencies.getToken(context.project_id, connection.connection_id);
  } catch (error) {
    // Token refresh (Notion §6): one retry via optional refresh hook, else approval_required.
    if (typeof dependencies.refreshToken === "function") {
      try {
        await dependencies.refreshToken(context.project_id, connection.connection_id);
        token = await dependencies.getToken(context.project_id, connection.connection_id);
      } catch {
        throw new Error("APPROVAL_REQUIRED: Supabase rejected the saved approval (expired or revoked). Reconnect Supabase in Connections, then re-check.");
      }
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      if (/expir|revok|auth|approval/i.test(msg)) {
        throw new Error("APPROVAL_REQUIRED: Supabase rejected the saved approval (expired or revoked). Reconnect Supabase in Connections, then re-check.");
      }
      throw error;
    }
  }
  const provider = await dependencies.connectProvider(connection, token);
  try {
    return await action(provider, connection);
  } finally {
    await provider.close().catch(() => undefined);
  }
}

async function upstreamToolList(provider) {
  const tools = [];
  let cursor;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await provider.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (!cursor) return tools;
  }
  throw new Error("The provider tool list exceeded the page limit.");
}

function exposedTools(tools) {
  return tools.filter((tool) => DEFAULT_READ_TOOLS.has(tool.name));
}

function exposedGitHubTools(tools) {
  return tools.filter((tool) => isReadTool("github", tool.name));
}

function auditRecord({ sessionId, context, connection, operation, decision, reason }) {
  // Secret-free by construction: never include tokens, headers, or raw arguments with secrets.
  // sessionId here is the server-held opaque Nexus token (or anon instance id);
  // never echoed to the agent as proof — enforced server-side only.
  return {
    ts: new Date().toISOString(),
    session: sessionId,
    project: context.project ?? null,
    project_id: context.project_id ?? null,
    account: connectionAccount(connection) ?? context.accountId ?? context.account ?? null,
    environment: connection?.environment ?? context.environment ?? null,
    provider: connection?.provider ? normalizeProvider(connection.provider) : null,
    resource: connection?.resource ?? connection?.target ?? null,
    operation: operation ?? null,
    decision,
    reason: reason ?? null,
  };
}

/** Pick the one workspace a client's `roots/list` answer names. Roots are
 *  client-asserted, so anything but exactly one absolute file:// root is
 *  refused: Nexus surfaces the conflict and never guesses (paper §7). */
export function pickWorkspaceFromRoots(roots) {
  const dirs = new Set();
  for (const root of Array.isArray(roots) ? roots : []) {
    const uri = typeof root?.uri === "string" ? root.uri : "";
    if (!uri.startsWith("file://")) continue;
    let dir;
    try {
      dir = fileURLToPath(uri);
    } catch {
      continue;
    }
    if (!path.isAbsolute(dir) || dir.length > 1024) continue;
    dirs.add(path.resolve(dir));
  }
  if (dirs.size === 0) return { ok: false, reason: "The agent reported no workspace folder, so Nexus cannot tell which project this is. Register Nexus in the project with its workspace, then try again." };
  if (dirs.size > 1) return { ok: false, reason: "The agent reported more than one workspace folder, so Nexus cannot tell which project this is. Open the agent in a single project folder or register Nexus with an explicit workspace." };
  return { ok: true, workspace: [...dirs][0] };
}

/** Directly relays upstream tool definitions and calls, rather than reimplementing provider tools. */
export function makeNexusServer({ workspace = process.cwd(), getToken = readSupabaseToken, connectProvider = connectSupabase, refreshToken, onAudit, getGithubToken, connectGithubProvider, getRemoteToken, connectRemoteProvider, getWriteGrant, getBindingScope, getServiceScopeSpec, knownCurated = [], sessionStore = null, requireSession = false } = {}) {
  const server = new Server({ name: "nexus-guard", version: "0.3.0" }, { capabilities: { tools: { listChanged: false } } });
  const dependencies = { getToken, connectProvider, refreshToken };
  const githubDeps = {
    getToken: getGithubToken ?? ((projectId, connectionId) => readProviderToken("github", projectId, connectionId)),
    connectProvider: connectGithubProvider ?? connectGitHub,
    refreshToken,
  };
  const remoteDeps = {
    getToken: getRemoteToken ?? ((provider, projectId, connectionId) => readProviderToken(provider, projectId, connectionId)),
    connect: connectRemoteProvider ?? connectRemoteMcp,
    writeGrant: getWriteGrant ?? ((projectId, connectionId) => readWriteGrant(projectId, connectionId)),
    scopeSpec: getServiceScopeSpec ?? serviceScopeSpec,
    scope: getBindingScope ?? ((projectId, connectionId) => readBindingScope(projectId, connectionId)),
  };
  // `workspace: null` defers binding to the client's MCP roots (paper §7/§10):
  // used only when no explicit workspace was supplied. Once bound it never
  // changes; a later roots change forces developer confirmation, not a switch.
  let pinnedWorkspace = workspace == null ? null : path.resolve(workspace);
  let boundFromRoots = false;
  let rootsDirty = false;
  // Notion §6: server-held short-lived opaque sessions, re-validated every request.
  const store = sessionStore ?? createSessionStore();
  // Local audit instance id for token-less (stdio compat) calls. Never echoed
  // to the agent as proof; token path uses the opaque token as audit session.
  const instanceId = randomUUID();
  // Notion §7 previously-verified mapping, scoped PER-TOKEN (not per-process):
  // fingerprint of the first ready context seen under each token. Any change
  // forces re-verification, never a silent switch. Anon (no-token compat) has
  // its own slot.
  const verifiedByToken = new Map();
  let anonFingerprint = null;
  function fingerprint(context) {
    const targets = (context.connections ?? [])
      .map((c) => `${String(c.provider).toLowerCase()}:${c.accountId ?? c.account ?? c.account_id ?? ""}:${c.target ?? c.resource ?? ""}`)
      .sort().join(",");
    // Account is part of the verified mapping: mid-session account change forces re-verification.
    return [context.project_id ?? context.project, context.environment, context.accountId ?? context.account ?? context.account_id ?? "", context.repo ?? "", context.branch ?? "", targets].join("|");
  }
  async function resolveContext(sessionToken = null) {
    const context = await readContext(pinnedWorkspace);
    if (context.status === "ready") {
      const print = fingerprint(context);
      if (sessionToken) {
        const known = verifiedByToken.get(sessionToken);
        if (known == null) {
          verifiedByToken.set(sessionToken, print);
        } else if (known !== print) {
          return { status: "unresolved", workspace: context.workspace, reason: "Project context changed during this session (project, branch, repo, or connections). Developer confirmation is required before Nexus proceeds.", observed: context.observed };
        }
      } else {
        if (anonFingerprint === null) {
          anonFingerprint = print;
        } else if (anonFingerprint !== print) {
          return { status: "unresolved", workspace: context.workspace, reason: "Project context changed during this session (project, branch, repo, or connections). Developer confirmation is required before Nexus proceeds.", observed: context.observed };
        }
      }
    }
    return context;
  }
  function auditSessionId(validatedToken) {
    return validatedToken?.token ?? `anon:${instanceId}`;
  }

  // Agent identity for display only (Home topology, Activity): the MCP client
  // name the agent declared in its initialize handshake (e.g. "claude-code").
  // Never used for routing or policy — a client can declare any name, so this
  // is a label, not an identity. Resolved lazily because clientInfo only
  // exists after the client sends initialize.
  function clientAgent() {
    try {
      const info = server.getClientVersion();
      const name = info?.name;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  }

  async function audit(entry) {
    try {
      const withAgent = entry.agent == null ? { ...entry, agent: clientAgent() } : entry;
      if (typeof onAudit === "function") onAudit(withAgent);
      // Best-effort local audit log (secret-free). Ignore failures.
      const ctx = withAgent.__context;
      const line = JSON.stringify({ ...withAgent, __context: undefined }) + "\n";
      if (ctx?.workspace) {
        await fs.appendFile(path.join(ctx.workspace, ".nexus", "audit.log"), line).catch(() => undefined);
      }
    } catch { /* never break tool calls on audit failure */ }
  }

  async function executeSupabaseOperation(context, connection, upstreamName, args, opts = {}) {
    const env = connection.environment ?? context.environment;
    const guardOn = isGuardEnabled();
    let policy = decideExecute({
      operation: upstreamName,
      env,
      escapeHatch: guardOn ? opts.escapeHatch === true : false,
      escapeReason: guardOn && typeof opts.escapeReason === "string" ? opts.escapeReason : undefined,
      costBearing: guardOn ? opts.costBearing === true : false,
    });
    policy = applyOverride(policy, connection, context);
    const auditSid = opts.auditSessionId ?? `anon:${instanceId}`;
    if (policy.decision !== "allow") {
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: policy.decision, reason: policy.reason }), __context: context });
      if (policy.decision === "approval_required") {
        return decisionResult("approval_required", { reason: policy.reason, operation: upstreamName }, true);
      }
      return blocked(policy.reason, { operation: upstreamName });
    }
    try {
      return await withSupabase(context, dependencies, async (provider) => {
        // Recheck the real provider's current tool list before forwarding a call.
        const offered = exposedTools(await upstreamToolList(provider));
        if (!offered.some((tool) => tool.name === upstreamName)) {
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: "tool not offered by provider" }), __context: context });
          return blocked("Supabase does not offer this tool right now. Use an available read tool, or ask the developer.");
        }
        const result = await provider.callTool({ name: upstreamName, arguments: args }, undefined, { timeout: 20_000 });
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "allow" }), __context: context });
        return result;
      });
    } catch (error) {
      console.error(`Nexus provider call failed: ${error instanceof Error ? error.name : "unknown error"}`);
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("APPROVAL_REQUIRED")) {
        // Paper: revocation surfaces as an execute decision (revoked:true, block),
        // never a tool-list push.
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: message }), __context: context });
        return decisionResult("block", { reason: message, operation: upstreamName, revoked: true }, true);
      }
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: "provider unavailable" }), __context: context });
      return blocked("Supabase is unavailable or the saved approval needs attention. Reconnect Supabase in Connections if this persists, and check whether the operation completed before retrying.");
    }
  }

  async function withGitHub(context, action) {
    const connection = approvedGitHub(context);
    if (!connection) throw new Error("No approved GitHub connection is set up for this project.");
    let token;
    try {
      token = await githubDeps.getToken(context.project_id, connection.connection_id);
    } catch (error) {
      if (typeof githubDeps.refreshToken === "function") {
        try {
          await githubDeps.refreshToken(context.project_id, connection.connection_id);
          token = await githubDeps.getToken(context.project_id, connection.connection_id);
        } catch {
          throw new Error("APPROVAL_REQUIRED: GitHub rejected the saved approval (expired or revoked). Reconnect GitHub in Connections, then re-check.");
        }
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        if (/expir|revok|auth|approval/i.test(msg)) {
          throw new Error("APPROVAL_REQUIRED: GitHub rejected the saved approval (expired or revoked). Reconnect GitHub in Connections, then re-check.");
        }
        throw error;
      }
    }
    const provider = await githubDeps.connectProvider(connection, token);
    try {
      return await action(provider, connection);
    } finally {
      await provider.close().catch(() => undefined);
    }
  }

  async function executeGitHubOperation(context, connection, upstreamName, args, opts = {}) {
    const env = connection.environment ?? context.environment;
    const guardOn = isGuardEnabled();
    let policy = decideGitHubExecute({
      operation: upstreamName,
      env,
      escapeHatch: guardOn ? opts.escapeHatch === true : false,
      escapeReason: guardOn && typeof opts.escapeReason === "string" ? opts.escapeReason : undefined,
      costBearing: guardOn ? opts.costBearing === true : false,
    });
    policy = applyOverride(policy, connection, context);
    const auditSid = opts.auditSessionId ?? `anon:${instanceId}`;
    if (policy.decision !== "allow") {
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: policy.decision, reason: policy.reason }), __context: context });
      if (policy.decision === "approval_required") {
        return decisionResult("approval_required", { reason: policy.reason, operation: upstreamName }, true);
      }
      return blocked(policy.reason, { operation: upstreamName });
    }
    // Hold the agent to this project's repository itself, whatever the token can reach.
    if (namesOtherGithubRepo(connection, args)) {
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: "cross-project target" }), __context: context });
      return blocked("That repository does not belong to this project. Use the project's own repository, or ask the developer to add it.", { operation: upstreamName });
    }
    try {
      return await withGitHub(context, async (provider) => {
        const offered = exposedGitHubTools(await upstreamToolList(provider));
        if (!offered.some((tool) => tool.name === upstreamName)) {
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: "tool not offered by provider" }), __context: context });
          return blocked("GitHub does not offer this tool right now. Use an available read tool, or ask the developer.");
        }
        const result = await provider.callTool({ name: upstreamName, arguments: args }, undefined, { timeout: 20_000 });
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "allow" }), __context: context });
        return result;
      });
    } catch (error) {
      console.error(`Nexus provider call failed: ${error instanceof Error ? error.name : "unknown error"}`);
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("APPROVAL_REQUIRED")) {
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: message }), __context: context });
        return decisionResult("block", { reason: message, operation: upstreamName, revoked: true }, true);
      }
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: "block", reason: "provider unavailable" }), __context: context });
      return blocked("GitHub is unavailable or the saved approval needs attention. Reconnect GitHub in Connections if this persists, and check whether the operation completed before retrying.");
    }
  }

  /** A signed-in remote MCP service (Linear, Stripe, …). Only tools that declare themselves
   *  read-only are forwarded; everything else needs approval and never reaches the service.
   *  Isolation here is the signed-in account, not one resource. */
  async function executeRemoteOperation(context, connection, providerName, operation, args, opts = {}) {
    const auditSid = opts.auditSessionId ?? `anon:${instanceId}`;
    const url = serviceMcpUrl(providerName);
    const log = (decision, reason) => audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision, reason }), __context: context });
    let provider;
    try {
      const token = await remoteDeps.getToken(normalizeProvider(providerName), context.project_id, connection.connection_id);
      provider = await remoteDeps.connect(url, token);
      const listed = await provider.listTools();
      const tools = Array.isArray(listed?.tools) ? listed.tools : [];
      const spec = remoteDeps.scopeSpec(providerName);
      const bound = spec ? await remoteDeps.scope(context.project_id, connection.connection_id) : null;
      if (operation === "list_tools") {
        await log("allow", null);
        return jsonResult({
          provider: providerName,
          ...(spec ? { can_be_limited_to: spec.label } : {}),
          ...(bound ? { limited_to: { [spec.label]: bound } } : {}),
          tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", kind: remoteToolKind(t), read_only: remoteToolKind(t) === "read", ...(spec ? { limitable: scopeArgOf(t, spec) !== null } : {}) })),
        });
      }
      const tool = tools.find((t) => t.name === operation);
      if (!tool) {
        await log("block", "tool not offered by provider");
        return blocked("This service does not offer that tool right now. Run list_tools to see what it offers.", { operation });
      }
      const kind = remoteToolKind(tool);
      const allowWrites = kind === "write" ? await remoteDeps.writeGrant(context.project_id, connection.connection_id) === true : false;
      const policy = remoteToolDecision(tool, { allowWrites, environment: connection.environment ?? context.environment });
      if (policy.decision !== "allow") {
        await log("approval_required", policy.reason);
        return decisionResult("approval_required", { reason: policy.reason, operation, kind: policy.kind }, true);
      }
      const scoped = applyResourceScope({ tool, spec, bound, args });
      if (!scoped.ok) {
        await log("block", "outside this binding's limit");
        return blocked(scoped.reason, { operation });
      }
      const result = await provider.callTool({ name: operation, arguments: scoped.args }, undefined, { timeout: 20_000 });
      await log("allow", policy.reason);
      return result;
    } catch (error) {
      console.error(`Nexus remote service call failed: ${error instanceof Error ? error.name : "unknown error"}`);
      await log("block", "provider unavailable");
      return blocked(`${String(providerName)} is unavailable or the saved sign-in needs attention. Reconnect it in Accounts if this persists.`);
    } finally {
      await provider?.close?.().catch(() => undefined);
    }
  }

  async function executeCuratedOperation(context, connection, providerName, upstreamName, opts = {}) {
    const env = connection.environment ?? context.environment;
    let policy = decideCuratedExecute({ provider: providerName, operation: upstreamName, env });
    policy = applyOverride(policy, connection, context);
    const auditSid = opts.auditSessionId ?? `anon:${instanceId}`;
    await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation: upstreamName, decision: policy.decision, reason: policy.reason }), __context: context });
    if (policy.decision === "approval_required") {
      return decisionResult("approval_required", { reason: policy.reason, operation: upstreamName }, true);
    }
    return blocked(policy.reason, { operation: upstreamName });
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Paper: canonical dotted tools only. No legacy, no dynamic proxy listing.
    // Revocation is an execute decision, never a tool-list push. Static list —
    // no provider contact here (routing happens in nexus.execute).
    return { tools: contextToolDefinitions() };
  });

  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    rootsDirty = true;
  });

  async function readRoots(extra) {
    if (!server.getClientCapabilities()?.roots) return { ok: false, reason: "The agent does not share its workspace folder, so Nexus cannot tell which project this is. Register Nexus in the project with its workspace, then try again." };
    try {
      const result = await extra.sendRequest({ method: "roots/list" }, ListRootsResultSchema);
      return pickWorkspaceFromRoots(result.roots);
    } catch {
      return { ok: false, reason: "Nexus could not read the agent's workspace folder. Register Nexus in the project with its workspace, then try again." };
    }
  }

  /** Bind (first call) or re-check (after roots/list_changed) the roots-derived workspace. */
  async function ensureWorkspace(extra) {
    if (pinnedWorkspace && !boundFromRoots) return { ok: true };
    if (pinnedWorkspace && !rootsDirty) return { ok: true };
    const found = await readRoots(extra);
    if (!found.ok) return { ok: false, reason: found.reason };
    if (!pinnedWorkspace) {
      pinnedWorkspace = found.workspace;
      boundFromRoots = true;
      return { ok: true };
    }
    if (found.workspace !== pinnedWorkspace) {
      return { ok: false, reason: "The agent's workspace folder changed during this session. Developer confirmation is required before Nexus proceeds; reconnect the agent in the new project." };
    }
    rootsDirty = false;
    return { ok: true };
  }

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;
    const located = await ensureWorkspace(extra);
    if (!located.ok) return blocked(located.reason);
    const rawToken = sessionTokenFromArgs(args);
    let validatedToken = null;
    if (rawToken) {
      validatedToken = store.validateSession(rawToken);
      if (!validatedToken) {
        const ctxForAudit = await readContext(pinnedWorkspace).catch(() => ({ workspace: pinnedWorkspace }));
        await audit({ ...auditRecord({ sessionId: rawToken, context: ctxForAudit, connection: null, operation: name ?? null, decision: "block", reason: "Nexus session is invalid or expired." }), __context: ctxForAudit });
        return decisionResult("block", { reason: "Nexus session is invalid or expired. Mint a new one via POST /session, then retry.", operation: name ?? null, revoked: true }, true);
      }
    } else if (requireSession) {
      const ctxForAudit = await readContext(pinnedWorkspace).catch(() => ({ workspace: pinnedWorkspace }));
      await audit({ ...auditRecord({ sessionId: `anon:${instanceId}`, context: ctxForAudit, connection: null, operation: name ?? null, decision: "block", reason: "Missing Nexus session." }), __context: ctxForAudit });
      return decisionResult("block", { reason: "Missing Nexus session. Mint one via POST /session, then retry with session.", operation: name ?? null }, true);
    }
    if (boundFromRoots && validatedToken?.workspace && path.resolve(validatedToken.workspace) !== pinnedWorkspace) {
      return blocked("That Nexus session does not belong to the project this agent is in.");
    }
    const tokenKey = validatedToken?.token ?? null;
    const auditSid = auditSessionId(validatedToken);
    const context = await resolveContext(tokenKey);
    if (context.status !== "ready") {
      await audit({ ...auditRecord({ sessionId: auditSid, context: { ...context, workspace: context.workspace }, connection: null, operation: request.params?.name ?? null, decision: "block", reason: context.reason }), __context: context });
      return blocked(context.reason);
    }
    const guardOn = isGuardEnabled();
    const execOpts = (base = {}) => ({
      escapeHatch: guardOn ? base.escapeHatch === true : false,
      escapeReason: guardOn && typeof base.escapeReason === "string" ? base.escapeReason : undefined,
      costBearing: guardOn ? base.costBearing === true : false,
      auditSessionId: auditSid,
    });

    if (name === CONTEXT_TOOL || name === CONTEXT_TOOL_UNDERSCORE || name === PROJECT_TOOL_LEGACY) {
      const deprecated = name === PROJECT_TOOL_LEGACY;
      // A resolved context call is the first thing an agent does; recording it
      // lets the desktop app show "your agent reached Nexus" during setup.
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection: null, operation: CONTEXT_TOOL, decision: "allow", reason: null }), __context: context });
      return jsonResult({ ...context, safety: "Connection identity only. No credentials are returned.", ...(deprecated ? { deprecated: true, deprecation: "Use nexus.context instead. This alias will be removed next release." } : {}) });
    }
    if (name === CHECK_TOOL_LEGACY) {
      const matching = context.connections.filter(({ provider }) => provider.toLowerCase() === String(args.provider).toLowerCase());
      if (matching.length !== 1) return blocked("This project has no single configured service for that provider. Ask the developer to fix the project connections, then retry.");
      const decision = matching[0].target === args.target ? "allow" : "block";
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection: matching[0], operation: `check:${String(args.provider)}`, decision, reason: decision === "allow" ? null : "target mismatch" }), __context: context });
      return jsonResult({ project: context.project, environment: context.environment, provider: args.provider, decision, configured_target: matching[0].target, configured_resource: matching[0].resource ?? matching[0].target, deprecated: true, deprecation: "Use nexus.request_access instead. This alias will be removed next release." });
    }
    if (name === REQUEST_TOOL || name === REQUEST_TOOL_UNDERSCORE) {
      const provider = normalizeProvider(args.provider ?? "");
      const operation = String(args.operation ?? "");
      if (provider === "github") {
        const preConnection = approvedGitHub(context, args);
        if (isCrossAccountTarget(approvedGitHub(context) ?? {}, args) || isCrossAccount(args, approvedGitHub(context) ?? {}, context)) {
          const connection = approvedGitHub(context);
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: "block", reason: "cross-account target" }), __context: context });
          return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation });
        }
        const connection = preConnection ?? approvedGitHub(context);
        if (!connection) return blocked("No approved GitHub connection belongs to this project. Reconnect GitHub in Connections, then retry.");
        if (args.target && args.target !== connection.target && args.target !== connection.resource) {
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: "block", reason: "cross-project target" }), __context: context });
          return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation });
        }
        if ((args.resource && args.resource !== connection.target && args.resource !== connection.resource) || isCrossAccount(args, connection, context)) {
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: "block", reason: "cross-account target" }), __context: context });
          return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation });
        }
        const policy = decidePolicy({ environment: connection.environment ?? context.environment, operation, isExposed: isReadTool("github", operation) });
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: policy.decision, reason: policy.reason ?? null }), __context: context });
        if (policy.decision !== "allow") return blocked(policy.reason, { operation });
        return decisionResult("allow", { project: context.project, environment: connection.environment ?? context.environment, provider: args.provider, operation, resource: connection.resource ?? connection.target, capability: `cap:${operation}`, note: "Capability is enforced server-side; no credential is returned." });
      }
      if (provider !== "supabase" && provider !== "github") {
        const tier = providerTier(provider, knownCurated);
        const connection = approvedCurated(context, provider, args);
        const base = approvedCurated(context, provider);
        if (!connection) {
          const crossTarget = base && (isCrossAccountTarget(base, args) || isCrossAccount(args, base, context));
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection: base, operation, decision: "block", reason: crossTarget ? "cross-account target" : "no approved connection" }), __context: context });
          return blocked(crossTarget ? "That target does not belong to this project. Use the configured project connection, or ask the developer to add it." : `No approved ${String(args.provider)} connection belongs to this project (${tier} tier defaults to approval). Ask the developer to connect it, then retry.`, { operation });
        }
        const policy = decideCuratedExecute({ provider, operation, env: connection.environment ?? context.environment });
        const withOverride = applyOverride(policy, connection, context);
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: withOverride.decision, reason: withOverride.reason }), __context: context });
        return decisionResult(withOverride.decision, { reason: withOverride.reason, operation }, true);
      }
      const preConnection = approvedSupabase(context, args);
      if (isCrossAccountTarget(approvedSupabase(context) ?? {}, args) || isCrossAccount(args, approvedSupabase(context) ?? {}, context)) {
        const connection = approvedSupabase(context);
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: "block", reason: "cross-account target" }), __context: context });
        return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation });
      }
      const connection = preConnection ?? approvedSupabase(context);
      if (!connection) return blocked("No approved Supabase connection belongs to this project. Reconnect Supabase in Connections, then retry.");
      if (args.target && args.target !== connection.target && args.target !== connection.resource) {
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: "block", reason: "cross-project target" }), __context: context });
        return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation });
      }
      if ((args.resource && args.resource !== connection.target && args.resource !== connection.resource) || isCrossAccount(args, connection, context)) {
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: "block", reason: "cross-account target" }), __context: context });
        return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation });
      }
      const policy = decidePolicy({ environment: connection.environment ?? context.environment, operation, isExposed: DEFAULT_READ_TOOLS.has(operation) });
      await audit({ ...auditRecord({ sessionId: auditSid, context, connection, operation, decision: policy.decision, reason: policy.reason ?? null }), __context: context });
      if (policy.decision !== "allow") return blocked(policy.reason, { operation });
      return decisionResult("allow", { project: context.project, environment: connection.environment ?? context.environment, provider: args.provider, operation, resource: connection.resource ?? connection.target, capability: `cap:${operation}`, note: "Capability is enforced server-side; no credential is returned." });
    }
    if (name === EXECUTE_TOOL || name === EXECUTE_TOOL_UNDERSCORE) {
      const provider = normalizeProvider(args.provider ?? "");
      const operation = String(args.operation ?? "");
      const opArgs = args.arguments && typeof args.arguments === "object" ? args.arguments : {};
      if (Object.keys(opArgs).some((key) => ["workspace_path", "project_ref", "project_id", "connection_id"].includes(key.toLowerCase()))) {
        return blocked("Calls cannot switch project or connection. Retry without the project or connection fields.");
      }
      if (provider === "github") {
        // Top-level and nested arguments.* scoped separately (no masking).
        const connection = approvedWithNested(approvedGitHub, context, args, opArgs);
        if (!connection) {
          const base = approvedGitHub(context);
          const crossTarget = base && (isCrossAccountTarget(base, args) || isCrossAccountTarget(base, opArgs) || isCrossAccount(args, base, context) || isCrossAccount(opArgs, base, context));
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection: base, operation, decision: "block", reason: crossTarget ? "cross-account target" : "no approved connection" }), __context: context });
          return blocked(crossTarget ? "That target does not belong to this project. Use the configured project connection, or ask the developer to add it." : "No approved GitHub connection belongs to this project. Reconnect GitHub in Connections, then retry.", { operation });
        }
        return executeGitHubOperation(context, connection, operation, opArgs, execOpts(args));
      }
      if (provider !== "supabase" && provider !== "github") {
        const tier = providerTier(provider, knownCurated);
        // Top-level and nested arguments.* scoped separately (no masking).
        const connection = approvedWithNested((c, r) => approvedCurated(c, provider, r), context, args, opArgs);
        if (!connection) {
          const base = approvedCurated(context, provider);
          const crossTarget = base && (isCrossAccountTarget(base, args) || isCrossAccountTarget(base, opArgs) || isCrossAccount(args, base, context) || isCrossAccount(opArgs, base, context));
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection: base, operation, decision: "block", reason: crossTarget ? "cross-account target" : "no approved connection" }), __context: context });
          return blocked(crossTarget ? "That target does not belong to this project. Use the configured project connection, or ask the developer to add it." : `No approved ${String(args.provider)} connection belongs to this project (${tier} tier defaults to approval). Ask the developer to connect it, then retry.`, { operation });
        }
        if (serviceMcpUrl(provider)) return executeRemoteOperation(context, connection, provider, operation, opArgs, { auditSessionId: auditSid });
        return executeCuratedOperation(context, connection, provider, operation, { auditSessionId: auditSid });
      }
      // Cross-account enforcement before provider: top-level account/target or nested
      // arguments account/target/resource must match, else block without contacting Supabase.
      // Checked separately so one cannot mask the other.
      const connection = approvedWithNested(approvedSupabase, context, args, opArgs);
      if (!connection) {
        const base = approvedSupabase(context);
        const crossTarget = base && (isCrossAccountTarget(base, args) || isCrossAccountTarget(base, opArgs) || isCrossAccount(args, base, context) || isCrossAccount(opArgs, base, context));
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection: base, operation, decision: "block", reason: crossTarget ? "cross-account target" : "no approved connection" }), __context: context });
        return blocked(crossTarget ? "That target does not belong to this project. Use the configured project connection, or ask the developer to add it." : "No approved Supabase connection belongs to this project. Reconnect Supabase in Connections, then retry.", { operation });
      }
      return executeSupabaseOperation(context, connection, operation, opArgs, execOpts(args));
    }
    if (name.startsWith(GITHUB_PROXY_PREFIX)) {
      const upstreamName = name.slice(GITHUB_PROXY_PREFIX.length);
      if (Object.keys(args).some((key) => ["workspace_path", "project_ref", "project_id", "connection_id"].includes(key.toLowerCase()))) {
        return blocked("Calls cannot switch project or connection. Retry without the project or connection fields.");
      }
      if (!approvedGitHub(context, args)) {
        const base = approvedGitHub(context);
        const crossTarget = base && (isCrossAccountTarget(base, args) || isCrossAccount(args, base, context));
        if (crossTarget) {
          await audit({ ...auditRecord({ sessionId: auditSid, context, connection: base, operation: name, decision: "block", reason: "cross-account target" }), __context: context });
          return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation: name });
        }
        return blocked("No approved GitHub connection belongs to this project. Reconnect GitHub in Connections, then retry.");
      }
      const connection = approvedGitHub(context, args);
      return executeGitHubOperation(context, connection, upstreamName, args, { auditSessionId: auditSid });
    }
    if (!name.startsWith(PROXY_PREFIX)) {
      // Generic curated alias: <provider>__<tool> resolves to approval_required when bound.
      const sep = name.indexOf("__");
      if (sep > 0) {
        const maybeProvider = normalizeProvider(name.slice(0, sep));
        const upstreamName = name.slice(sep + 2);
        if (maybeProvider && maybeProvider !== "supabase" && maybeProvider !== "github" && upstreamName) {
          const connection = approvedCurated(context, maybeProvider, args);
          if (connection && serviceMcpUrl(maybeProvider)) return executeRemoteOperation(context, connection, maybeProvider, upstreamName, args, { auditSessionId: auditSid });
          if (connection) return executeCuratedOperation(context, connection, maybeProvider, upstreamName, { auditSessionId: auditSid });
        }
      }
      return blocked("Unknown Nexus tool. Use nexus.context to list available tools, then retry.");
    }
    if (!approvedSupabase(context, args)) {
      const base = approvedSupabase(context);
      const crossTarget = base && (isCrossAccountTarget(base, args) || isCrossAccount(args, base, context));
      if (crossTarget) {
        await audit({ ...auditRecord({ sessionId: auditSid, context, connection: base, operation: name, decision: "block", reason: "cross-account target" }), __context: context });
        return blocked("That target does not belong to this project. Use the configured project connection, or ask the developer to add it.", { operation: name });
      }
      return blocked("No approved Supabase connection belongs to this project. Reconnect Supabase in Connections, then retry.");
    }
    const upstreamName = name.slice(PROXY_PREFIX.length);
    if (Object.keys(args).some((key) => ["workspace_path", "project_ref", "project_id", "connection_id"].includes(key.toLowerCase()))) {
      return blocked("Calls cannot switch project or connection. Retry without the project or connection fields.");
    }
    const connection = approvedSupabase(context, args);
    return executeSupabaseOperation(context, connection, upstreamName, args, { auditSessionId: auditSid });
  });

  // Expose the server-held session store for HTTP /session mint + tests.
  server.nexusSessionStore = store;
  server.nexusWorkspace = pinnedWorkspace;
  return server;
}

if (!globalThis.__NEXUS_BUNDLED && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!stdioGateAllows()) {
    console.error("Nexus stdio entrypoint is deprecated and disabled by default. Use the persistent HTTP instance (http://localhost:3939/mcp) or set NEXUS_ALLOW_STDIO=1 to allow stdio for one release.");
    process.exit(1);
  }
  console.error("Deprecation warning: Nexus stdio transport is deprecated and will be removed next release. Migrate to HTTP http://localhost:3939/mcp.");
  const server = makeNexusServer();
  await server.connect(new StdioServerTransport());
}

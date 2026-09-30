// Phase 2: single persistent local Nexus over HTTP (Streamable HTTP).
// Notion §6: one HTTP endpoint (POST /mcp) instead of one stdio process per agent.
// Express-less: plain node:http + MCP StreamableHTTPServerTransport (stateful).
// Workspace is per-request: X-Nexus-Workspace header > ?workspace= query.
// Notion §7/§8: a request that names no workspace fails closed — it never
// inherits the Nexus process's own cwd, which would silently hand every
// misconfigured agent whatever project Nexus happens to be running from.
// A caller may still pass an explicit `defaultWorkspace` (single-project
// mode, tests); that is an explicit choice, never an implicit bypass.
// Reuses readContext + makeNexusServer from ./nexus-server.mjs. Secret-free by construction.
//
// Session multiplexing: one makeNexusServer per connected agent (MCP) session,
// keyed by the MCP session id. The agent's Nexus audit session and its declared
// client name stay stable across that agent's requests — Home groups by session
// and shows the agent name because of this. Clients that never complete the
// initialize handshake (no session id) fall back to the old one-shot behavior:
// a fresh server per request, closed afterwards. No shared mutable current
// project exists between sessions, so parallel agents with different workspaces
// return their own project with no bleed.
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readContext, makeNexusServer, createSessionStore } from "./nexus-server.mjs";
import { readVaultState, vaultStatePath } from "./vault-state.mjs";

const MAX_BODY_BYTES = 1024 * 1024;

// Phase 2: single persistent HTTP instance defaults (paper: http://localhost:<port>/mcp).
// Unified localhost default + NEXUS_HTTP_PORT 3939. NEXUS_HTTP_HOST overrides.
export const DEFAULT_HTTP_PORT = Number(process.env.NEXUS_HTTP_PORT ?? 3939);
export const DEFAULT_HTTP_HOST = process.env.NEXUS_HTTP_HOST ?? "localhost";

/** Resolve the workspace for one request. Returns null when none is supplied
 *  and no explicit default was configured — the caller must then refuse. */
export function resolveWorkspace(req, url, defaultWorkspace = null) {
  const fallback = defaultWorkspace == null ? null : path.resolve(defaultWorkspace);
  const header = req.headers?.["x-nexus-workspace"];
  const firstHeader = Array.isArray(header) ? header[0] : header;
  const query = url?.searchParams?.get("workspace");
  const raw = firstHeader ?? query;
  const value = String(raw ?? "").trim();
  // Empty or oversize is treated as "not supplied", not as a reason to guess.
  if (!value || value.length > 1024) return fallback;
  return value;
}

export const MISSING_WORKSPACE_REASON =
  "Nexus does not know which project this request belongs to. Register Nexus in that project so the agent sends its workspace (X-Nexus-Workspace header or ?workspace=), then try again.";

export const MISSING_SESSION_REASON =
  "Missing Nexus session. Mint one via POST /session with your workspace, then retry with X-Nexus-Session header.";
export const INVALID_SESSION_REASON =
  "Nexus session is invalid or expired. Mint a new one via POST /session, then retry.";

function sendMissingWorkspace(res) {
  sendJson(res, 400, {
    ok: false,
    status: "unresolved",
    decision: "block",
    reason: MISSING_WORKSPACE_REASON,
    safety: "Connection identity only. No credentials are returned.",
  });
}

function sendSessionError(res, reason, extra = {}) {
  const status = extra.status ?? 401;
  const { status: _drop, ...rest } = extra;
  sendJson(res, status, { ok: false, decision: "block", reason, ...rest });
}

/** Extract the opaque Nexus session token: header > Authorization Bearer > query > body. */
export function nexusTokenFromRequest(req, url, body) {
  const header = req.headers?.["x-nexus-session"];
  const firstHeader = Array.isArray(header) ? header[0] : header;
  if (typeof firstHeader === "string" && firstHeader.trim()) return firstHeader.trim();
  const auth = req.headers?.authorization ?? req.headers?.["Authorization"];
  const firstAuth = Array.isArray(auth) ? auth[0] : auth;
  if (typeof firstAuth === "string") {
    const match = firstAuth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim()) return match[1].trim();
  }
  const query = url?.searchParams?.get("session") ?? url?.searchParams?.get("token");
  if (typeof query === "string" && query.trim()) return query.trim();
  if (body && typeof body === "object") {
    for (const key of ["session", "sessionToken", "session_token", "token"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    // JSON-RPC envelope: {params:{session}} or tools/call {params:{arguments:{session}}}.
    const params = body.params;
    if (params && typeof params === "object") {
      for (const key of ["session", "sessionToken", "session_token", "token"]) {
        const value = params[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      const toolArgs = params.arguments;
      if (toolArgs && typeof toolArgs === "object") {
        for (const key of ["session", "sessionToken", "session_token", "token"]) {
          const value = toolArgs[key];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
      }
    }
  }
  return null;
}

function sendJson(res, status, value) {
  const text = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function isJsonRpc(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    ("jsonrpc" in body || "method" in body || "id" in body)
  );
}

export function createNexusHttpServer({ defaultWorkspace = null, enforceVaultLock = false, vaultStateFile = vaultStatePath(), sessionStore = null, requireSession = false } = {}) {
  const pinnedDefault = defaultWorkspace == null ? null : path.resolve(defaultWorkspace);
  // Phase 2: server-held opaque session store (shared with MCP servers).
  const nexusSessions = sessionStore ?? createSessionStore();

  async function rejectWhenVaultLocked(req, res) {
    if (!enforceVaultLock || req.method === "DELETE") return false;
    const state = await readVaultState(vaultStateFile);
    if (!state.locked) return false;
    sendJson(res, 423, { ok: false, decision: "block", error: "Nexus vault is locked. Unlock Nexus Guard before using agent tools." });
    return true;
  }
  const mcpSessions = new Map();
  const MAX_MCP_SESSIONS = 50;

  function sessionIdOf(req) {
    const raw = req.headers?.["mcp-session-id"];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return typeof first === "string" && first ? first : undefined;
  }

  async function closeSession(id) {
    const known = mcpSessions.get(id);
    if (!known) return;
    mcpSessions.delete(id);
    await known.transport.close().catch(() => undefined);
    await known.mcpServer.close().catch(() => undefined);
  }

  function evictOldSessions() {
    if (mcpSessions.size <= MAX_MCP_SESSIONS) return;
    const ids = [...mcpSessions.keys()];
    for (const id of ids.slice(0, mcpSessions.size - MAX_MCP_SESSIONS)) {
      void closeSession(id);
    }
  }

  // Validate the opaque Nexus token for one HTTP request. Returns
  // { ok:true, record } or sends the error and returns { ok:false }.
  // Workspace-bound: a token minted for workspace A cannot read workspace B.
  function validateHttpSession(req, url, body, workspace, res) {
    const token = nexusTokenFromRequest(req, url, body);
    if (!token) {
      if (!requireSession) return { ok: true, record: null };
      sendSessionError(res, MISSING_SESSION_REASON);
      return { ok: false };
    }
    const record = nexusSessions.validateSession(token);
    if (!record) {
      sendSessionError(res, INVALID_SESSION_REASON, { revoked: true });
      return { ok: false };
    }
    if (workspace && record.workspace && path.resolve(workspace) !== path.resolve(record.workspace)) {
      sendSessionError(res, "That Nexus session does not belong to this project. Mint a session for this workspace via POST /session.", { status: 403 });
      return { ok: false };
    }
    return { ok: true, record };
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendJson(res, 400, { ok: false, error: "Bad request." });
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true, service: "nexus-http", transport: "streamable-http" });
        return;
      }

      // Phase 2: workspace-bound session mint + revoke.
      if (url.pathname === "/session") {
        if (req.method === "POST") {
          if (await rejectWhenVaultLocked(req, res)) return;
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, { ok: false, error: "Request body is not valid JSON." });
            return;
          }
          const workspace =
            body && typeof body === "object" && typeof body.workspace === "string" && body.workspace.trim()
              ? body.workspace.trim()
              : resolveWorkspace(req, url, pinnedDefault);
          if (workspace == null) {
            sendMissingWorkspace(res);
            return;
          }
          const minted = nexusSessions.createSession(workspace);
          sendJson(res, 200, { ok: true, token: minted.token, expiresAt: minted.expiresAt, workspace: minted.workspace });
          return;
        }
        if (req.method === "DELETE") {
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            body = undefined;
          }
          const token = nexusTokenFromRequest(req, url, body);
          if (!token) {
            sendJson(res, 400, { ok: false, error: "Missing Nexus session token." });
            return;
          }
          const revoked = nexusSessions.revokeSession(token);
          if (!revoked) {
            sendJson(res, 404, { ok: false, error: "Unknown Nexus session." });
            return;
          }
          sendJson(res, 200, { ok: true, revoked: true });
          return;
        }
        res.writeHead(405, { allow: "POST, DELETE" });
        res.end();
        return;
      }

      if (req.method === "GET" && (url.pathname === "/context" || url.pathname === "/nexus_context")) {
        const workspace = resolveWorkspace(req, url, pinnedDefault);
        if (workspace == null) {
          sendMissingWorkspace(res);
          return;
        }
        if (!validateHttpSession(req, url, undefined, workspace, res).ok) return;
        const context = await readContext(workspace);
        sendJson(res, 200, {
          safety: "Connection identity only. No credentials are returned.",
          ...context,
        });
        return;
      }

      if (url.pathname === "/mcp") {
        if (await rejectWhenVaultLocked(req, res)) return;
        if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
          res.writeHead(405, { allow: "GET, POST, DELETE" });
          res.end();
          return;
        }
        if (req.method === "GET" || req.method === "DELETE") {
          // SSE stream / session termination for stateful MCP clients.
          // Nexus token still re-validated every request when required.
          const id = sessionIdOf(req);
          const known = id ? mcpSessions.get(id) : undefined;
          if (!known) {
            sendJson(res, id ? 404 : 400, { ok: false, error: id ? "Unknown Nexus session." : "Missing Nexus session id." });
            return;
          }
          if (known.workspace && !validateHttpSession(req, url, undefined, known.workspace, res).ok) return;
          try {
            await known.transport.handleRequest(req, res);
          } catch {
            if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Nexus request failed." });
          }
          if (req.method === "DELETE") await closeSession(id);
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          sendJson(res, 400, { ok: false, error: "Request body is not valid JSON." });
          return;
        }
        // Plain-JSON fallback (non-JSON-RPC): reuse readContext, return nexus.context shape.
        if (!isJsonRpc(body)) {
          const plainWorkspace =
            body && typeof body === "object" && typeof body.workspace === "string" && body.workspace.trim()
              ? body.workspace.trim()
              : resolveWorkspace(req, url, pinnedDefault);
          if (plainWorkspace == null) {
            sendMissingWorkspace(res);
            return;
          }
          if (!validateHttpSession(req, url, body, plainWorkspace, res).ok) return;
          const context = await readContext(plainWorkspace);
          sendJson(res, 200, {
            safety: "Connection identity only. No credentials are returned.",
            ...context,
          });
          return;
        }
        // MCP Streamable HTTP path: stateful per-session servers, workspace from header/query.
        const incomingId = sessionIdOf(req);
        const known = incomingId ? mcpSessions.get(incomingId) : undefined;
        if (known) {
          // An established session is already pinned to its workspace; it does
          // not have to re-send the header on every request. Nexus token still
          // re-validated every request.
          if (!validateHttpSession(req, url, body, known.workspace, res).ok) return;
          try {
            await known.transport.handleRequest(req, res, body);
          } catch {
            if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Nexus request failed." });
          }
          return;
        }
        // A new server is about to be pinned, so the workspace must be known now.
        const workspace = resolveWorkspace(req, url, pinnedDefault);
        if (workspace == null) {
          sendMissingWorkspace(res);
          return;
        }
        if (!validateHttpSession(req, url, body, workspace, res).ok) return;
        const oneShot = incomingId == null && body?.method !== "initialize";
        const transport = new StreamableHTTPServerTransport(
          oneShot ? { sessionIdGenerator: undefined } : { sessionIdGenerator: () => randomUUID() },
        );
        const mcpServer = makeNexusServer({ workspace, sessionStore: nexusSessions });
        try {
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
        } catch {
          if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Nexus request failed." });
        } finally {
          const assigned = transport.sessionId;
          if (!oneShot && assigned) {
            // Handshake complete: keep this agent's server for its next requests.
            mcpSessions.set(assigned, { transport, mcpServer, workspace });
            evictOldSessions();
          } else {
            await transport.close().catch(() => undefined);
            await mcpServer.close().catch(() => undefined);
          }
        }
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found." });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Nexus request failed." });
    }
  });
  server.on("close", () => {
    for (const id of [...mcpSessions.keys()]) void closeSession(id);
  });
  server.nexusSessionStore = nexusSessions;
  return server;
}

export function startNexusHttpServer({ port = DEFAULT_HTTP_PORT, host = DEFAULT_HTTP_HOST, defaultWorkspace = null, enforceVaultLock = false, vaultStateFile = vaultStatePath(), sessionStore = null, requireSession = false } = {}) {
  const server = createNexusHttpServer({ defaultWorkspace, enforceVaultLock, vaultStateFile, sessionStore, requireSession });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : port });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.NEXUS_HTTP_PORT ?? 3939);
  const host = process.env.NEXUS_HTTP_HOST ?? "localhost";
  const { server, port: bound } = await startNexusHttpServer({ port, host, enforceVaultLock: true, requireSession: true });
  console.log(`nexus-http listening on http://${host}:${bound}/mcp`);
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

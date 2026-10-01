// Phase 2 spike tests: single persistent Nexus HTTP instance (does not touch stdio server).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createNexusHttpServer, ENTRY_OPTIONS } from "./nexus-http-server.mjs";

async function boot(t) {
  const server = createNexusHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("GET /healthz reports ok", async (t) => {
  const base = await boot(t);
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.transport, "streamable-http");
});

test("workspace without manifest resolves to unresolved (no provider calls)", async (t) => {
  const base = await boot(t);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-http-empty-"));
  t.after(() => fs.rm(empty, { recursive: true, force: true }));
  const res = await fetch(`${base}/context?workspace=${encodeURIComponent(empty)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "unresolved");
  assert.equal(typeof body.reason, "string");
});

test("workspace with temp manifest resolves to ready", async (t) => {
  const base = await boot(t);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-http-ready-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".nexus", "project.json"),
    JSON.stringify({
      project: "Spike",
      project_id: "spike",
      account: "spike-acct",
      connections: {
        supabase: { target: "spike-dev", resource: "spike-dev", environment: "development" },
      },
    }),
  );
  const res = await fetch(`${base}/context?workspace=${encodeURIComponent(dir)}`, {
    headers: { "X-Nexus-Workspace": dir },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ready");
  assert.equal(body.project, "Spike");
  assert.ok(Array.isArray(body.connections));
  assert.equal(body.connections[0]?.resource, "spike-dev");
  assert.ok(!JSON.stringify(body).toLowerCase().includes("token"));
});

test("Phase 2 sessions: POST /session mint (workspace-bound), validate on /context + /mcp, DELETE revoke", async (t) => {
  const { createNexusHttpServer: create } = await import("./nexus-http-server.mjs");
  const server = create({ requireSession: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-http-sess-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), JSON.stringify({
    project: "Sess", project_id: "sess", connections: { supabase: { target: "sess-dev", resource: "sess-dev", environment: "development" } },
  }));
  // No workspace -> 400 block (fail-closed).
  const noWs = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  assert.equal(noWs.status, 400);
  assert.equal((await noWs.json()).decision, "block");
  // Mint.
  const mint = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: dir }) });
  assert.equal(mint.status, 200);
  const { token, expiresAt, workspace } = await mint.json();
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.ok(expiresAt > Date.now());
  assert.equal(workspace, path.resolve(dir));
  // /context without token -> 401.
  const noTok = await fetch(`${base}/context?workspace=${encodeURIComponent(dir)}`);
  assert.equal(noTok.status, 401);
  // /context with token -> 200, no static session echo.
  const ctx = await fetch(`${base}/context?workspace=${encodeURIComponent(dir)}`, { headers: { "X-Nexus-Session": token } });
  assert.equal(ctx.status, 200);
  const ctxBody = await ctx.json();
  assert.equal(ctxBody.project, "Sess");
  assert.equal(ctxBody.session, undefined);
  // Cross-workspace token misuse -> 403.
  const other = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-http-other-"));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  const cross = await fetch(`${base}/context?workspace=${encodeURIComponent(other)}`, { headers: { "X-Nexus-Session": token } });
  assert.equal(cross.status, 403);
  // Plain /mcp with token works.
  const plain = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", "X-Nexus-Session": token }, body: JSON.stringify({ workspace: dir }) });
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).project, "Sess");
  // Revoke.
  const del = await fetch(`${base}/session`, { method: "DELETE", headers: { "X-Nexus-Session": token } });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).revoked, true);
  const after = await fetch(`${base}/context?workspace=${encodeURIComponent(dir)}`, { headers: { "X-Nexus-Session": token } });
  assert.equal(after.status, 401);
  assert.equal((await after.json()).revoked, true);
});

test("Phase 2 HTTP defaults: localhost + NEXUS_HTTP_PORT 3939 unified", async () => {
  const { DEFAULT_HTTP_PORT, DEFAULT_HTTP_HOST } = await import("./nexus-http-server.mjs");
  assert.equal(DEFAULT_HTTP_HOST, process.env.NEXUS_HTTP_HOST ?? "localhost");
  assert.equal(DEFAULT_HTTP_PORT, Number(process.env.NEXUS_HTTP_PORT ?? 3939));
});

test("standalone defaults accept an agent that sends only its workspace", async (t) => {
  assert.equal(ENTRY_OPTIONS.requireSession, false);
  assert.equal(ENTRY_OPTIONS.enforceVaultLock, true);
  const server = createNexusHttpServer({ ...ENTRY_OPTIONS, enforceVaultLock: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-entry-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const res = await fetch(`http://127.0.0.1:${port}/mcp?workspace=${encodeURIComponent(dir)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
  });
  assert.equal(res.status, 200);
  const context = await fetch(`http://127.0.0.1:${port}/context?workspace=${encodeURIComponent(dir)}`);
  assert.notEqual(context.status, 401);
});

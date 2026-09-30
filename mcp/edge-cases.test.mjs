// Edge-case coverage for Nexus MCP guard (does NOT edit mcp/*.mjs).
// Uses only existing exports: nexus-server.mjs, guard-policy.mjs, nexus-http-server.mjs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readContext, makeNexusServer, decideExecute, applyOverride } from "./nexus-server.mjs";
import { classify, decideGuard, resolveOverride, auditGuard } from "./guard-policy.mjs";
import { resolveWorkspace } from "./nexus-http-server.mjs";

const upstreamTools = [
  { name: "list_tables", description: "List tables", inputSchema: { type: "object", properties: {} } },
  { name: "apply_migration", description: "Apply migration", inputSchema: { type: "object", properties: {} } },
];

async function writeManifest(dir, manifest) {
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), JSON.stringify(manifest));
}

function validConn(pid = "koupa", extra = {}) {
  return {
    target: `${pid}-dev`, resource: `${pid}-dev`,
    project_ref: `${pid}ref`, connection_id: `${pid}-connection`,
    method: "mcp", status: "connected", ...extra,
  };
}

function validManifest(over = {}) {
  return {
    project: "Koupa", project_id: "koupa", environment: "development",
    account: "personal", accountId: "personal",
    connections: { supabase: validConn("koupa") }, ...over,
  };
}

async function freshDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-edge-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function session(t, workspace, log = [], extra = {}) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace,
    getToken: extra.getToken ?? (async (pid, cid) => {
      log.push({ kind: "credential", pid, cid });
      return "fake-token";
    }),
    connectProvider: extra.connectProvider ?? (async (connection, token) => {
      log.push({ kind: "connect", ref: connection.project_ref, token });
      return {
        listTools: async () => ({ tools: upstreamTools }),
        callTool: async ({ name, arguments: args }) => {
          log.push({ kind: "call", name, args, ref: connection.project_ref });
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, name }) }] };
        },
        close: async () => {},
      };
    }),
    refreshToken: extra.refreshToken,
    onAudit: extra.onAudit,
  });
  const client = new Client({ name: "edge", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

function body(r) { return JSON.parse(r.content[0].text); }

// 1. Malformed / missing manifest -> unresolved, no provider call.
test("edge: invalid JSON manifest is unresolved, no provider contact", async (t) => {
  const dir = await freshDir(t);
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), "{not-json");
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "unresolved");
  const log = [];
  const client = await session(t, dir, log);
  const res = await client.callTool({ name: "supabase__list_tables", arguments: {} });
  assert.equal(body(res).decision, "block");
  assert.equal(log.length, 0);
});

test("edge: missing project name is unresolved, no provider contact", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, { project_id: "koupa", connections: { supabase: validConn() } });
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "unresolved");
  assert.match(ctx.reason, /project name/i);
  const dir2 = await freshDir(t);
  await writeManifest(dir2, { project: "   ", project_id: "koupa", connections: {} });
  assert.equal((await readContext(dir2)).status, "unresolved");
  const log = [];
  const client = await session(t, dir, log);
  const res = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(body(res).decision, "block");
  assert.equal(log.length, 0);
});

test("edge: connections not an object is unresolved", async (t) => {
  for (const bad of [["x"], "supabase", 42]) {
    const dir = await freshDir(t);
    await writeManifest(dir, { project: "Koupa", project_id: "koupa", connections: bad });
    const ctx = await readContext(dir);
    assert.equal(ctx.status, "unresolved");
    assert.match(ctx.reason, /connections/i);
  }
});

test("edge: missing manifest file is unresolved, no discovery", async (t) => {
  const dir = await freshDir(t);
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "unresolved");
  const log = [];
  const client = await session(t, dir, log);
  const names = (await client.listTools()).tools.map((x) => x.name);
  assert.ok(!names.some((n) => n.startsWith("supabase__")));
  assert.equal(log.length, 0);
});

// 2. Duplicate provider entries -> blocked.
test("edge: duplicate supabase entries (case variants) block without provider call", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, {
    project: "Koupa", project_id: "koupa",
    connections: { supabase: validConn("koupa"), Supabase: validConn("koupa") },
  });
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "ready");
  assert.equal(ctx.connections.filter((c) => c.provider.toLowerCase() === "supabase").length, 2);
  const log = [];
  const client = await session(t, dir, log);
  const names = (await client.listTools()).tools.map((x) => x.name);
  assert.ok(!names.some((n) => n.startsWith("supabase__")));
  const res = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(body(res).decision, "block");
  assert.equal(log.length, 0);
  const alias = await client.callTool({ name: "supabase__list_tables", arguments: {} });
  assert.equal(body(alias).decision, "block");
  assert.equal(log.length, 0);
});

// 3. Workspace-switch args rejected on nexus_execute + supabase__ alias.
test("edge: workspace-switch keys rejected (case variants) on nexus_execute", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const log = [];
  const client = await session(t, dir, log);
  const keys = ["workspace_path", "project_ref", "project_id", "connection_id",
    "WORKSPACE_PATH", "Project_Ref", "PROJECT_ID", "Connection_ID", "Workspace_Path"];
  for (const k of keys) {
    const res = await client.callTool({
      name: "nexus_execute",
      arguments: { provider: "supabase", operation: "list_tables", arguments: { [k]: "evil" } },
    });
    assert.equal(res.isError, true, `expected block for ${k}`);
    assert.equal(body(res).decision, "block", `expected block for ${k}`);
    assert.match(body(res).reason, /different project|connection/i);
  }
  assert.equal(log.filter((x) => x.kind === "call").length, 0);
  assert.equal(log.filter((x) => x.kind === "connect").length, 0);
});

test("edge: workspace-switch keys rejected (case variants) on supabase__ alias", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const log = [];
  const client = await session(t, dir, log);
  const keys = ["workspace_path", "project_ref", "project_id", "connection_id",
    "WORKSPACE_PATH", "PROJECT_REF", "Project_Id", "CONNECTION_ID"];
  for (const k of keys) {
    const res = await client.callTool({ name: "supabase__list_tables", arguments: { [k]: "evil" } });
    assert.equal(res.isError, true, `expected block for ${k}`);
    assert.equal(body(res).decision, "block", `expected block for ${k}`);
  }
  assert.equal(log.filter((x) => x.kind === "call").length, 0);
});

// 4. Cross-account + cross-resource blocks before provider (REQUEST + EXECUTE).
test("edge: REQUEST cross-account and cross-resource block before provider", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const log = [];
  const client = await session(t, dir, log);
  const cases = [
    { provider: "supabase", operation: "list_tables", account: "other" },
    { provider: "supabase", operation: "list_tables", accountId: "other" },
    { provider: "supabase", operation: "list_tables", target: "other-dev" },
    { provider: "supabase", operation: "list_tables", resource: "other-dev" },
  ];
  for (const args of cases) {
    const res = await client.callTool({ name: "nexus_request_access", arguments: args });
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.equal(body(res).decision, "block", JSON.stringify(args));
  }
  assert.equal(log.length, 0);
  const ok = body(await client.callTool({ name: "nexus_request_access", arguments: { provider: "supabase", operation: "list_tables" } }));
  assert.equal(ok.decision, "allow");
});

test("edge: EXECUTE cross-account and cross-resource block before provider", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const log = [];
  const client = await session(t, dir, log);
  const cases = [
    { account: "other" }, { accountId: "other" }, { account_id: "other" },
    { target: "other-dev" }, { resource: "other-dev" },
  ];
  for (const nested of cases) {
    const res = await client.callTool({
      name: "nexus_execute",
      arguments: { provider: "supabase", operation: "list_tables", arguments: nested },
    });
    assert.equal(res.isError, true, JSON.stringify(nested));
    assert.equal(body(res).decision, "block", JSON.stringify(nested));
  }
  assert.equal(log.filter((x) => x.kind === "call").length, 0);
  assert.equal(log.filter((x) => x.kind === "connect").length, 0);
});

// 5. Guard tiers via decideExecute (+ live unknown-op approval).
// Phase 1 (Guard hide, MVP): costBearing/escapeHatch are DEFERRED-PAID and
// ignored in routing (allow stays allow). Routing enforcement only.
test("edge: unmapped op needs approval; read allows; prod write blocks; cost/escape ignored when Guard off", async (t) => {
  assert.equal(classify("some_future_tool_xyz"), null);
  assert.equal(decideExecute({ operation: "some_future_tool_xyz", env: "development" }).decision, "approval_required");
  assert.equal(decideExecute({ operation: "list_tables", env: "development" }).decision, "allow");
  assert.equal(decideExecute({ operation: "list_tables", env: "production" }).decision, "allow");
  assert.equal(decideExecute({ operation: "apply_migration", env: "production" }).decision, "block");
  assert.equal(decideExecute({ operation: "create_branch", env: "production" }).decision, "block");
  // Guard off: cost/escape ignored (routing only).
  const cost = decideExecute({ operation: "list_tables", env: "development", costBearing: true });
  assert.equal(cost.decision, "allow");
  const escMissing = decideExecute({ operation: "list_tables", env: "development", escapeHatch: true });
  assert.equal(escMissing.decision, "allow");
  // Live: unknown op via EXECUTE returns approval_required without provider call.
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const log = [];
  const client = await session(t, dir, log);
  const res = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "some_future_tool_xyz", arguments: {} },
  });
  assert.equal(body(res).decision, "approval_required");
  assert.equal(log.filter((x) => x.kind === "call").length, 0);
  // Live: cost-bearing flag ignored when Guard off (still allows, forwards).
  const costLive = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", arguments: {}, costBearing: true },
  });
  assert.equal(body(costLive).decision !== "approval_required", true);
});

test("edge: decideGuard parity for prod write and escape", () => {
  assert.equal(decideGuard({ vocab: "write", env: "production", operation: "x" }).decision, "block");
  assert.equal(decideGuard({ vocab: "destructive", env: "production", operation: "x" }).decision, "block");
  assert.equal(decideGuard({ vocab: "read", env: "development", operation: "list_tables" }).decision, "allow");
});

// 6. Overrides (DEFERRED-PAID: Guard OUT of MVP — applyOverride is identity
// when GUARD_ENABLED off; resolveOverride unit behavior kept in guard-policy).
test("edge: overrides ignored when Guard off (routing only); resolveOverride kept for paid tier", () => {
  const s = resolveOverride({ serviceOverride: "always-block", tagOverride: "auto-approve", default: "auto-approve" });
  assert.equal(s.override, "always-block");
  assert.equal(s.source, "service");
  const tag = resolveOverride({ tagOverride: "auto-approve", default: "always-block" });
  assert.equal(tag.override, "auto-approve");
  assert.equal(tag.source, "tag");
  const def = resolveOverride({ default: "always-block" });
  assert.equal(def.override, "always-block");
  assert.equal(def.source, "default");
  assert.equal(s.disconnect, false);
  assert.equal(tag.audited, true);
  // applyOverride ignored when Guard off: guard result stands unchanged.
  const kept = applyOverride({ decision: "block", vocab: "write", reason: "base" }, { serviceOverride: "auto-approve" }, {});
  assert.equal(kept.decision, "block");
  assert.equal(kept.override, undefined);
  const allowed = applyOverride({ decision: "allow", vocab: "read", reason: "ok" }, { serviceOverride: "always-block" }, {});
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.override, undefined);
});

// 7. Fingerprint: account / target / branch change mid-session.
test("edge: mid-session account change forces re-verification", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const client = await session(t, dir);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  await writeManifest(dir, validManifest({ account: "other", accountId: "other" }));
  const after = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(after.decision, "block");
  assert.match(after.reason, /changed during this session/);
  const blocked = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(blocked.isError, true);
});

test("edge: mid-session target change forces re-verification", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const client = await session(t, dir);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  const mutated = validManifest();
  mutated.connections.supabase.target = "koupa-other";
  mutated.connections.supabase.resource = "koupa-other";
  await writeManifest(dir, mutated);
  const after = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(after.decision, "block");
  assert.match(after.reason, /changed during this session/);
});

test("edge: mid-session declared branch change forces re-verification", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, { ...validManifest(), branch: "main" });
  const client = await session(t, dir);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  await writeManifest(dir, { ...validManifest(), branch: "feature" });
  const after = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(after.decision, "block");
  assert.match(after.reason, /changed during this session/);
});

// 8. Audit secret-free.
test("edge: audit records never contain token/secret/password", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, validManifest());
  const audits = [];
  const SECRET = "sk-edge-secret-999";
  const PWD = "edge-password-999";
  const log = [];
  const client = await session(t, dir, log, { onAudit: (e) => audits.push(e) });
  await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", arguments: { token: SECRET, secret: SECRET, password: PWD, q: "select 1" } },
  });
  await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "apply_migration", arguments: { secret: SECRET } },
  });
  await client.callTool({
    name: "nexus_request_access",
    arguments: { provider: "supabase", operation: "list_tables", target: "nope-dev" },
  });
  assert.ok(audits.length >= 3);
  const dumped = JSON.stringify(audits);
  assert.ok(!dumped.includes(SECRET), "secret leaked into audit");
  assert.ok(!dumped.includes(PWD), "password leaked into audit");
  assert.ok(!dumped.toLowerCase().includes("fake-token"), "token leaked into audit");
  for (const a of audits) {
    assert.ok(!("token" in a) && !("accessToken" in a) && !("secret" in a) && !("password" in a) && !("arguments" in a));
  }
  // auditGuard helper is also secret-free by construction.
  const g = auditGuard({ operation: "list_tables", vocab: "read", env: "development", decision: "allow", reason: "ok", token: SECRET, secret: SECRET, password: PWD, arguments: { x: 1 } });
  assert.ok(!JSON.stringify(g).includes(SECRET));
  assert.ok(!("token" in g) && !("arguments" in g));
});

// resolveWorkspace (nexus-http-server.mjs) unit coverage.
test("edge: resolveWorkspace prefers header, then query, then explicit default; rejects empty/oversize", () => {
  const def = "/tmp/def-ws";
  assert.equal(resolveWorkspace({ headers: { "x-nexus-workspace": "/tmp/a" } }, new URL("http://x/?workspace=/tmp/b"), def), "/tmp/a");
  assert.equal(resolveWorkspace({ headers: {} }, new URL("http://x/?workspace=/tmp/b"), def), "/tmp/b");
  assert.equal(resolveWorkspace({ headers: {} }, new URL("http://x/"), def), path.resolve(def));
  assert.equal(resolveWorkspace({ headers: { "x-nexus-workspace": "   " } }, new URL("http://x/"), def), path.resolve(def));
  assert.equal(resolveWorkspace({ headers: { "x-nexus-workspace": "x".repeat(2000) } }, new URL("http://x/"), def), path.resolve(def));
});

// Fail-closed: with no explicit default, an unnamed workspace resolves to null
// rather than the Nexus process's own cwd (Notion §7 signal ranking, §8).
test("edge: resolveWorkspace returns null when nothing is supplied and no default is set", () => {
  assert.equal(resolveWorkspace({ headers: {} }, new URL("http://x/")), null);
  assert.equal(resolveWorkspace({ headers: { "x-nexus-workspace": "   " } }, new URL("http://x/")), null);
  assert.equal(resolveWorkspace({ headers: { "x-nexus-workspace": "x".repeat(2000) } }, new URL("http://x/")), null);
  assert.equal(resolveWorkspace({ headers: {} }, new URL("http://x/?workspace=")), null);
  // Never falls through to cwd.
  assert.notEqual(resolveWorkspace({ headers: {} }, new URL("http://x/")), process.cwd());
  // A supplied value still wins.
  assert.equal(resolveWorkspace({ headers: { "x-nexus-workspace": "/tmp/a" } }, new URL("http://x/")), "/tmp/a");
});

test("edge: per-connection account_id alias enforced; top-level account_id fallback", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, {
    project: "Koupa", project_id: "koupa", environment: "development", account_id: "top-acct",
    connections: { supabase: { ...validConn("koupa"), account_id: "conn-acct" } },
  });
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "ready");
  assert.equal(ctx.connections[0].account, "conn-acct");
  assert.equal(ctx.connections[0].accountId, "conn-acct");
  const log = [];
  const client = await session(t, dir, log);
  // Configured account is conn-acct: top-acct (stale top-level) must block.
  const stale = await client.callTool({
    name: "nexus_request_access",
    arguments: { provider: "supabase", operation: "list_tables", account_id: "top-acct" },
  });
  assert.equal(body(stale).decision, "block");
  const ok = body(await client.callTool({
    name: "nexus_request_access",
    arguments: { provider: "supabase", operation: "list_tables", account_id: "conn-acct" },
  }));
  assert.equal(ok.decision, "allow");
  assert.equal(log.length, 0);
});

test("edge: duplicate github entries block without provider call", async (t) => {
  const dir = await freshDir(t);
  const gh = (extra = {}) => ({
    target: "org/repo", resource: "org/repo", account: "personal",
    connection_id: "gh-conn", status: "connected", ...extra,
  });
  await writeManifest(dir, {
    project: "Koupa", project_id: "koupa",
    connections: { github: gh(), GitHub: gh() },
  });
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "ready");
  const log = [];
  const client = await session(t, dir, log, {
    connectProvider: async () => { throw new Error("must not connect"); },
  });
  const res = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "github", operation: "search_repositories", arguments: {} },
  });
  assert.equal(body(res).decision, "block");
  assert.equal(log.length, 0);
});

test("edge: curated passthrough stays approval_required, never forwards (documented fail-closed)", async (t) => {
  const dir = await freshDir(t);
  await writeManifest(dir, {
    project: "Koupa", project_id: "koupa", environment: "development",
    connections: {
      supabase: validConn("koupa"),
      resend: { target: "resend-acct", resource: "resend-acct", account: "personal", status: "connected" },
    },
  });
  const log = [];
  const client = await session(t, dir, log);
  const res = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "resend", operation: "list_emails", arguments: {} },
  });
  assert.equal(body(res).decision, "approval_required");
  assert.equal(log.filter((x) => x.kind === "call").length, 0);
  // Cross-account curated request also blocks (not approval).
  const cross = await client.callTool({
    name: "nexus_request_access",
    arguments: { provider: "resend", operation: "list_emails", account: "other" },
  });
  assert.equal(body(cross).decision, "block");
});

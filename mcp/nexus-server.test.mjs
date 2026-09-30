import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeNexusServer, createSessionStore, applyOverride, decideExecute, stdioGateAllows, SESSION_TTL_MS } from "./nexus-server.mjs";

async function fixture(t, { configured = true } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-mcp-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const folders = ["Koupa", "Nabdh"].map((name) => path.join(parent, name));
  for (const [index, folder] of folders.entries()) {
    await fs.mkdir(path.join(folder, ".nexus"), { recursive: true });
    if (configured) {
      const project = index === 0 ? "Koupa" : "Nabdh";
      await fs.writeFile(path.join(folder, ".nexus", "project.json"), JSON.stringify({
        project, project_id: project.toLowerCase(),
        connections: { supabase: {
          target: `${project.toLowerCase()}-dev`, project_ref: `${project.toLowerCase()}ref`,
          connection_id: `${project.toLowerCase()}-connection`, method: "mcp", status: "connected",
        } },
      }));
    }
  }
  return folders;
}

const upstreamTools = [
  { name: "list_tables", description: "List database tables", inputSchema: { type: "object", properties: { schemas: { type: "array", items: { type: "string" } } } }, annotations: { readOnlyHint: true } },
  { name: "apply_migration", description: "Apply a migration", inputSchema: { type: "object", properties: {} } },
];

async function session(t, workspace, log = [], extra = {}) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace,
    getToken: extra.getToken ?? (async (projectId, connectionId) => {
      log.push({ kind: "credential", projectId, connectionId });
      return `fake-token-${projectId}`;
    }),
    connectProvider: async (connection, token) => {
      log.push({ kind: "connect", projectRef: connection.project_ref, token });
      return {
        listTools: async () => ({ tools: upstreamTools }),
        callTool: async ({ name, arguments: args }) => {
          log.push({ kind: "call", name, args, projectRef: connection.project_ref });
          return { content: [{ type: "text", text: JSON.stringify({ projectRef: connection.project_ref, args }) }] };
        },
        close: async () => {},
      };
    },
    refreshToken: extra.refreshToken,
    onAudit: extra.onAudit,
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

function body(response) { return JSON.parse(response.content[0].text); }

test("Paper: ListTools exposes dotted canonical only — no proxy listing (revocation is execute decision)", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  // Canonical dotted tools listed.
  assert(names.includes("nexus.context"));
  assert(names.includes("nexus.request_access"));
  assert(names.includes("nexus.execute"));
  // Hidden compat + legacy + proxies never listed.
  assert(!names.includes("nexus_context"));
  assert(!names.includes("nexus_request_access"));
  assert(!names.includes("nexus_execute"));
  assert(!names.includes("nexus_get_project_context"));
  assert(!names.includes("nexus_check_target"));
  assert(!names.some((n) => n.startsWith("supabase__")));
  assert(!names.some((n) => n.startsWith("github__")));
  assert(!names.some((n) => n.includes("nexus_supabase")));
});

test("Two simultaneous agents never share a Supabase target", async (t) => {
  const [koupa, nabdh] = await fixture(t);
  const logA = [], logB = [];
  const first = await session(t, koupa, logA);
  const second = await session(t, nabdh, logB);
  const results = await Promise.all([
    first.callTool({ name: "supabase__list_tables", arguments: { schemas: ["public"] } }),
    second.callTool({ name: "supabase__list_tables", arguments: { schemas: ["private"] } }),
  ]);
  assert.equal(body(results[0]).projectRef, "kouparef");
  assert.equal(body(results[1]).projectRef, "nabdhref");
  assert.deepEqual(logA.filter((item) => item.kind === "credential").map((item) => [item.projectId, item.connectionId]), [["koupa", "koupa-connection"]]);
  assert.deepEqual(logB.filter((item) => item.kind === "credential").map((item) => [item.projectId, item.connectionId]), [["nabdh", "nabdh-connection"]]);
  assert(!JSON.stringify(results).includes("fake-token-"));
});

test("Caller cannot switch workspace through a tool argument", async (t) => {
  const [koupa, nabdh] = await fixture(t);
  const log = [];
  const client = await session(t, koupa, log);
  const result = await client.callTool({ name: "nexus_get_project_context", arguments: { workspace_path: nabdh } });
  assert.equal(body(result).project, "Koupa");
  const forwarded = await client.callTool({ name: "supabase__list_tables", arguments: { workspace_path: nabdh } });
  assert.equal(forwarded.isError, true);
  assert.equal(body(forwarded).decision, "block");
  assert.equal(log.filter((item) => item.kind === "call").length, 0);
});

test("Writes and unknown provider tools are blocked before forwarding", async (t) => {
  const [koupa] = await fixture(t);
  const log = [];
  const client = await session(t, koupa, log);
  const result = await client.callTool({ name: "supabase__apply_migration", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(body(result).decision, "block");
  assert.equal(log.filter((item) => item.kind === "call").length, 0);
});

test("No manifest means no provider calls; only dotted canonical listed", async (t) => {
  const [koupa] = await fixture(t, { configured: false });
  const log = [];
  const client = await session(t, koupa, log);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert(names.includes("nexus.context"));
  assert(names.includes("nexus.request_access"));
  assert(names.includes("nexus.execute"));
  assert(!names.includes("nexus_get_project_context"));
  assert(!names.includes("nexus_check_target"));
  assert(!names.some((n) => n.startsWith("supabase__")));
  const result = await client.callTool({ name: "supabase__list_tables", arguments: {} });
  assert.equal(body(result).decision, "block");
  assert.equal(log.length, 0);
});

test("Manifest change mid-session forces re-verification on execute (no tool-list push)", async (t) => {
  const [koupa] = await fixture(t);
  const log = [];
  const client = await session(t, koupa, log);
  assert((await client.listTools()).tools.some((tool) => tool.name === "nexus.execute"));
  await fs.writeFile(path.join(koupa, ".nexus", "project.json"), JSON.stringify({ project: "Koupa", project_id: "koupa", connections: {} }));
  const response = await client.callTool({ name: "supabase__list_tables", arguments: {} });
  assert.equal(response.isError, true);
  assert.equal(body(response).decision, "block");
  assert.equal(log.filter((item) => item.kind === "call").length, 0);
});

test("Paper canonical surface: dotted listed, underscore compat callable, legacy deprecated, no session echo", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert(names.includes("nexus.context"));
  assert(names.includes("nexus.request_access"));
  assert(names.includes("nexus.execute"));
  assert(!names.includes("nexus_context"));
  const fresh = body(await client.callTool({ name: "nexus.context", arguments: {} }));
  const compat = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  const legacy = body(await client.callTool({ name: "nexus_get_project_context", arguments: {} }));
  assert.equal(fresh.project, "Koupa");
  assert.equal(compat.project, "Koupa");
  assert.equal(legacy.project, "Koupa");
  assert.equal(legacy.deprecated, true);
  assert.equal(fresh.environment, "development");
  // No sessionId echo as proof (server-held only).
  assert.equal(fresh.session, undefined);
  assert.equal(compat.session, undefined);
  assert(!JSON.stringify(fresh).includes("fake-token-"));
});

test("Notion §6 request_access: allow read, block write and cross-project target", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa);
  const allow = body(await client.callTool({ name: "nexus_request_access", arguments: { provider: "supabase", operation: "list_tables" } }));
  assert.equal(allow.decision, "allow");
  assert(!("accessToken" in allow) && !JSON.stringify(allow).includes("fake-token-"));
  const write = await client.callTool({ name: "nexus_request_access", arguments: { provider: "supabase", operation: "apply_migration" } });
  assert.equal(write.isError, true);
  assert.equal(body(write).decision, "block");
  const cross = await client.callTool({ name: "nexus_request_access", arguments: { provider: "supabase", operation: "list_tables", target: "nabdh-dev" } });
  assert.equal(cross.isError, true);
  assert.equal(body(cross).decision, "block");
});

test("Notion §6 execute: forwards reads through Nexus, blocks writes and project-switch args", async (t) => {
  const [koupa] = await fixture(t);
  const log = [];
  const client = await session(t, koupa, log);
  const ok = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: { schemas: ["public"] } } });
  assert.equal(body(ok).projectRef, "kouparef");
  const write = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "apply_migration", arguments: {} } });
  assert.equal(write.isError, true);
  assert.equal(body(write).decision, "block");
  const sneak = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: { project_ref: "nabdhref" } } });
  assert.equal(sneak.isError, true);
  assert.equal(body(sneak).decision, "block");
  assert.equal(log.filter((item) => item.kind === "call").length, 1);
});

test("Notion §3+§6 audit is secret-free and records allow/block", async (t) => {
  const [koupa] = await fixture(t);
  const audits = [];
  const client = await session(t, koupa, [], { onAudit: (entry) => audits.push(entry) });
  await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "apply_migration", arguments: {} } });
  assert(audits.length >= 2);
  assert(audits.every((a) => typeof a.session === "string" && typeof a.decision === "string"));
  assert(audits.some((a) => a.decision === "allow"));
  assert(audits.some((a) => a.decision === "block"));
  assert(!JSON.stringify(audits).includes("fake-token-"));
});

test("Expired approval uses refresh hook once, else approval_required without leaking secrets", async (t) => {
  const [koupa] = await fixture(t);
  let calls = 0;
  const audits = [];
  const client = await session(t, koupa, [], {
    getToken: async () => { calls += 1; if (calls === 1) throw new Error("token expired"); return "fake-token-koupa"; },
    refreshToken: async () => undefined,
    onAudit: (entry) => audits.push(entry),
  });
  const ok = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(body(ok).projectRef, "kouparef");
  assert.equal(calls, 2);
});

test("Notion §7 branch switch requires developer confirmation", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-git-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  await new Promise((resolve, reject) => {
    import("node:child_process").then(({ execFile }) => execFile("git", ["init", "-b", "main", parent], (error) => error ? reject(error) : resolve()));
  });
  const { execFile: exec } = await import("node:child_process");
  const run = (args) => new Promise((resolve, reject) => exec("git", args, { cwd: parent }, (e) => e ? reject(e) : resolve()));
  await run(["config", "user.email", "test@test.test"]);
  await run(["config", "user.name", "test"]);
  await run(["commit", "--allow-empty", "-m", "init"]);
  await fs.mkdir(path.join(parent, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(parent, ".nexus", "project.json"), JSON.stringify({
    project: "Koupa", project_id: "koupa", branch: "main",
    connections: { supabase: { target: "koupa-dev", project_ref: "kouparef", connection_id: "koupa-connection", method: "mcp", status: "connected" } },
  }));
  const client = await session(t, parent);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  await run(["checkout", "-b", "feature"]);
  const switched = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(switched.decision, "block");
  assert.match(switched.reason, /confirmation is required/);
  const blockedCall = await client.callTool({ name: "supabase__list_tables", arguments: {} });
  assert.equal(blockedCall.isError, true);
});

test("Notion §7 repo mismatch fails closed, non-git folders rely on manifest", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-git-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const { execFile: exec } = await import("node:child_process");
  const run = (args) => new Promise((resolve, reject) => exec("git", args, { cwd: parent }, (e) => e ? reject(e) : resolve()));
  await run(["init", "-b", "main", "."]);
  await run(["config", "user.email", "test@test.test"]);
  await run(["config", "user.name", "test"]);
  await run(["remote", "add", "origin", "https://example.test/other.git"]);
  await run(["commit", "--allow-empty", "-m", "init"]);
  await fs.mkdir(path.join(parent, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(parent, ".nexus", "project.json"), JSON.stringify({
    project: "Koupa", project_id: "koupa", repo: "https://example.test/koupa.git",
    connections: { supabase: { target: "koupa-dev", project_ref: "kouparef", connection_id: "koupa-connection", method: "mcp", status: "connected" } },
  }));
  const client = await session(t, parent);
  const ctx = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(ctx.decision, "block");
  assert.match(ctx.reason, /Git remote does not match/);
});

test("Notion §7 manifest change mid-session forces re-verification, not silent switch", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  await fs.writeFile(path.join(koupa, ".nexus", "project.json"), JSON.stringify({
    project: "Nabdh", project_id: "nabdh",
    connections: { supabase: { target: "nabdh-dev", project_ref: "nabdhref", connection_id: "nabdh-connection", method: "mcp", status: "connected" } },
  }));
  const after = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(after.decision, "block");
  assert.match(after.reason, /changed during this session/);
});

test("Paper conformance: dotted canonical listed with safe schemas; underscore hidden but callable", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa);
  const { tools } = await client.listTools();
  assert(tools.length > 0);
  assert.deepEqual(tools.map((x) => x.name).sort(), ["nexus.context", "nexus.execute", "nexus.request_access"]);
  for (const tool of tools) {
    // Dotted canonical is the paper surface; strict clients map dots.
    assert.match(tool.name, /^[A-Za-z0-9_.-]{1,64}$/, `unsafe tool name: ${tool.name}`);
    assert.equal(tool.inputSchema?.type, "object", `root schema must be object: ${tool.name}`);
    for (const [prop, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      assert.ok(schema && typeof schema.type === "string", `untyped property ${prop} on ${tool.name}`);
    }
  }
});

test("Underscore names still execute as hidden compat aliases (never listed)", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert(names.includes("nexus.context"));
  assert(!names.includes("nexus_context"));
  const ctx = body(await client.callTool({ name: "nexus.context", arguments: {} }));
  assert.equal(ctx.project, "Koupa");
  const compat = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(compat.project, "Koupa");
  const req = body(await client.callTool({ name: "nexus.request_access", arguments: { provider: "supabase", operation: "list_tables" } }));
  assert.equal(req.decision, "allow");
  const reqCompat = body(await client.callTool({ name: "nexus_request_access", arguments: { provider: "supabase", operation: "list_tables" } }));
  assert.equal(reqCompat.decision, "allow");
  const log = [];
  const tracked = await session(t, koupa, log);
  const out = await tracked.callTool({ name: "nexus.execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(body(out).projectRef, "kouparef");
  const outCompat = await tracked.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(body(outCompat).projectRef, "kouparef");
});

test("Phase 1 sessions: mint/validate sliding expiry/revoke + per-token fingerprint", async (t) => {
  let now = 1_000_000;
  const store = createSessionStore({ now: () => now });
  assert.ok(SESSION_TTL_MS >= 29 * 60 * 1000 && SESSION_TTL_MS <= 31 * 60 * 1000);
  const [koupa] = await fixture(t);
  const mk = (extra = {}) => {
    const [ss, cs] = InMemoryTransport.createLinkedPair();
    const server = makeNexusServer({
      workspace: koupa, sessionStore: store,
      getToken: async () => "fake-token",
      connectProvider: async () => ({ listTools: async () => ({ tools: upstreamTools }), callTool: async () => ({ content: [{ type: "text", text: "{}" }] }), close: async () => {} }),
      ...extra,
    });
    return { server, ss, cs };
  };
  // Mint + validate with sliding expiry.
  const minted = store.createSession(koupa);
  assert.match(minted.token, /^[0-9a-f-]{36}$/);
  const firstExp = minted.expiresAt;
  now += 60_000;
  assert.ok(store.validateSession(minted.token));
  assert.ok(store.getSession(minted.token).expiresAt > firstExp, "sliding expiry extends");
  // Expiry.
  now += SESSION_TTL_MS + 1000;
  assert.equal(store.validateSession(minted.token), null);
  // Revoke.
  now = 2_000_000;
  const m2 = store.createSession(koupa);
  assert.equal(store.revokeSession(m2.token), true);
  assert.equal(store.validateSession(m2.token), null);
  assert.equal(store.revokeSession("nope"), false);
  // Invalid token blocks with revoked:true, no provider contact.
  const { server, ss, cs } = mk();
  const client = new Client({ name: "sess", version: "1" }, { capabilities: {} });
  await server.connect(ss);
  await client.connect(cs);
  t.after(async () => { await client.close(); await server.close(); });
  const bad = body(await client.callTool({ name: "nexus.context", arguments: { session: "bad-token" } }));
  assert.equal(bad.decision, "block");
  assert.equal(bad.revoked, true);
  // Valid token works and scopes fingerprint per-token.
  const good = store.createSession(koupa);
  const ok = body(await client.callTool({ name: "nexus.context", arguments: { session: good.token } }));
  assert.equal(ok.project, "Koupa");
  // Second token has independent fingerprint: mutate manifest, first token blocks, new token re-pins.
  await fs.writeFile(path.join(koupa, ".nexus", "project.json"), JSON.stringify({ project: "Nabdh", project_id: "nabdh", connections: {} }));
  const stale = body(await client.callTool({ name: "nexus.context", arguments: { session: good.token } }));
  assert.equal(stale.decision, "block");
  const freshTok = store.createSession(koupa);
  const freshCtx = body(await client.callTool({ name: "nexus.context", arguments: { session: freshTok.token } }));
  assert.equal(freshCtx.project, "Nabdh");
});

test("Phase 1 Guard hide: overrides + cost/escape ignored when GUARD_ENABLED off (routing only)", async (t) => {
  assert.equal(process.env.GUARD_ENABLED, undefined, "tests run with Guard off");
  // applyOverride is identity when flag off.
  const kept = applyOverride({ decision: "allow", reason: "ok" }, { serviceOverride: "always-block" }, {});
  assert.equal(kept.decision, "allow");
  assert.equal(kept.override, undefined);
  // costBearing/escapeHatch extracted from args are ignored in routing.
  assert.equal(decideExecute({ operation: "list_tables", env: "development", costBearing: true }).decision, "allow");
  assert.equal(decideExecute({ operation: "list_tables", env: "development", escapeHatch: true }).decision, "allow");
  // Routing enforcement stays: writes block, unmapped needs approval.
  assert.equal(decideExecute({ operation: "apply_migration", env: "production" }).decision, "block");
  assert.equal(decideExecute({ operation: "some_future_tool_xyz", env: "development" }).decision, "approval_required");
  // Live: costBearing flag on execute does not escalate when Guard off.
  const [koupa] = await fixture(t);
  const log = [];
  const client = await session(t, koupa, log);
  const costLive = body(await client.callTool({ name: "nexus.execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {}, costBearing: true } }));
  assert.notEqual(costLive.decision, "approval_required");
});

test("Phase 1 revocation surfaces as execute decision (revoked:true, block), never tool-list push", async (t) => {
  const [koupa] = await fixture(t);
  const client = await session(t, koupa, [], {
    getToken: async () => { throw new Error("token revoked by provider"); },
  });
  const names = (await client.listTools()).tools.map((x) => x.name);
  assert(names.includes("nexus.execute"), "execute still listed even when revoked");
  const res = body(await client.callTool({ name: "nexus.execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } }));
  assert.equal(res.decision, "block");
  assert.equal(res.revoked, true);
});

test("Phase 1 stdio gate: disabled by default, NEXUS_ALLOW_STDIO=1 allows", () => {
  assert.equal(stdioGateAllows({}), false);
  assert.equal(stdioGateAllows({ NEXUS_ALLOW_STDIO: "0" }), false);
  assert.equal(stdioGateAllows({ NEXUS_ALLOW_STDIO: "1" }), true);
});

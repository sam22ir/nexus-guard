// Account end-to-end + Guard integration + HTTP promotion (Notion 2026-09-27 truth).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readContext, makeNexusServer, decideExecute, applyOverride } from "./nexus-server.mjs";
import { createNexusHttpServer } from "./nexus-http-server.mjs";

const upstreamTools = [
  { name: "list_tables", description: "List tables", inputSchema: { type: "object", properties: {} } },
];

async function writeManifest(dir, manifest) {
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), JSON.stringify(manifest));
}

async function session(t, workspace, log = [], extra = {}) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace,
    getToken: extra.getToken ?? (async () => "fake-token"),
    connectProvider: async (connection) => ({
      listTools: async () => ({ tools: upstreamTools }),
      callTool: async ({ name, arguments: args }) => {
        log.push({ kind: "call", name, projectRef: connection.project_ref });
        return { content: [{ type: "text", text: JSON.stringify({ projectRef: connection.project_ref }) }] };
      },
      close: async () => {},
    }),
    onAudit: extra.onAudit,
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

function body(r) { return JSON.parse(r.content[0].text); }

function manifestWithAccount({ account = "personal", project = "Koupa", pid = "koupa", target = "koupa-dev" } = {}) {
  return {
    project, project_id: pid, account, accountId: account,
    connections: {
      supabase: {
        target, resource: target, account, accountId: account,
        project_ref: `${pid}ref`, connection_id: `${pid}-connection`,
        method: "mcp", status: "connected",
      },
    },
  };
}

test("account parsed in readContext (top-level + per-connection aliases)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal" }));
  const ctx = await readContext(dir);
  assert.equal(ctx.status, "ready");
  assert.equal(ctx.account, "personal");
  assert.equal(ctx.accountId, "personal");
  assert.equal(ctx.connections[0].account, "personal");
  assert.equal(ctx.connections[0].accountId, "personal");
});

test("cross-account REQUEST blocks before provider", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal" }));
  const log = [];
  const client = await session(t, dir, log);
  const cross = await client.callTool({
    name: "nexus_request_access",
    arguments: { provider: "supabase", operation: "list_tables", account: "other" },
  });
  assert.equal(cross.isError, true);
  assert.equal(body(cross).decision, "block");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  const ok = body(await client.callTool({
    name: "nexus_request_access",
    arguments: { provider: "supabase", operation: "list_tables", account: "personal" },
  }));
  assert.equal(ok.decision, "allow");
});

test("cross-account EXECUTE arguments block before provider", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal" }));
  const log = [];
  const client = await session(t, dir, log);
  const cross = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", arguments: { account: "other" } },
  });
  assert.equal(cross.isError, true);
  assert.equal(body(cross).decision, "block");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("unmapped operation requires approval via Guard (EXECUTE)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({}));
  const log = [];
  const client = await session(t, dir, log);
  const res = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "some_future_tool_xyz", arguments: {} },
  });
  assert.equal(body(res).decision, "approval_required");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  // Unit-level: read allows, production destructive blocks.
  assert.equal(decideExecute({ operation: "list_tables", env: "development" }).decision, "allow");
  assert.equal(decideExecute({ operation: "apply_migration", env: "production" }).decision, "block");
});

test("fingerprint includes account: mid-session account change forces re-verification", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal" }));
  const client = await session(t, dir);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  await writeManifest(dir, manifestWithAccount({ account: "other" }));
  const after = body(await client.callTool({ name: "nexus_context", arguments: {} }));
  assert.equal(after.decision, "block");
  assert.match(after.reason, /changed during this session/);
});

test("HTTP single instance multiplexes workspaces with no bleed (parallel /context)", async (t) => {
  const server = createNexusHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-http-a-"));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-http-b-"));
  t.after(() => fs.rm(dirA, { recursive: true, force: true }));
  t.after(() => fs.rm(dirB, { recursive: true, force: true }));
  await writeManifest(dirA, manifestWithAccount({ project: "Alpha", pid: "alpha", account: "acct-a", target: "alpha-dev" }));
  await writeManifest(dirB, manifestWithAccount({ project: "Beta", pid: "beta", account: "acct-b", target: "beta-dev" }));
  const [resA, resB] = await Promise.all([
    fetch(`${base}/context?workspace=${encodeURIComponent(dirA)}`).then((r) => r.json()),
    fetch(`${base}/context?workspace=${encodeURIComponent(dirB)}`).then((r) => r.json()),
  ]);
  assert.equal(resA.project, "Alpha");
  assert.equal(resB.project, "Beta");
  assert.equal(resA.account, "acct-a");
  assert.equal(resB.account, "acct-b");
  assert.notEqual(resA.project, resB.project);
});

test("override chain ignored when Guard off (DEFERRED-PAID, routing only)", async () => {
  const r = applyOverride(
    { decision: "allow", vocab: "read", env: "development", reason: "ok" },
    { serviceOverride: "always-block" },
    {},
  );
  assert.equal(r.decision, "allow");
  assert.equal(r.override, undefined);
});

test("account_id alias normalized (top-level fallback + per-connection wins)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // Top-level account_id only: connections inherit it.
  await writeManifest(dir, {
    project: "Koupa", project_id: "koupa", account_id: "top-acct",
    connections: {
      supabase: {
        target: "koupa-dev", resource: "koupa-dev",
        project_ref: "kouparef", connection_id: "koupa-connection",
        method: "mcp", status: "connected",
      },
    },
  });
  const top = await readContext(dir);
  assert.equal(top.status, "ready");
  assert.equal(top.connections[0].account, "top-acct");
  assert.equal(top.connections[0].accountId, "top-acct");
  // Per-connection account_id wins over top-level account.
  await writeManifest(dir, {
    project: "Koupa", project_id: "koupa", account: "top-acct",
    connections: {
      supabase: {
        target: "koupa-dev", resource: "koupa-dev", account_id: "conn-acct",
        project_ref: "kouparef", connection_id: "koupa-connection",
        method: "mcp", status: "connected",
      },
    },
  });
  const conn = await readContext(dir);
  assert.equal(conn.connections[0].account, "conn-acct");
  assert.equal(conn.connections[0].accountId, "conn-acct");
});

test("requested accountId/account_id aliases block cross-account REQUEST", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal" }));
  const log = [];
  const client = await session(t, dir, log);
  for (const args of [
    { provider: "supabase", operation: "list_tables", accountId: "other" },
    { provider: "supabase", operation: "list_tables", account_id: "other" },
  ]) {
    const res = await client.callTool({ name: "nexus_request_access", arguments: args });
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.equal(body(res).decision, "block", JSON.stringify(args));
  }
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("matching target cannot mask mismatched resource (and vice versa)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal", target: "koupa-dev" }));
  const log = [];
  const client = await session(t, dir, log);
  // Target matches but resource is cross-project -> block.
  const masked = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", target: "koupa-dev", arguments: { resource: "other-dev" } },
  });
  assert.equal(masked.isError, true);
  assert.equal(body(masked).decision, "block");
  // Nested target matches but top-level resource is cross-project -> block.
  const masked2 = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", resource: "other-dev", arguments: { target: "koupa-dev" } },
  });
  assert.equal(body(masked2).decision, "block");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("top-level and nested account checked separately (no masking either way)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({ account: "personal" }));
  const log = [];
  const client = await session(t, dir, log);
  // Cross top-level hidden behind matching nested -> still blocks.
  const cross1 = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", account: "other", arguments: { account: "personal" } },
  });
  assert.equal(body(cross1).decision, "block");
  // Matching top-level with cross nested -> still blocks.
  const cross2 = await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", account: "personal", arguments: { account_id: "other" } },
  });
  assert.equal(body(cross2).decision, "block");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  // Both matching still allows through policy.
  const ok = body(await client.callTool({
    name: "nexus_execute",
    arguments: { provider: "supabase", operation: "list_tables", account: "personal", arguments: { accountId: "personal" } },
  }));
  assert.notEqual(ok.decision, "block");
});

test("nexus_context records one secret-free allow line in the workspace audit log", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-acct-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeManifest(dir, manifestWithAccount({}));
  const client = await session(t, dir);
  assert.equal(body(await client.callTool({ name: "nexus_context", arguments: {} })).project, "Koupa");
  const lines = (await fs.readFile(path.join(dir, ".nexus", "audit.log"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const entry = lines.find((l) => l.operation === "nexus.context");
  assert.ok(entry);
  assert.equal(entry.decision, "allow");
  assert.equal(entry.project, "Koupa");
  assert.doesNotMatch(JSON.stringify(entry), /token|secret|password/i);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeNexusServer } from "./nexus-server.mjs";
import { remoteToolDecision, serviceMcpUrl } from "./providers.mjs";

const tools = [
  { name: "list_issues", description: "List issues", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Create an issue", inputSchema: { type: "object", properties: {} } },
  { name: "delete_issue", description: "Delete", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "contradiction", description: "Claims both", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, destructiveHint: true } },
];

const connection = { target: "Linear", resource: "Linear", account: "personal", accountId: "personal-linear", connection_id: "koupa-ln", method: "mcp", status: "connected" };

async function fixture(t, connections) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-remote-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), JSON.stringify({ project: "Koupa", project_id: "koupa", environment: "development", connections }));
  return dir;
}

async function session(t, dir, log = [], audits = []) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace: dir,
    getToken: async () => "unused",
    connectProvider: async () => ({ listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [] }), close: async () => {} }),
    getRemoteToken: async (provider, projectId, connectionId) => { log.push({ kind: "credential", provider, projectId, connectionId }); return "fake-remote-token"; },
    connectRemoteProvider: async (url, token) => {
      log.push({ kind: "connect", url, token });
      return {
        listTools: async () => ({ tools }),
        callTool: async ({ name, arguments: args }) => { log.push({ kind: "call", name, args }); return { content: [{ type: "text", text: JSON.stringify({ ok: name }) }] }; },
        close: async () => {},
      };
    },
    onAudit: (entry) => audits.push(entry),
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

const body = (res) => JSON.parse(res.content[0].text);
const exec = (client, provider, operation, args = {}) => client.callTool({ name: "nexus.execute", arguments: { provider, operation, arguments: args } });

test("read-only rule: only a tool that says it is read-only goes through", () => {
  assert.equal(remoteToolDecision({ annotations: { readOnlyHint: true } }).decision, "allow");
  for (const tool of [{}, { annotations: {} }, { annotations: { readOnlyHint: false } }, { annotations: { readOnlyHint: true, destructiveHint: true } }, null, undefined]) {
    assert.equal(remoteToolDecision(tool).decision, "approval_required", JSON.stringify(tool));
  }
});

test("services list: every entry has an https address", async () => {
  const services = JSON.parse(await fs.readFile(new URL("./services.json", import.meta.url), "utf8"));
  const entries = Object.entries(services).filter(([key]) => !key.startsWith("_"));
  assert(entries.length >= 20);
  for (const [key, value] of entries) {
    assert.equal(key, key.toLowerCase());
    assert.match(value.mcpUrl, /^https:\/\//, key);
    assert.equal(serviceMcpUrl(value.name), value.mcpUrl, key);
  }
  assert.equal(serviceMcpUrl("Unknown Thing"), null);
});

test("remote service: a read-only tool is forwarded with this binding's own token", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [], audits = [];
  const client = await session(t, dir, log, audits);
  const res = await exec(client, "linear", "list_issues", { team: "x" });
  assert.notEqual(res.isError, true);
  assert.equal(body(res).ok, "list_issues");
  assert.deepEqual(log.find((i) => i.kind === "credential"), { kind: "credential", provider: "linear", projectId: "koupa", connectionId: "koupa-ln" });
  assert.equal(log.find((i) => i.kind === "connect").url, "https://mcp.linear.app/mcp");
  assert.deepEqual(log.find((i) => i.kind === "call").args, { team: "x" });
  assert(!JSON.stringify(res).includes("fake-remote-token"));
  assert(!JSON.stringify(audits).includes("fake-remote-token"));
  assert(audits.some((a) => a.provider === null || a.operation === "list_issues"));
});

test("remote service: writes and unannotated tools need approval and never reach the service", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log);
  for (const op of ["create_issue", "delete_issue", "contradiction"]) {
    const res = await exec(client, "linear", op);
    assert.equal(res.isError, true, op);
    assert.equal(body(res).decision, "approval_required", op);
  }
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("remote service: an unknown tool is blocked, and list_tools reports what is read-only", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log);
  const unknown = await exec(client, "linear", "no_such_tool");
  assert.equal(unknown.isError, true);
  assert.equal(body(unknown).decision, "block");
  const listed = body(await exec(client, "linear", "list_tools"));
  const byName = Object.fromEntries(listed.tools.map((t) => [t.name, t.read_only]));
  assert.deepEqual(byName, { list_issues: true, create_issue: false, delete_issue: false, contradiction: false });
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("remote service: not signed in, or a different service, never contacts anything", async (t) => {
  const dir = await fixture(t, { linear: { ...connection, status: "not_connected" } });
  const log = [];
  const client = await session(t, dir, log);
  assert.equal((await exec(client, "linear", "list_issues")).isError, true);
  assert.equal((await exec(client, "stripe", "list_customers")).isError, true);
  assert.equal(log.length, 0, "no token read, no connection");
});

test("remote service: a provider with no service address stays fail-closed", async (t) => {
  const dir = await fixture(t, { acmecorp: { ...connection, target: "Acme", resource: "Acme" } });
  const log = [];
  const client = await session(t, dir, log);
  const res = await exec(client, "acmecorp", "list_things");
  assert.equal(res.isError, true);
  assert.equal(body(res).decision, "approval_required");
  assert.equal(log.length, 0);
});

test("remote service: the hidden <service>__<tool> alias follows the same rule", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log);
  assert.notEqual((await client.callTool({ name: "linear__list_issues", arguments: {} })).isError, true);
  assert.equal((await client.callTool({ name: "linear__create_issue", arguments: {} })).isError, true);
  assert.equal(log.filter((i) => i.kind === "call").length, 1);
});

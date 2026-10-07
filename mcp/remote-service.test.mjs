import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeNexusServer } from "./nexus-server.mjs";
import { applyResourceScope, remoteToolDecision, remoteToolKind, scopeArgOf, serviceMcpUrl, serviceScopeSpec } from "./providers.mjs";
import { readBindingScope } from "./binding-scopes.mjs";
import { readWriteGrant } from "./write-grants.mjs";

const tools = [
  { name: "list_issues", description: "List issues", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Create an issue", inputSchema: { type: "object", properties: {} } },
  { name: "delete_issue", description: "Delete", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "add_comment", description: "Add a comment", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false } },
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

async function session(t, dir, log = [], audits = [], grants = {}, extra = {}) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace: dir,
    getToken: async () => "unused",
    connectProvider: async () => ({ listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [] }), close: async () => {} }),
    getRemoteToken: async (provider, projectId, connectionId) => { log.push({ kind: "credential", provider, projectId, connectionId }); return "fake-remote-token"; },
    connectRemoteProvider: async (url, token) => {
      log.push({ kind: "connect", url, token });
      return {
        listTools: async () => ({ tools: extra.tools ?? tools }),
        callTool: async ({ name, arguments: args }) => { log.push({ kind: "call", name, args }); return { content: [{ type: "text", text: JSON.stringify({ ok: name }) }] }; },
        close: async () => {},
      };
    },
    getWriteGrant: async (projectId, connectionId) => grants[`${projectId}:${connectionId}`] === true,
    onAudit: (entry) => audits.push(entry),
    ...(extra.server ?? {}),
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
  assert.deepEqual(byName, { list_issues: true, create_issue: false, delete_issue: false, add_comment: false, contradiction: false });
  const kinds = Object.fromEntries(listed.tools.map((t) => [t.name, t.kind]));
  assert.deepEqual(kinds, { list_issues: "read", create_issue: "destructive", delete_issue: "destructive", add_comment: "write", contradiction: "destructive" });
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

test("tool kinds: unlabelled means destructive, as the MCP default says", () => {
  assert.equal(remoteToolKind({ annotations: { readOnlyHint: true } }), "read");
  assert.equal(remoteToolKind({ annotations: { readOnlyHint: false, destructiveHint: false } }), "write");
  assert.equal(remoteToolKind({ annotations: { destructiveHint: false } }), "write");
  for (const tool of [{}, null, { annotations: {} }, { annotations: { readOnlyHint: false } }, { annotations: { destructiveHint: true } }, { annotations: { readOnlyHint: true, destructiveHint: true } }]) {
    assert.equal(remoteToolKind(tool), "destructive", JSON.stringify(tool));
  }
});

test("writes: off by default, so even a safe write is refused and not run", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log);
  const res = await exec(client, "linear", "add_comment", { body: "hi" });
  assert.equal(res.isError, true);
  assert.equal(body(res).decision, "approval_required");
  assert.match(body(res).reason, /writes are off/i);
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("writes: switched on for this binding, a safe write runs and is audited as such", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [], audits = [];
  const client = await session(t, dir, log, audits, { "koupa:koupa-ln": true });
  const res = await exec(client, "linear", "add_comment", { body: "hi" });
  assert.notEqual(res.isError, true);
  assert.deepEqual(log.find((i) => i.kind === "call"), { kind: "call", name: "add_comment", args: { body: "hi" } });
  assert(audits.some((a) => a.operation === "add_comment" && a.decision === "allow" && /write allowed/.test(a.reason)));
});

test("writes: switching them on never lets through destructive or unlabelled tools", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log, [], { "koupa:koupa-ln": true });
  for (const op of ["create_issue", "delete_issue", "contradiction"]) {
    const res = await exec(client, "linear", op);
    assert.equal(res.isError, true, op);
    assert.equal(body(res).decision, "approval_required", op);
  }
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("writes: never in production, even when switched on", async (t) => {
  const dir = await fixture(t, { linear: { ...connection, environment: "production" } });
  const log = [];
  const client = await session(t, dir, log, [], { "koupa:koupa-ln": true });
  const res = await exec(client, "linear", "add_comment");
  assert.equal(res.isError, true);
  assert.match(body(res).reason, /production/i);
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  // Reads still work in production.
  assert.notEqual((await exec(client, "linear", "list_issues")).isError, true);
});

test("writes: a grant for another binding does not apply", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log, [], { "koupa:someone-elses": true, "other-project:koupa-ln": true });
  assert.equal((await exec(client, "linear", "add_comment")).isError, true);
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("write grants: read from the app's own file, and anything unclear means no", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-grants-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "write-grants.json");
  assert.equal(await readWriteGrant("koupa", "koupa-ln", file), false, "missing file");
  await fs.writeFile(file, "not json");
  assert.equal(await readWriteGrant("koupa", "koupa-ln", file), false, "damaged file");
  await fs.writeFile(file, JSON.stringify({ grants: { "koupa:koupa-ln": true, "koupa:other": "yes", "p:c": false } }));
  assert.equal(await readWriteGrant("koupa", "koupa-ln", file), true);
  assert.equal(await readWriteGrant("koupa", "other", file), false, "only a real true counts");
  assert.equal(await readWriteGrant("p", "c", file), false);
  assert.equal(await readWriteGrant("", "koupa-ln", file), false);
});

test("write grants: the project folder cannot grant itself writes", async (t) => {
  const dir = await fixture(t, { linear: { ...connection, allow_writes: true, allowWrites: true, writes: "allow" } });
  await fs.writeFile(path.join(dir, ".nexus", "write-grants.json"), JSON.stringify({ grants: { "koupa:koupa-ln": true } }));
  const log = [];
  const client = await session(t, dir, log);
  assert.equal((await exec(client, "linear", "add_comment")).isError, true);
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

// ---- Limiting a binding to one resource (one project, site, base…) ----

const spec = { label: "project", args: ["projectId", "project_id"] };
const projectTool = (name, annotations, extraProps = {}) => ({ name, description: name, inputSchema: { type: "object", properties: { projectId: { type: "string" }, ...extraProps } }, annotations });
const scopeTools = [
  projectTool("describe_project", { readOnlyHint: true }),
  projectTool("add_note", { readOnlyHint: false, destructiveHint: false }, { note: { type: "string" } }),
  { name: "list_projects", description: "Everything in the account", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } },
];
const scoped = (bound) => ({ tools: scopeTools, server: { getServiceScopeSpec: () => spec, getBindingScope: async () => bound } });

test("limit rules: the tool's own schema says whether it can be limited", () => {
  assert.equal(scopeArgOf(scopeTools[0], spec), "projectId");
  assert.equal(scopeArgOf(scopeTools[2], spec), null);
  assert.equal(scopeArgOf({ inputSchema: { properties: { project_id: {} } } }, spec), "project_id");
  assert.equal(scopeArgOf({}, spec), null);
  assert.equal(scopeArgOf(scopeTools[0], null), null);
});

test("limit rules: wrong resource refused, missing one filled in, same one kept, account-wide tools refused", () => {
  const t = scopeTools[0];
  assert.deepEqual(applyResourceScope({ tool: t, spec, bound: "p1", args: {} }), { ok: true, args: { projectId: "p1" } });
  assert.deepEqual(applyResourceScope({ tool: t, spec, bound: "p1", args: { projectId: " P1 ", other: 1 } }), { ok: true, args: { projectId: "p1", other: 1 } });
  const wrong = applyResourceScope({ tool: t, spec, bound: "p1", args: { projectId: "p2" } });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /limited to project 'p1'/);
  // Either spelling of the argument is checked, even when the tool only declares one.
  assert.equal(applyResourceScope({ tool: t, spec, bound: "p1", args: { project_id: "p2" } }).ok, false);
  assert.equal(applyResourceScope({ tool: t, spec, bound: "p1", args: { projectId: "p1", project_id: "p2" } }).ok, false);
  const wide = applyResourceScope({ tool: scopeTools[2], spec, bound: "p1", args: {} });
  assert.equal(wide.ok, false);
  assert.match(wide.reason, /cannot be limited/);
  // Not limited: nothing changes.
  const args = { projectId: "anything" };
  assert.deepEqual(applyResourceScope({ tool: scopeTools[2], spec, bound: null, args }), { ok: true, args });
  assert.deepEqual(applyResourceScope({ tool: scopeTools[2], spec: null, bound: "p1", args }), { ok: true, args });
});

test("limited binding: the bound project is forced on, a different one never reaches the service", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log, [], {}, scoped("p1"));
  assert.notEqual((await exec(client, "linear", "describe_project", {})).isError, true);
  assert.deepEqual(log.filter((i) => i.kind === "call").map((c) => c.args), [{ projectId: "p1" }], "the project was filled in");
  const other = await exec(client, "linear", "describe_project", { projectId: "p2" });
  assert.equal(other.isError, true);
  assert.match(other.content[0].text, /limited to project 'p1'/);
  assert.equal(log.filter((i) => i.kind === "call").length, 1, "the wrong project was never sent");
});

test("limited binding: an account-wide tool is refused, so nothing leaks around the limit", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log, [], {}, scoped("p1"));
  const res = await exec(client, "linear", "list_projects", {});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /cannot be limited/);
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
});

test("limited binding: not limited means today's behaviour, account-wide tools still run", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const client = await session(t, dir, log, [], {}, scoped(null));
  assert.notEqual((await exec(client, "linear", "list_projects", {})).isError, true);
  assert.deepEqual(log.find((i) => i.kind === "call").args, {});
});

test("limited binding: a safe write is limited too, and still needs the writes switch", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const log = [];
  const off = await session(t, dir, log, [], {}, scoped("p1"));
  assert.equal((await exec(off, "linear", "add_note", { note: "x" })).isError, true);
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  const log2 = [];
  const on = await session(t, dir, log2, [], { "koupa:koupa-ln": true }, scoped("p1"));
  assert.notEqual((await exec(on, "linear", "add_note", { note: "x" })).isError, true);
  assert.deepEqual(log2.find((i) => i.kind === "call").args, { note: "x", projectId: "p1" });
  assert.equal((await exec(on, "linear", "add_note", { note: "x", projectId: "p2" })).isError, true);
  assert.equal(log2.filter((i) => i.kind === "call").length, 1);
});

test("limited binding: list_tools says what the limit is and which tools can be limited", async (t) => {
  const dir = await fixture(t, { linear: connection });
  const client = await session(t, dir, [], [], {}, scoped("p1"));
  const listed = JSON.parse((await exec(client, "linear", "list_tools")).content[0].text);
  assert.deepEqual(listed.limited_to, { project: "p1" });
  assert.deepEqual(Object.fromEntries(listed.tools.map((x) => [x.name, x.limitable])), { describe_project: true, add_note: true, list_projects: false });
  const open = JSON.parse((await exec(await session(t, dir, [], [], {}, scoped(null)), "linear", "list_tools")).content[0].text);
  assert.equal(open.limited_to, undefined, "no limit set");
  assert.equal(open.can_be_limited_to, "project");
  assert.equal(open.tools[0].limitable, true, "still reported, so a new service's data can be checked before any limit is set");
  assert.equal(open.tools[2].limitable, false);
  // A service with no scope row reports nothing about limits.
  const none = JSON.parse((await exec(await session(t, dir, [], [], {}, { tools: scopeTools, server: { getServiceScopeSpec: () => null } }), "linear", "list_tools")).content[0].text);
  assert.equal(none.can_be_limited_to, undefined);
  assert.equal(none.tools[0].limitable, undefined);
});

test("limit file: read from the app's own config, anything unclear means no limit set", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-scopes-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "binding-scopes.json");
  assert.equal(await readBindingScope("koupa", "koupa-ln", file), null, "missing file");
  await fs.writeFile(file, "not json");
  assert.equal(await readBindingScope("koupa", "koupa-ln", file), null, "damaged file");
  await fs.writeFile(file, JSON.stringify({ scopes: { "koupa:koupa-ln": " p1 ", "koupa:blank": "  ", "koupa:num": 5 } }));
  assert.equal(await readBindingScope("koupa", "koupa-ln", file), "p1");
  assert.equal(await readBindingScope("koupa", "blank", file), null);
  assert.equal(await readBindingScope("koupa", "num", file), null);
  assert.equal(await readBindingScope("", "koupa-ln", file), null);
});

test("limit: the project folder cannot widen or set it", async (t) => {
  const dir = await fixture(t, { linear: { ...connection, scope: "p9", resource_scope: "p9" } });
  await fs.writeFile(path.join(dir, ".nexus", "binding-scopes.json"), JSON.stringify({ scopes: { "koupa:koupa-ln": "p9" } }));
  const log = [];
  const client = await session(t, dir, log, [], {}, { tools: scopeTools, server: { getServiceScopeSpec: () => spec } });
  // The server reads the app's file (empty in this test), not the workspace: no limit applies.
  assert.notEqual((await exec(client, "linear", "list_projects", {})).isError, true);
  assert.deepEqual(log.find((i) => i.kind === "call").args, {});
});

test("service list: scope rows are well formed, and unknown services have none", () => {
  const withScope = ["neon", "vercel", "sentry", "netlify", "airtable", "railway", "sanity", "gitlab", "webflow", "cloudflare"];
  for (const name of withScope) {
    const found = serviceScopeSpec(name);
    assert(found, name);
    assert(found.label && found.args.length > 0, name);
  }
  assert.equal(serviceScopeSpec("notion"), null);
  assert.equal(serviceScopeSpec("nothing-here"), null);
});

// ---- Services the user adds themselves ----

import { isSafeServiceUrl } from "./providers.mjs";

test("custom services: only public https addresses are ever used", () => {
  for (const ok of ["https://mcp.acme.io/mcp", "https://mcp.acme.io", "https://a.b.example.co.uk/x?y=1", "https://mcp.acme.io:443/mcp"]) assert.equal(isSafeServiceUrl(ok), true, ok);
  for (const bad of ["http://mcp.acme.io", "mcp.acme.io", "", "https://localhost/mcp", "https://127.0.0.1/mcp", "https://[::1]/mcp", "https://10.0.0.1", "https://intranet/mcp", "https://printer.local", "https://x.internal", "https://u:p@mcp.acme.io", "https://mcp.acme.io/#x", "https://mcp.acme.io:8443/mcp", null, undefined, 5]) {
    assert.equal(isSafeServiceUrl(bad), false, String(bad));
  }
});

async function withCustomFile(t, services) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-custom-"));
  const file = path.join(dir, "custom-services.json");
  await fs.writeFile(file, typeof services === "string" ? services : JSON.stringify({ services }));
  const previous = process.env.NEXUS_CUSTOM_SERVICES_FILE;
  process.env.NEXUS_CUSTOM_SERVICES_FILE = file;
  t.after(async () => { if (previous === undefined) delete process.env.NEXUS_CUSTOM_SERVICES_FILE; else process.env.NEXUS_CUSTOM_SERVICES_FILE = previous; await fs.rm(dir, { recursive: true, force: true }); });
}

test("custom services: an added service is signed in to and held to the read-only rule", async (t) => {
  await withCustomFile(t, { acme: { name: "Acme", mcpUrl: "https://mcp.acme.io/mcp" } });
  assert.equal(serviceMcpUrl("Acme"), "https://mcp.acme.io/mcp");
  const dir = await fixture(t, { acme: { ...connection, target: "Acme", resource: "Acme", connection_id: "koupa-acme" } });
  const log = [];
  const client = await session(t, dir, log);
  assert.notEqual((await exec(client, "acme", "list_issues", {})).isError, true);
  assert.equal(log.find((i) => i.kind === "connect").url, "https://mcp.acme.io/mcp");
  assert.equal((await exec(client, "acme", "create_issue")).isError, true);
  assert.equal(log.filter((i) => i.kind === "call").length, 1, "only the read-only tool was sent");
});

test("custom services: unsafe or damaged entries are ignored, so the service stays fail-closed", async (t) => {
  await withCustomFile(t, { evil: { name: "Evil", mcpUrl: "http://127.0.0.1:9/mcp" }, internal: { name: "Internal", mcpUrl: "https://intranet/mcp" }, odd: "not an object" });
  for (const name of ["evil", "internal", "odd", "missing"]) assert.equal(serviceMcpUrl(name), null, name);
  await withCustomFile(t, "garbage");
  assert.equal(serviceMcpUrl("evil"), null);
});

test("custom services: a custom entry can never redefine a built-in or native service", async (t) => {
  await withCustomFile(t, {
    linear: { name: "Linear", mcpUrl: "https://attacker.example.com/mcp" },
    supabase: { name: "Supabase", mcpUrl: "https://attacker.example.com/mcp" },
    github: { name: "GitHub", mcpUrl: "https://attacker.example.com/mcp" },
  });
  assert.equal(serviceMcpUrl("linear"), "https://mcp.linear.app/mcp");
  assert.equal(serviceMcpUrl("supabase"), null);
  assert.equal(serviceMcpUrl("github"), null);
});

test("custom services: the project folder cannot add a service", async (t) => {
  await withCustomFile(t, {});
  const dir = await fixture(t, { acme: { ...connection, target: "Acme", resource: "Acme" } });
  await fs.writeFile(path.join(dir, ".nexus", "custom-services.json"), JSON.stringify({ services: { acme: { name: "Acme", mcpUrl: "https://mcp.acme.io/mcp" } } }));
  const log = [];
  const client = await session(t, dir, log);
  const res = await exec(client, "acme", "list_issues");
  assert.equal(res.isError, true);
  assert.equal(log.length, 0, "no token read, no connection");
});

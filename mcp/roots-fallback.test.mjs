// Paper §10 (blocking verify): Nexus learns an agent's working directory from
// MCP roots when no explicit workspace is sent. Explicit workspace always wins;
// zero/multiple/changed roots are refused, never guessed (paper §7).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pickWorkspaceFromRoots } from "./nexus-server.mjs";
import { createNexusHttpServer } from "./nexus-http-server.mjs";

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-roots-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true }); // no project.json → unresolved, audit still writable
  return dir;
}

async function boot(t) {
  const server = createNexusHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

/** Connect an MCP client that answers roots/list from a mutable `state.roots`. */
async function connect(t, url, state) {
  const client = new Client({ name: "roots-probe", version: "0.0.1" }, { capabilities: { roots: { listChanged: true } } });
  state.calls = 0;
  client.setRequestHandler(ListRootsRequestSchema, async () => {
    state.calls += 1;
    return { roots: state.roots.map((dir) => ({ uri: pathToFileURL(dir).href })) };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  t.after(() => client.close());
  return client;
}

const call = (client) => client.callTool({ name: "nexus.context", arguments: {} });
const auditExists = (dir) => fs.access(path.join(dir, ".nexus", "audit.log")).then(() => true, () => false);

test("pickWorkspaceFromRoots: exactly one absolute file root, nothing else", () => {
  assert.deepEqual(pickWorkspaceFromRoots([{ uri: "file:///tmp/a" }]), { ok: true, workspace: "/tmp/a" });
  assert.deepEqual(pickWorkspaceFromRoots([{ uri: "file:///tmp/a" }, { uri: "file:///tmp/a/" }]), { ok: true, workspace: "/tmp/a" });
  assert.equal(pickWorkspaceFromRoots([]).ok, false);
  assert.equal(pickWorkspaceFromRoots(undefined).ok, false);
  assert.equal(pickWorkspaceFromRoots([{ uri: "https://example.com/x" }, { uri: "ssh://h/p" }]).ok, false);
  assert.equal(pickWorkspaceFromRoots([{ uri: "file://remote-host/tmp/a" }]).ok, false);
  assert.equal(pickWorkspaceFromRoots([{ uri: "file:///tmp/a" }, { uri: "file:///tmp/b" }]).ok, false);
  assert.equal(pickWorkspaceFromRoots([{ uri: 42 }, null]).ok, false);
});

test("http: no explicit workspace binds the single root at the first tool call", async (t) => {
  const url = await boot(t);
  const dir = await workspace(t);
  const client = await connect(t, url, { roots: [dir] });
  const res = await call(client);
  assert.equal(res.isError, true); // no project.json → unresolved, but bound to the right folder
  assert.equal(await auditExists(dir), true);
});

test("http: no workspace and no roots capability is refused at connect", async (t) => {
  const url = await boot(t);
  const client = new Client({ name: "no-roots", version: "0.0.1" }, { capabilities: {} });
  await assert.rejects(client.connect(new StreamableHTTPClientTransport(new URL(url))));
  await client.close().catch(() => undefined);
});

test("http: several roots are ambiguous and refused without binding", async (t) => {
  const url = await boot(t);
  const a = await workspace(t);
  const b = await workspace(t);
  const client = await connect(t, url, { roots: [a, b] });
  const res = await call(client);
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res), /more than one workspace/);
  assert.equal(await auditExists(a), false);
  assert.equal(await auditExists(b), false);
});

test("http: an explicit workspace wins and roots are never requested", async (t) => {
  const url = await boot(t);
  const pinned = await workspace(t);
  const other = await workspace(t);
  const state = { roots: [other] };
  const client = await connect(t, `${url}?workspace=${encodeURIComponent(pinned)}`, state);
  await call(client);
  assert.equal(state.calls, 0);
  assert.equal(await auditExists(pinned), true);
  assert.equal(await auditExists(other), false);
});

test("http: a roots change after binding is refused, not followed", async (t) => {
  const url = await boot(t);
  const first = await workspace(t);
  const second = await workspace(t);
  const state = { roots: [first] };
  const client = await connect(t, url, state);
  await call(client);
  state.roots = [second];
  await client.sendRootsListChanged();
  const res = await call(client);
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res), /changed during this session/);
  assert.equal(await auditExists(second), false);
});

test("http: roots list_changed with the same folder keeps the session working", async (t) => {
  const url = await boot(t);
  const dir = await workspace(t);
  const state = { roots: [dir] };
  const client = await connect(t, url, state);
  await call(client);
  await client.sendRootsListChanged();
  const res = await call(client);
  assert.doesNotMatch(JSON.stringify(res), /changed during this session/);
});

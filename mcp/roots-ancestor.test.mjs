// Global mode: a roots-derived folder resolves to the nearest ancestor holding
// .nexus/project.json. Explicit workspaces are never walked.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveProjectRoot } from "./nexus-server.mjs";
import { createNexusHttpServer } from "./nexus-http-server.mjs";

async function tmp(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nexus-anc-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function project(dir) {
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), JSON.stringify({ project: "p" }));
}
const sub = async (dir, ...p) => {
  const d = path.join(dir, ...p);
  await fs.mkdir(d, { recursive: true });
  return d;
};
const exists = (f) => fs.access(f).then(() => true, () => false);
const auditExists = (dir) => exists(path.join(dir, ".nexus", "audit.log"));

async function boot(t) {
  const server = createNexusHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/mcp`;
}
async function connect(t, url, state) {
  const client = new Client({ name: "anc-probe", version: "0.0.1" }, { capabilities: { roots: { listChanged: true } } });
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

test("resolveProjectRoot: a subfolder resolves to the project root", async (t) => {
  const root = await tmp(t);
  await project(root);
  const deep = await sub(root, "src", "a", "b");
  assert.equal(await resolveProjectRoot(deep, { homeDir: "/nonexistent-home" }), root);
  assert.equal(await resolveProjectRoot(root, { homeDir: "/nonexistent-home" }), root);
});

test("resolveProjectRoot: the nearest project wins when nested", async (t) => {
  const outer = await tmp(t);
  await project(outer);
  const inner = await sub(outer, "packages", "app");
  await project(inner);
  const deep = await sub(inner, "src");
  assert.equal(await resolveProjectRoot(deep, { homeDir: "/nonexistent-home" }), inner);
});

test("resolveProjectRoot: no project anywhere keeps the original folder", async (t) => {
  const root = await tmp(t);
  const deep = await sub(root, "x", "y");
  assert.equal(await resolveProjectRoot(deep, { homeDir: "/nonexistent-home" }), deep);
  assert.equal(await resolveProjectRoot(path.join(root, "missing"), { homeDir: "/nonexistent-home" }), path.join(root, "missing"));
});

test("resolveProjectRoot: the walk stops before home", async (t) => {
  const fakeHome = await tmp(t);
  await project(fakeHome); // a project file at home must never be adopted by a folder below it
  const deep = await sub(fakeHome, "work", "thing");
  assert.equal(await resolveProjectRoot(deep, { homeDir: fakeHome }), deep);
  // a real project below home is still found
  const proj = await sub(fakeHome, "work");
  await project(proj);
  assert.equal(await resolveProjectRoot(deep, { homeDir: fakeHome }), proj);
});

test("resolveProjectRoot: a .nexus symlink pointing outside the chain is not honoured", async (t) => {
  const outside = await tmp(t);
  await project(outside);
  const root = await tmp(t);
  await fs.symlink(path.join(outside, ".nexus"), path.join(root, ".nexus"));
  const deep = await sub(root, "src");
  assert.equal(await resolveProjectRoot(deep, { homeDir: "/nonexistent-home" }), deep);
});

test("resolveProjectRoot: caps the walk at 24 levels", async (t) => {
  const root = await tmp(t);
  await project(root);
  const near = await sub(root, ...Array(10).fill("d"));
  const far = await sub(root, ...Array(30).fill("d"));
  assert.equal(await resolveProjectRoot(near, { homeDir: "/nonexistent-home" }), root);
  assert.equal(await resolveProjectRoot(far, { homeDir: "/nonexistent-home" }), far);
});

test("http: a subfolder root binds the project root, and moving within it keeps working", async (t) => {
  const url = await boot(t);
  const root = await tmp(t);
  await project(root);
  const src = await sub(root, "src");
  const docs = await sub(root, "docs");
  const state = { roots: [src] };
  const client = await connect(t, url, state);
  await call(client);
  assert.equal(await auditExists(root), true);
  assert.equal(await auditExists(src), false);
  state.roots = [docs];
  await client.sendRootsListChanged();
  const res = await call(client);
  assert.doesNotMatch(JSON.stringify(res), /changed during this session/);
});

test("http: a change to a different project is refused", async (t) => {
  const url = await boot(t);
  const a = await tmp(t);
  const b = await tmp(t);
  await project(a);
  await project(b);
  const state = { roots: [await sub(a, "src")] };
  const client = await connect(t, url, state);
  await call(client);
  state.roots = [await sub(b, "src")];
  await client.sendRootsListChanged();
  const res = await call(client);
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res), /changed during this session/);
  assert.equal(await auditExists(b), false);
});

test("http: no project file anywhere keeps the original folder, unresolved", async (t) => {
  const url = await boot(t);
  const root = await tmp(t);
  const src = await sub(root, "src");
  await fs.mkdir(path.join(src, ".nexus"));
  const client = await connect(t, url, { roots: [src] });
  const res = await call(client);
  assert.equal(res.isError, true);
  assert.equal(await auditExists(src), true);
});

test("http: an explicit workspace is never walked up", async (t) => {
  const url = await boot(t);
  const root = await tmp(t);
  await project(root);
  const src = await sub(root, "src");
  await fs.mkdir(path.join(src, ".nexus"));
  const state = { roots: [root] };
  const client = await connect(t, `${url}?workspace=${encodeURIComponent(src)}`, state);
  await call(client);
  assert.equal(state.calls, 0);
  assert.equal(await auditExists(src), true);
  assert.equal(await auditExists(root), false);
});

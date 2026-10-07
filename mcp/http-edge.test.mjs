// HTTP/workspace edge tests (additive only — does not touch existing mcp/*.mjs).
// Covers createNexusHttpServer/startNexusHttpServer + resolveWorkspace edge cases.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  createNexusHttpServer,
  startNexusHttpServer,
  resolveWorkspace,
} from "./nexus-http-server.mjs";

const execFileAsync = promisify(execFile);

function fakeReq(headers = {}) {
  return { headers };
}
function urlOf(qs = "/") {
  return new URL(qs, "http://localhost");
}

async function boot(t, opts = {}) {
  const server = createNexusHttpServer(opts);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function mkManifest(t, dir, { project, account, resource, extra = {} }) {
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".nexus", "project.json"),
    JSON.stringify({
      project,
      project_id: project.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
      account,
      connections: {
        supabase: { target: resource, resource, environment: "development" },
      },
      ...extra,
    }),
  );
}

async function mktmp(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function assertSecretFree(body) {
  // Note: the safety disclaimer legitimately contains the word "credentials"
  // ("No credentials are returned"), so check for actual secret material and
  // secret-bearing keys instead of that substring.
  const text = JSON.stringify(body).toLowerCase();
  for (const needle of ["token", "password", "secret", "bearer", "authorization", "access_token", "api_key", "apikey"]) {
    assert.ok(!text.includes(needle), `response leaks ${needle}`);
  }
}

// Vault lock enforcement is opt-in for the HTTP bridge so unit fixtures stay
// deterministic; the standalone bridge enables it in its CLI entrypoint.
test("enforced HTTP bridge blocks MCP while locked and resumes after unlock", async (t) => {
  const dir = await mktmp(t, "nexus-edge-lock-");
  await mkManifest(t, dir, { project: "Locked", account: "lock-acct", resource: "lock-res" });
  const state = path.join(dir, "vault-state.json");
  await fs.writeFile(state, JSON.stringify({ locked: true }));
  const base = await boot(t, { defaultWorkspace: dir, enforceVaultLock: true, vaultStateFile: state });

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  const context = await fetch(`${base}/context?workspace=${encodeURIComponent(dir)}`);
  assert.equal(context.status, 200);

  const blocked = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lock-test", version: "1" } } }),
  });
  assert.equal(blocked.status, 423);
  assert.match((await blocked.json()).error, /vault is locked/i);

  await fs.writeFile(state, JSON.stringify({ locked: false }));
  const allowed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lock-test", version: "1" } } }),
  });
  assert.notEqual(allowed.status, 423);
  assert.notEqual(allowed.status, 500);
});

// 1. Header beats query; missing both -> default workspace.
test("workspace precedence: header > query > default", async (t) => {
  const dirA = await mktmp(t, "nexus-edge-a-");
  const dirB = await mktmp(t, "nexus-edge-b-");
  const dirDef = await mktmp(t, "nexus-edge-def-");
  await mkManifest(t, dirA, { project: "EdgeA", account: "a", resource: "res-a" });
  await mkManifest(t, dirB, { project: "EdgeB", account: "b", resource: "res-b" });
  await mkManifest(t, dirDef, { project: "EdgeDef", account: "d", resource: "res-d" });

  // Unit-level precedence.
  assert.equal(
    resolveWorkspace(fakeReq({ "x-nexus-workspace": dirB }), urlOf(`/?workspace=${encodeURIComponent(dirA)}`), dirDef),
    dirB,
  );
  assert.equal(
    resolveWorkspace(fakeReq({}), urlOf(`/?workspace=${encodeURIComponent(dirA)}`), dirDef),
    dirA,
  );
  assert.equal(
    resolveWorkspace(fakeReq({}), urlOf("/"), dirDef),
    path.resolve(dirDef),
  );

  const base = await boot(t, { defaultWorkspace: dirDef });

  // Header wins over query over HTTP.
  const win = await fetch(`${base}/context?workspace=${encodeURIComponent(dirA)}`, {
    headers: { "X-Nexus-Workspace": dirB },
  });
  assert.equal(win.status, 200);
  const winBody = await win.json();
  assert.equal(winBody.project, "EdgeB");

  // Missing both -> default workspace manifest.
  const def = await fetch(`${base}/context`);
  assert.equal(def.status, 200);
  const defBody = await def.json();
  assert.equal(defBody.project, "EdgeDef");
  // The server reports the real folder (macOS: /private/var/…, Windows: no 8.3 short names).
  assert.equal(defBody.workspace, await fs.realpath(dirDef));
});

// 2. Overlong workspace (>1024) falls back to default, no crash.
test("overlong workspace falls back to default without crash", async (t) => {
  const dirDef = await mktmp(t, "nexus-edge-longdef-");
  await mkManifest(t, dirDef, { project: "EdgeDef", account: "d", resource: "res-d" });
  const long = `/${"w".repeat(2000)}`;

  assert.equal(resolveWorkspace(fakeReq({}), urlOf(`/?workspace=${encodeURIComponent(long)}`), dirDef), path.resolve(dirDef));
  assert.equal(resolveWorkspace(fakeReq({ "x-nexus-workspace": long }), urlOf("/"), dirDef), path.resolve(dirDef));

  const base = await boot(t, { defaultWorkspace: dirDef });
  const res = await fetch(`${base}/context?workspace=${encodeURIComponent(long)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.workspace, await fs.realpath(dirDef));
  assert.equal(body.project, "EdgeDef");
  const h = await fetch(`${base}/healthz`);
  assert.equal(h.status, 200);
});

// 3. Malformed / oversized / method / unknown-path handling.
test("POST /mcp rejects bad bodies; wrong methods and paths get 405/404", async (t) => {
  const base = await boot(t);

  // Invalid JSON body -> 400.
  const bad = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not valid json",
  });
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(badBody.ok, false);

  // Oversized body (>1MiB): server destroys the socket (client sees ECONNRESET)
  // or answers 400/413 — either way it must stay alive. Accept both.
  const big = JSON.stringify({ data: "x".repeat(2 * 1024 * 1024) });
  let oversizedStatus = null;
  try {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    });
    oversizedStatus = r.status;
    await r.text().catch(() => "");
  } catch (err) {
    // ECONNRESET / fetch failed: expected when the server kills an overlarge body.
    assert.ok(/fetch failed|ECONNRESET|terminated|socket|body/i.test(String(err?.message ?? err) + String(err?.cause ?? "")));
  }
  if (oversizedStatus !== null) {
    assert.ok([400, 413].includes(oversizedStatus), `oversized -> ${oversizedStatus}, want 400/413`);
  }
  const alive = await fetch(`${base}/healthz`);
  assert.equal(alive.status, 200);

  // GET / DELETE /mcp without a session id -> 400; unknown session -> 404;
  // other methods -> 405; unknown path -> 404.
  assert.equal((await fetch(`${base}/mcp`)).status, 400);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE" })).status, 400);
  assert.equal((await fetch(`${base}/mcp`, { method: "DELETE", headers: { "mcp-session-id": "no-such-session" } })).status, 404);
  assert.equal((await fetch(`${base}/mcp`, { method: "PUT" })).status, 405);
  const unknown = await fetch(`${base}/does-not-exist`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).ok, false);
});

// 4. Plain-JSON fallback returns nexus.context shape, secret-free, no static session.
test("plain-JSON POST /mcp fallback returns nexus.context shape without secrets", async (t) => {
  const dir = await mktmp(t, "nexus-edge-plain-");
  await mkManifest(t, dir, { project: "EdgePlain", account: "plain-acct", resource: "plain-res" });
  const base = await boot(t);

  // Body {workspace} variant.
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: dir }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.session, undefined, "no static session echo (server-held only)");
  assert.equal(body.status, "ready");
  assert.equal(body.project, "EdgePlain");
  assert.ok(Array.isArray(body.connections));
  assert.equal(typeof body.safety, "string");
  assertSecretFree(body);

  // Header-workspace variant with empty non-JSON-RPC body.
  const res2 = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Nexus-Workspace": dir },
    body: JSON.stringify({}),
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.project, "EdgePlain");
  assertSecretFree(body2);
});

// 5. Parallel isolation across two manifests (10 parallel, GET + plain POST).
test("parallel isolation: two workspaces, 10 concurrent requests, no bleed", async (t) => {
  const dirA = await mktmp(t, "nexus-edge-parA-");
  const dirB = await mktmp(t, "nexus-edge-parB-");
  await mkManifest(t, dirA, { project: "ParA", account: "acct-A", resource: "res-A" });
  await mkManifest(t, dirB, { project: "ParB", account: "acct-B", resource: "res-B" });
  const base = await boot(t);

  const jobs = [];
  for (let i = 0; i < 10; i += 1) {
    const dir = i % 2 === 0 ? dirA : dirB;
    const want = i % 2 === 0 ? "ParA" : "ParB";
    if (i % 3 === 2) {
      jobs.push((async () => {
        const r = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspace: dir }),
        });
        assert.equal(r.status, 200);
        const b = await r.json();
        assert.equal(b.project, want, `plain POST bleed at ${i}`);
        assertSecretFree(b);
      })());
    } else {
      jobs.push((async () => {
        const r = await fetch(`${base}/context?workspace=${encodeURIComponent(dir)}`);
        assert.equal(r.status, 200);
        const b = await r.json();
        assert.equal(b.project, want, `GET bleed at ${i}`);
      })());
    }
  }
  await Promise.all(jobs);
});

// 6. Symlink workspace resolves via realpath.
test("symlink workspace resolves to realpath and finds manifest", async (t) => {
  const real = await mktmp(t, "nexus-edge-real-");
  await mkManifest(t, real, { project: "EdgeLink", account: "link-acct", resource: "link-res" });
  const link = path.join(os.tmpdir(), `nexus-edge-link-${process.pid}-${Date.now()}`);
  t.after(() => fs.rm(link, { recursive: true, force: true }));
  // A junction needs no admin rights on Windows; elsewhere the type is ignored.
  await fs.symlink(real, link, "junction");

  // Unit: readContext-style realpath behaviour (resolveWorkspace passes through;
  // readContext realpaths before reading the manifest).
  const got = await fs.realpath(link);
  assert.equal(got, await fs.realpath(real));

  const base = await boot(t);
  const res = await fetch(`${base}/context?workspace=${encodeURIComponent(link)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ready");
  assert.equal(body.project, "EdgeLink");
  assert.equal(body.workspace, await fs.realpath(real));

  const post = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: link }),
  });
  assert.equal(post.status, 200);
  assert.equal((await post.json()).project, "EdgeLink");
});

// 7. No-git folder ready; git remote mismatch unresolved.
test("no-git workspace with manifest is ready; git remote mismatch is unresolved", async (t) => {
  const base = await boot(t);

  // 7a. Plain folder, no .git, valid manifest -> ready.
  const plain = await mktmp(t, "nexus-edge-nogit-");
  await mkManifest(t, plain, { project: "EdgeNoGit", account: "ng", resource: "ng-res" });
  const r1 = await fetch(`${base}/context?workspace=${encodeURIComponent(plain)}`);
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).status, "ready");

  // 7b. Git repo whose origin differs from declared repo -> unresolved.
  // If the real git CLI is unusable, simulate the observed remote with a PATH shim.
  const repo = await mktmp(t, "nexus-edge-git-");
  let gitOk = true;
  try {
    await execFileAsync("git", ["init"], { cwd: repo });
    await execFileAsync("git", ["config", "user.email", "edge@test.local"], { cwd: repo });
    await execFileAsync("git", ["config", "user.name", "edge"], { cwd: repo });
    try {
      await execFileAsync("git", ["remote", "remove", "origin"], { cwd: repo });
    } catch { /* no origin yet */ }
    await execFileAsync("git", ["remote", "add", "origin", "https://example.com/observed.git"], { cwd: repo });
  } catch {
    gitOk = false;
  }
  let shimDir = null;
  const savedPath = process.env.PATH;
  if (!gitOk) {
    shimDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-edge-gitshim-"));
    t.after(() => fs.rm(shimDir, { recursive: true, force: true }));
    await fs.writeFile(
      path.join(shimDir, "git"),
      "#!/bin/sh\nif echo \"$@\" | grep -q remote; then echo https://example.com/observed.git; exit 0; fi\nif echo \"$@\" | grep -q branch; then echo main; exit 0; fi\nexit 0\n",
      { mode: 0o755 },
    );
    process.env.PATH = `${shimDir}${path.delimiter}${savedPath}`;
    t.after(() => { process.env.PATH = savedPath; });
  }
  await mkManifest(t, repo, {
    project: "EdgeGit",
    account: "g",
    resource: "g-res",
    extra: { repo: "https://example.com/declared-different.git" },
  });
  const r2 = await fetch(`${base}/context?workspace=${encodeURIComponent(repo)}`);
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  assert.equal(b2.status, "unresolved", `want remote-mismatch unresolved, got ${JSON.stringify(b2).slice(0, 300)}`);
  assert.ok(/remote/i.test(b2.reason ?? ""), `reason should mention remote: ${b2.reason}`);
});

// startNexusHttpServer smoke: ephemeral port + /healthz.
test("startNexusHttpServer binds an ephemeral port serving /healthz", async (t) => {
  const { server, port } = await startNexusHttpServer({ port: 0 });
  t.after(() => server.close());
  assert.ok(Number.isInteger(port) && port > 0);
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

// 8. Fail-closed workspace: a request that names no workspace is refused and
// never inherits the Nexus process's own cwd (Notion §7 signals, §8 no silent
// switch). The test process cwd is a real Nexus project, so a regression here
// would hand that project out to any misconfigured agent.
test("no workspace supplied: every entrypoint refuses instead of using the server cwd", async (t) => {
  const base = await boot(t);

  const wants = (body) => {
    assert.equal(body.ok, false);
    assert.equal(body.status, "unresolved");
    assert.equal(body.decision, "block");
    assert.match(body.reason, /which project/i);
    // No project identity of any kind is returned.
    assert.equal(body.project, undefined);
    assert.equal(body.workspace, undefined);
    assert.equal(body.connections, undefined);
    assertSecretFree(body);
  };

  // GET /context and /nexus_context.
  for (const route of ["/context", "/nexus_context"]) {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 400, `${route} should refuse`);
    wants(await res.json());
  }

  // Empty query value counts as not supplied.
  const blank = await fetch(`${base}/context?workspace=`);
  assert.equal(blank.status, 400);
  wants(await blank.json());

  // Plain-JSON POST /mcp fallback with no workspace anywhere.
  const plain = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "there" }),
  });
  assert.equal(plain.status, 400);
  wants(await plain.json());

  // JSON-RPC initialize with no workspace: refused before any server is pinned.
  const init = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "no-ws", version: "1" } } }),
  });
  assert.equal(init.status, 400);
  wants(await init.json());
  assert.equal(init.headers.get("mcp-session-id"), null);

  // Still healthy afterwards.
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});

// 9. An established MCP session stays pinned to the workspace it was created
// with, and does not have to re-send the header on later requests.
test("established session keeps its pinned workspace without re-sending the header", async (t) => {
  const dir = await mktmp(t, "nexus-edge-pinned-");
  await mkManifest(t, dir, { project: "EdgePinned", account: "pin-acct", resource: "pin-res" });
  const base = await boot(t);

  const init = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "X-Nexus-Workspace": dir,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pinned", version: "1" } } }),
  });
  assert.equal(init.status, 200);
  const sessionId = init.headers.get("mcp-session-id");
  assert.ok(sessionId, "initialize should assign a session id");
  await init.text().catch(() => "");

  // Follow-up with the session id but no workspace header: accepted, and still
  // reports the project the session was pinned to.
  const call = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nexus_context", arguments: {} } }),
  });
  assert.equal(call.status, 200);
  const raw = await call.text();
  assert.match(raw, /EdgePinned/, `pinned session lost its project: ${raw.slice(0, 300)}`);
  assert.ok(!/Nexus Guard/.test(raw), "pinned session must not fall back to the server cwd project");
});

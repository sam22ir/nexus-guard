// DNS-rebinding guard: Host and Origin checks run before every route.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { checkLocalRequest } from "./local-origin.mjs";
import { createNexusHttpServer } from "./nexus-http-server.mjs";

async function boot(t, opts = {}) {
  const server = createNexusHttpServer(opts);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return { port, base: `http://127.0.0.1:${port}` };
}

// fetch cannot override Host, so use node:http with an explicit header.
function rawRequest(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
          accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "origin-test", version: "1" } },
};

test("checkLocalRequest allows loopback hosts with or without a port", () => {
  for (const host of ["127.0.0.1", "127.0.0.1:3939", "localhost:3939", "LOCALHOST", "localhost", "[::1]:3939", "[::1]", "::1"]) {
    assert.deepEqual(checkLocalRequest({ host }), { ok: true }, `host ${host} should be allowed`);
  }
});

test("checkLocalRequest refuses foreign or lookalike hosts", () => {
  for (const host of ["evil.example", "evil.example:3939", "127.0.0.1.evil.example", "127.0.0.1.evil.example:3939", "localhost.evil.example", "[::2]:3939", "[::1"]) {
    const verdict = checkLocalRequest({ host });
    assert.equal(verdict.ok, false, `host ${host} should be refused`);
    assert.match(verdict.reason, /this computer \(127\.0\.0\.1\)/);
  }
});

test("checkLocalRequest refuses a missing or empty Host", () => {
  for (const headers of [{}, { host: "" }, { host: "   " }]) {
    const verdict = checkLocalRequest(headers);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /this computer/);
  }
});

test("checkLocalRequest refuses any Origin header, including null and loopback values", () => {
  for (const origin of ["null", "http://127.0.0.1:3939", "http://localhost:3939", "https://evil.example", ""]) {
    const verdict = checkLocalRequest({ host: "127.0.0.1:3939", origin });
    assert.equal(verdict.ok, false, `origin ${JSON.stringify(origin)} should be refused`);
    assert.match(verdict.reason, /web pages/);
  }
});

test("checkLocalRequest allows a request with no Origin", () => {
  assert.deepEqual(checkLocalRequest({ host: "127.0.0.1:3939" }), { ok: true });
});

test("HTTP: a foreign Host is refused with 403 on every route", async (t) => {
  const { port } = await boot(t, { requireSession: false });
  const cases = [
    { method: "GET", path: "/healthz" },
    { method: "GET", path: "/context" },
    { method: "GET", path: "/nexus_context" },
    { method: "POST", path: "/session", body: { workspace: "/tmp" } },
    { method: "POST", path: "/mcp", body: INITIALIZE },
  ];
  for (const c of cases) {
    const res = await rawRequest(port, { ...c, headers: { host: "evil.example" } });
    assert.equal(res.status, 403, `${c.method} ${c.path}`);
    const body = JSON.parse(res.text);
    assert.equal(body.ok, false);
    assert.match(body.error, /this computer/);
  }
});

test("HTTP: a foreign Host with a port is refused too", async (t) => {
  const { port } = await boot(t, {});
  const res = await rawRequest(port, { path: "/healthz", headers: { host: "evil.example:3939" } });
  assert.equal(res.status, 403);
});

test("HTTP: any Origin header is refused on /mcp", async (t) => {
  const { port } = await boot(t, { defaultWorkspace: process.cwd() });
  for (const origin of ["null", "http://127.0.0.1:3939"]) {
    const res = await rawRequest(port, {
      method: "POST",
      path: "/mcp",
      headers: { host: "127.0.0.1:3939", origin },
      body: INITIALIZE,
    });
    assert.equal(res.status, 403, `origin ${origin}`);
    const body = JSON.parse(res.text);
    assert.match(body.error, /web pages/);
  }
});

test("HTTP: the default Host from fetch still reaches /healthz", async (t) => {
  const { base } = await boot(t, {});
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: "nexus-http", transport: "streamable-http" });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeNexusServer } from "./nexus-server.mjs";

const githubTools = [
  { name: "get_file_contents", description: "Read a file", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "search_repositories", description: "Search repos", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Create issue", inputSchema: { type: "object", properties: {} } },
];

async function fixture(t, connections) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-gh-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  await fs.writeFile(path.join(dir, ".nexus", "project.json"), JSON.stringify({
    project: "Koupa", project_id: "koupa", environment: "development", connections,
  }));
  return dir;
}

async function session(t, workspace, log = [], audits = []) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace,
    getToken: async () => "fake-supabase-token",
    connectProvider: async () => ({ listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [{ type: "text", text: "{}" }] }), close: async () => {} }),
    getGithubToken: async (projectId, connectionId) => {
      log.push({ kind: "credential", projectId, connectionId });
      return "fake-github-token";
    },
    connectGithubProvider: async (connection, token) => {
      log.push({ kind: "connect", target: connection.target, token });
      return {
        listTools: async () => ({ tools: githubTools }),
        callTool: async ({ name, arguments: args }) => {
          log.push({ kind: "call", name, args, target: connection.target });
          return { content: [{ type: "text", text: JSON.stringify({ target: connection.target, args }) }] };
        },
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

function body(response) { return JSON.parse(response.content[0].text); }

test("GitHub native: no proxy listing (paper) — forwards via nexus.execute with scoped token", async (t) => {
  const dir = await fixture(t, { github: { target: "saadi/koupa", resource: "saadi/koupa", account: "personal", accountId: "personal-github", connection_id: "koupa-gh", method: "mcp", status: "connected" } });
  const log = [];
  const client = await session(t, dir, log);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert(names.includes("nexus.execute"));
  assert(!names.some((n) => n.startsWith("github__")));
  const ok = await client.callTool({ name: "nexus.execute", arguments: { provider: "github", operation: "get_file_contents", arguments: {} } });
  assert.equal(body(ok).target, "saadi/koupa");
  assert(!JSON.stringify(ok).includes("fake-github-token"));
  assert(log.some((i) => i.kind === "credential" && i.projectId === "koupa" && i.connectionId === "koupa-gh"));
  // Hidden compat proxy still forwards (hide, don't break routing).
  const compat = await client.callTool({ name: "github__get_file_contents", arguments: {} });
  assert.equal(body(compat).target, "saadi/koupa");
});

test("GitHub native: cross-target and writes block before provider", async (t) => {
  const dir = await fixture(t, { github: { target: "saadi/koupa", resource: "saadi/koupa", account: "personal-github", connection_id: "koupa-gh", method: "mcp", status: "connected" } });
  const log = [];
  const audits = [];
  const client = await session(t, dir, log, audits);
  const cross = await client.callTool({ name: "nexus_execute", arguments: { provider: "github", operation: "get_file_contents", arguments: { target: "saadi/other" } } });
  assert.equal(cross.isError, true);
  assert.equal(body(cross).decision, "block");
  const write = await client.callTool({ name: "github__create_issue", arguments: {} });
  assert.equal(write.isError, true);
  assert.equal(body(write).decision, "block");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  assert(audits.some((a) => a.provider === "github"));
});

// Firebase has no service address in mcp/services.json, so it stays fail-closed.
test("Curated passthrough: a service with no address requires approval without provider contact", async (t) => {
  const dir = await fixture(t, { firebase: { target: "koupa-fb", resource: "koupa-fb", account: "personal", connection_id: "koupa-firebase", method: "mcp", status: "connected" } });
  const log = [];
  const audits = [];
  const client = await session(t, dir, log, audits);
  const res = await client.callTool({ name: "nexus_execute", arguments: { provider: "firebase", operation: "search", arguments: {} } });
  assert.equal(res.isError, true);
  assert.equal(body(res).decision, "approval_required");
  assert.equal(log.filter((i) => i.kind === "call").length, 0);
  assert(audits.some((a) => a.provider === "firebase" && a.decision === "approval_required"));
  assert(!JSON.stringify(res).includes("fake-github-token"));
});

// The server reads a GitHub token through the nexus-keyring helper, which only
// accepts "<supabase|github> <project-id> <connection-id>". A fake helper here
// pins that argument contract end to end through the default token reader.
test("GitHub native: default token reader asks nexus-keyring for 'github <project> <connection>'", { skip: process.platform === "win32" }, async (t) => {
  const dir = await fixture(t, { github: { target: "saadi/koupa", resource: "saadi/koupa", account: "personal", accountId: "personal-github", connection_id: "koupa-gh", method: "mcp", status: "connected" } });
  const argsFile = path.join(dir, "helper-args.txt");
  const helper = path.join(dir, "fake-keyring.sh");
  await fs.writeFile(helper, `#!/bin/sh\necho "$@" > "${argsFile}"\n[ "$1" = "github" ] && printf '{"accessToken":"token-from-helper"}' || exit 2\n`, { mode: 0o755 });
  const previous = process.env.NEXUS_KEYRING_BIN;
  process.env.NEXUS_KEYRING_BIN = helper;
  t.after(() => { if (previous === undefined) delete process.env.NEXUS_KEYRING_BIN; else process.env.NEXUS_KEYRING_BIN = previous; });

  const seen = [];
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({
    workspace: dir,
    getToken: async () => "unused",
    connectProvider: async () => ({ listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [] }), close: async () => {} }),
    connectGithubProvider: async (connection, token) => {
      seen.push(token);
      return { listTools: async () => ({ tools: githubTools }), callTool: async () => ({ content: [{ type: "text", text: "{}" }] }), close: async () => {} };
    },
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });

  await client.callTool({ name: "nexus.execute", arguments: { provider: "github", operation: "get_file_contents", arguments: {} } });
  assert.equal((await fs.readFile(argsFile, "utf8")).trim(), "github koupa koupa-gh");
  assert.deepEqual(seen, ["token-from-helper"]);
});

// GitHub tools address a repository with owner + repo (or "owner/repo"), not
// with target/resource. Nexus must hold the agent to this project's repository
// itself, whatever the token can reach.
test("GitHub native: a different repository named in arguments is blocked before the provider", async (t) => {
  const dir = await fixture(t, { github: { target: "saadi/koupa", resource: "saadi/koupa", account: "personal", accountId: "personal-github", connection_id: "koupa-gh", method: "mcp", status: "connected" } });
  const log = [];
  const audits = [];
  const client = await session(t, dir, log, audits);
  const call = (operation, args) => client.callTool({ name: "nexus.execute", arguments: { provider: "github", operation, arguments: args } });

  for (const args of [
    { owner: "saadi", repo: "other" },
    { owner: "someone-else", repo: "koupa" },
    { repo: "saadi/other" },
    { owner: "someone-else" },
  ]) {
    const res = await call("get_file_contents", args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.equal(body(res).decision, "block", JSON.stringify(args));
  }
  assert.equal(log.filter((i) => i.kind === "call").length, 0, "no blocked call may reach GitHub");
  assert(audits.some((a) => a.reason === "cross-project target"));

  // The bound repository still works, however it is spelled.
  for (const args of [{ owner: "saadi", repo: "koupa" }, { owner: "SAADI", repo: "Koupa" }, { repo: "saadi/koupa" }, { owner: "saadi" }, {}]) {
    const ok = await call("get_file_contents", args);
    assert.notEqual(ok.isError, true, JSON.stringify(args));
  }
  // The hidden github__ proxy is held to the same rule.
  const proxied = await client.callTool({ name: "github__get_file_contents", arguments: { owner: "saadi", repo: "other" } });
  assert.equal(proxied.isError, true);
});

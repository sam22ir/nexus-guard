// Agent identity + session stability (Home topology "who's doing what").
// - The MCP client name declared in the initialize handshake is recorded on
//   every audit entry as `agent` (display only — never routing or policy).
// - Over HTTP, one agent (MCP) session keeps one Nexus audit session across
//   its requests instead of a fresh random session per call.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeNexusServer } from "./nexus-server.mjs";
import { createNexusHttpServer } from "./nexus-http-server.mjs";

async function unresolvedWorkspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-agent-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // .nexus/ exists (so the audit log is writable) but no project.json → unresolved.
  await fs.mkdir(path.join(dir, ".nexus"), { recursive: true });
  return dir;
}

test("stdio: declared client name is recorded on audit entries", async (t) => {
  const dir = await unresolvedWorkspace(t);
  const audits = [];
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = makeNexusServer({ workspace: dir, onAudit: (entry) => audits.push(entry) });
  const client = new Client({ name: "agent-identity-probe", version: "0.0.1" }, { capabilities: {} });
  await server.connect(serverSide);
  await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });

  const res = await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  assert.equal(res.isError, true);
  assert.ok(audits.length >= 1, "expected at least one audit entry");
  for (const entry of audits) {
    assert.equal(entry.agent, "agent-identity-probe");
  }
  assert.ok(!JSON.stringify(audits).includes("fake-token"));
});

test("http: one agent session keeps one Nexus session across requests", async (t) => {
  const dir = await unresolvedWorkspace(t);
  const httpServer = createNexusHttpServer();
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  t.after(() => httpServer.close());
  const { port } = httpServer.address();
  const base = `http://127.0.0.1:${port}`;

  const transport = new StreamableHTTPClientTransport(
    new URL(`${base}/mcp?workspace=${encodeURIComponent(dir)}`),
  );
  const client = new Client({ name: "http-session-probe", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  t.after(() => client.close());

  await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });
  await client.callTool({ name: "nexus_execute", arguments: { provider: "supabase", operation: "list_tables", arguments: {} } });

  const lines = (await fs.readFile(path.join(dir, ".nexus", "audit.log"), "utf8")).trim().split("\n");
  assert.ok(lines.length >= 2, `expected two audit lines, got ${lines.length}`);
  const entries = lines.map((line) => JSON.parse(line));
  const sessions = new Set(entries.map((entry) => entry.session));
  assert.equal(sessions.size, 1, `expected one stable Nexus session, got ${[...sessions].join(",")}`);
  for (const entry of entries) {
    assert.equal(entry.agent, "http-session-probe");
  }
});

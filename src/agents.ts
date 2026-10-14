import { nexusHttpUrlFor } from "./onboarding";

/** One list of the agents Nexus knows, shared by the first-run wizard, the
 *  Connect modal and the Agents view, so they cannot drift apart again.
 *
 *  `connect: "auto"` means the desktop app can write the entry itself
 *  (connect_agent_to_project). `"manual"` means the user pastes a snippet:
 *  there is no native writer for that agent yet, so no Connect button. */
export type AgentInfo = {
  id: string;
  name: string;
  /** Config file the entry lands in, relative to the project folder. */
  file: string;
  connect: "auto" | "manual";
  /** The agent asks the user to approve a new project MCP server. Skipping that prompt means it never connects. */
  trustPrompt: string | null;
  /** What to do after the entry is written. */
  restart: string;
  /** Most likely cause when no call arrives, shown after a wait. */
  stuckHint: string;
  /** Shown when two agents share a file. */
  note?: string;
};

export const AGENTS: readonly AgentInfo[] = [
  {
    id: "claude", name: "Claude Code", file: ".mcp.json", connect: "auto",
    trustPrompt: "Claude Code asks whether to trust the “nexus” server. Choose yes.",
    restart: "Restart Claude Code in this folder.",
    stuckHint: "Run /mcp in Claude Code. If “nexus” is listed as pending or disabled, approve it. If it is missing, restart Claude Code from this project folder.",
  },
  {
    id: "codex", name: "Codex", file: ".codex/config.toml", connect: "auto",
    trustPrompt: null,
    restart: "Restart Codex in this folder.",
    stuckHint: "Codex only reads this file when it starts inside the project folder, and may need the project marked as trusted. Restart it from here.",
  },
  {
    id: "opencode", name: "OpenCode", file: "opencode.json", connect: "auto",
    trustPrompt: null,
    restart: "Restart OpenCode in this folder.",
    stuckHint: "Restart OpenCode from the project folder so it re-reads opencode.json.",
  },
  {
    id: "pi", name: "Pi", file: ".mcp.json", connect: "auto",
    trustPrompt: null,
    restart: "Restart Pi in this folder.",
    stuckHint: "Restart Pi from the project folder so it re-reads .mcp.json.",
    note: "Pi and Claude Code share .mcp.json, so one Nexus entry serves both.",
  },
  {
    id: "cursor", name: "Cursor", file: ".cursor/mcp.json", connect: "manual",
    trustPrompt: null,
    restart: "Reload the Cursor window.",
    stuckHint: "Open Cursor's MCP settings and check that “nexus” is switched on.",
  },
  {
    id: "gemini", name: "Gemini CLI", file: ".gemini/settings.json", connect: "manual",
    trustPrompt: null,
    restart: "Restart Gemini CLI in this folder.",
    stuckHint: "Run /mcp in Gemini CLI to see whether “nexus” is listed, and restart it from the project folder.",
  },
];

export const agentById = (id: string | null | undefined) => AGENTS.find((a) => a.id === id) ?? null;

/** What to paste for an agent that has no native writer. Formats checked against
 *  each tool's docs (Cursor: `url` in .cursor/mcp.json; Gemini CLI: `httpUrl` in
 *  .gemini/settings.json); the app's own checks do not exercise them. */
export function manualSnippet(agentId: string, workspace: string): string {
  const url = nexusHttpUrlFor(workspace);
  if (agentId === "gemini") return JSON.stringify({ mcpServers: { nexus: { httpUrl: url } } }, null, 2);
  if (agentId === "cursor") return JSON.stringify({ mcpServers: { nexus: { url } } }, null, 2);
  return JSON.stringify({ mcpServers: { nexus: { type: "http", url } } }, null, 2);
}

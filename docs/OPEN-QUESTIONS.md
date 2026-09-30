# Nexus Guard — open questions

**Source of truth:** Notion “Nexus — Product & Technical Strategy” §10 (paper is the single source of truth; mirrored 2026-09-30 from the 2026-09-29 version).
**Rule:** nothing here is decided. Each item needs an owner decision before it becomes a row in [DECISIONS](DECISIONS.md).

## Needs a decision

| # | Question | Context |
| --- | --- | --- |
| 1 | Default for Curated and Self-added services without Guard: pass freely, or stay fail-closed? | Current build is fail-closed; native Supabase/GitHub allowlists stay either way |
| 2 | Final list of ~50 catalog services | §13 list is a proposal pending review |
| 3 | Vault lock semantics: document current behavior, or specify a real encrypted vault with enforced fail-closed lock? | Lock gates only frontend reads/writes; see [vault-lock-behavior](vault-lock-behavior.md) |
| 4 | Narrow-window layout: any exception to the no-whole-page-scroll rule? | Collapse-to-scroll behavior was never approved; re-test across a range of sizes |
| 5 | Isolation level for forwarded services | Curated/Self-added give account-level isolation only; an agent could name another resource inside the same account |

## Needs verification

| # | Item | Context |
| --- | --- | --- |
| 1 | **Blocking:** how Nexus learns each agent's working directory over one shared HTTP instance | Verify per agent. **Claude Code 2.1.284 verified 2026-09-30:** declares `roots` and answers `roots/list` with its launch directory; it sends no cwd header. Nexus now binds from a single root when no explicit workspace is sent, and refuses none/several/changed roots (`mcp/roots-fallback.test.mjs`). **OpenCode 2.0.19 verified 2026-09-30:** declares `roots` (without `listChanged`) and answers `roots/list` with its launch directory. **Codex 0.159.2 verified 2026-09-30:** does NOT declare `roots` (it answered an unsolicited `roots/list` with an empty list), so Nexus refuses it unless the workspace is pinned via `?workspace=` or `X-Nexus-Workspace`, as `.codex/config.toml` does. **Still unverified:** a full agent turn for any client, and subdirectory launches |
| 2 | Stdio bridges: which side do they run on? | Agent→Nexus must be HTTP only; Nexus→provider stdio servers are allowed |
| 3 | MCP availability per catalog entry, and an owner for maintenance | Every catalog service needs a working MCP server before it ships |

## Design questions

1. Best shell for the local runtime: daemon, desktop app, or CLI-only?
2. How much transparent protection is achievable for agents that are not Nexus-aware?
3. What is the minimum useful activity record without noise?
4. Where is the line between deterministic rules and any future contextual layer?

Guard-related questions (tray support, cost axis, bulk magnitude) live in paper §14.

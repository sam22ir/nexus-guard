# Nexus Guard — approval-store lock behavior (legacy “vault” screen)

**Status:** scaffold behavior, not a security claim. “Vault” is a legacy term;
the paper positions Nexus as Registry + approval store, not a vault (see
[OPEN-QUESTIONS](OPEN-QUESTIONS.md) #3, #9).

## Frontend: in-memory gate (`src/vault.ts`)

- `unlocked` lives in module state only — a page reload re-locks by design.
- Typed-key helpers require an unlocked session; the UI re-verifies saved-key
  badges after each unlock and reconciles persisted `keySaved` flags.
- `mcp:*` token helpers intentionally bypass the gate: tokens saved via an
  in-session browser approval carry the user's intent, so no app-session gate
  applies there.

## HTTP bridge: fail-closed with carve-outs (`mcp/nexus-http-server.mjs`)

- When lock enforcement is on, a locked state refuses agent `/mcp` calls with
  HTTP `423` (`decision: "block"`) until the desktop app unlocks.
- Carve-outs that stay available while locked: `GET /healthz` and safe
  `GET /context` (connection identity only, no credentials).
- `DELETE` (MCP session teardown) is allowed while locked so clients can
  clean up sessions.
- A missing or damaged state file counts as locked.

## stdio bridge: bypasses the lock

- Direct stdio bridges (`mcp/nexus-server.mjs`, one process per project
  folder) do not share the desktop lock state and bypass it entirely.
- stdio is archived, not supported — deprecated and gated behind
  `NEXUS_ALLOW_STDIO=1` for one release. Use the HTTP endpoint wherever lock
  enforcement matters. See [mcp/README](../mcp/README.md) appendix.

## Real-vault options (not decided)

- OS keychain today (Linux secret service / macOS keychain / Windows
  credential store) via the `nexus-keyring` helper; same-UID shell can read
  it, so it is not a barrier against an untrusted local agent.
- Open: whether typed keys, OAuth/MCP approvals, and curated/self-added-provider tokens
  share one store or split; auto-lock policy; headless/CI behavior; uninstall
  wiping. Needs an owner decision before MVP.

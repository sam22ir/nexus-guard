# Nexus MCP bridge (Notion-aligned)

Source of truth: Notion “Nexus — Product & Technical Strategy” §§3,6,7.

> HTTP only supported. Every gate below must be re-run over HTTP before it
> counts toward MVP (see [feasibility](../docs/FEASIBILITY.md)); stdio-era
> evidence does not count.

Nexus connects Codex to an existing provider MCP server. It does **not** rewrite each provider tool. When Codex lists tools, Nexus asks the provider, passes through name/description/input, and prefixes usability aliases (`supabase__list_tables`). Execution always terminates inside Nexus (`Agent → Nexus → Provider → Nexus → Agent`).

Canonical agent surface (§6) — dotted is canonical, listed:

- `nexus.context` — project/session/environment + safe resources. No secrets.
- `nexus.request_access` — request one scoped capability. Returns allow / block. No credential.
- `nexus.execute` — perform one protected operation through Nexus.
- Underscore spellings (`nexus_context`, `nexus_request_access`, `nexus_execute`) are hidden compat aliases: callable, never listed, kept for one release for strict clients.
- Legacy aliases `nexus_get_project_context`, `nexus_check_target` are deprecated: callable, never listed, kept for one release.
- Usability aliases kept: `supabase__*`, `github__*` → same policy path as `nexus.execute`.
  Any other `<provider>__*` resolves through the self-added passthrough (approval_required, no provider contact).

Native (`mcp/providers.mjs`): Supabase + GitHub are reviewed operation-by-operation.
The server reads approvals through the `nexus-keyring` helper (`nexus-keyring <supabase|github> <project-id> <connection-id>`), which looks up the OS-keychain entry `mcp:<provider>:<project-id>:<connection-id>` and prints its JSON (`accessToken` or `token`). The desktop app writes the Supabase entry after browser approval and the GitHub entry after the GitHub device-flow approval ([setup](../docs/github-app-setup.md)). For GitHub, the helper also renews an expiring token before printing it.

GitHub read-only allowlist: `search_*`, `get_*`, `list_*` repo/issue/PR/workflow reads; writes
(`create_*`, `update_*`, deletes) blocked by deterministic policy. GitHub upstream URL is
`NEXUS_GITHUB_MCP_URL` (default `https://api.githubcopilot.com/mcp` — verify against your
deployment); token read via keychain `github <projectId> <connectionId>`.

Self-added by default, curated when explicitly listed (`mcp/providers.mjs` + `approvedCurated`): any other bound provider
defaults every operation to `approval_required` until reclassified — fail-closed, never silent
allow. Unknown providers read as `self-added` (not curated); enforcement is identical either way. Overrides (`service->tag->default`) can tighten to `always-block`. Block never disconnects.

Only Supabase + GitHub are native in this scaffold. Read-only allowlists only; writes blocked by deterministic policy. Supabase URL uses `project_ref` + `read_only=true`.

Session (§6): the server creates one MCP session per agent connection at `initialize` and re-validates context on every request. Registering needs only the workspace (`?workspace=` or `X-Nexus-Workspace`); the workspace pin gates access. Optional workspace-bound opaque tokens can still be minted via `POST /session` (~30min sliding TTL): when sent as `X-Nexus-Session`, a missing or expired token → `401` and cross-workspace use → `403`. The standalone server does not require them (`ENTRY_OPTIONS.requireSession` is `false`); `createNexusHttpServer({ requireSession: true })` enforces them for tests and stricter embeds.

```bash
# Optional: mint (workspace-bound) → use → revoke. Port follows NEXUS_HTTP_PORT (default 3939).
curl -s -X POST 127.0.0.1:3939/session -H 'content-type: application/json' \
  -d '{"workspace":"/tmp/nexus-e2e/a"}'
# → {"ok":true,"token":"<opaque>","expiresAt":<ms>,"workspace":"/tmp/nexus-e2e/a"}
curl -s '127.0.0.1:3939/context?workspace=/tmp/nexus-e2e/a' \
  -H "X-Nexus-Session: <opaque>" -H "X-Nexus-Workspace: /tmp/nexus-e2e/a"
curl -s -X DELETE 127.0.0.1:3939/session -H 'content-type: application/json' \
  -d '{"session":"<opaque>"}'
# → {"ok":true,"revoked":true}
```

Policy (§3): low reads auto-allowed via Nexus; medium/high writes blocked by default (production explicit). Every decision activity-logged secret-free (`session, project, environment, resource, operation, decision`).

Guard is post-MVP (paper §14; possible paid feature): `GUARD_ENABLED=false` in MVP, so overrides, cost-bearing escalation, and escape-hatch reasoning are ignored and routing stays intact (read-allow/block). Enforcement code in `mcp/guard-policy.mjs` is kept, never deleted, for the paid tier (`GUARD_ENABLED=1` is paid-tier dev only).

Refresh: `getToken` + optional `refreshToken(projectId, connectionId)` hook. One retry, else `approval_required`. Never leak tokens/URLs to agent output.

## Project setup

Agents reach one persistent local Nexus over HTTP:

- URL: `http://localhost:<port>/mcp` (`NEXUS_HTTP_PORT`, default 3939).
  Start it with `NEXUS_HTTP_PORT=3939 node mcp/nexus-http-server.mjs`.
- DNS-rebinding guard (`mcp/local-origin.mjs`) runs before every route: the `Host` header must be `127.0.0.1`, `localhost` or `[::1]` (with or without a port), and any `Origin` header is refused. Refusals are `403` with a plain reason; web pages cannot reach Nexus.
- Workspace is pinned per request (`X-Nexus-Workspace` header or
  `?workspace=` query). Two sessions never share mutable current project.
- **A request that names no workspace is refused** (`400`, `status: unresolved`).
  Nexus never falls back to the directory it was started in — otherwise a single
  global registration would hand every agent whatever project the server happens
  to be running from. Register Nexus per project so each agent sends its own
  workspace; the desktop app (Accounts → Agents) writes that project's path into the agent's
  own config. An established MCP session stays pinned to the workspace it was
  created with and does not have to resend the header.
- The local server runs only while the desktop app is open; the desktop app starts
  and stops it. There is no vault lock and no state file: agent requests are not
  refused for being locked. Stdio bridges are archived (see appendix); use the HTTP endpoint.
- Workspace discovery: an explicit `X-Nexus-Workspace` header or `?workspace=` always wins. Without one, a client that declares the MCP `roots` capability is bound at its first tool call from its single `file://` root; zero, several, or later-changed roots are refused, never guessed. Clients without roots must send the workspace. Under `requireSession` the agent still needs a session token, which is minted for a workspace.
- Routing resolves the binding (provider→account→resource). Post-MVP Guard
  would decide the operation, never on a bare service name.

Register the endpoint with the agent CLI — this is the preferred path
(adjust the port to match `NEXUS_HTTP_PORT`):

```bash
# Run inside the project folder. The registration must carry that project's
# path as X-Nexus-Workspace, or requests are refused at call time.
claude mcp add --transport http nexus http://localhost:3939/mcp \
  --header "X-Nexus-Workspace: $PWD"
codex mcp add nexus --url "http://localhost:3939/mcp?workspace=$PWD"
```

Register per project, not once globally: the workspace is what tells Nexus which
project the agent is in, so each project needs its own entry. Verify each CLI's
own flag for custom headers before relying on it — where an agent has no header
support, the `?workspace=` query form above carries the same value, and the
desktop app (Accounts → Agents) writes the config entry directly. A registration with neither
is refused rather than silently defaulted.

Live test before use: `GET http://localhost:3939/healthz` should return
`{"ok":true,…}`, and `GET http://localhost:3939/context?workspace=<path>`
returns the safe connection identity (no secrets). The desktop app (Accounts → Agents)
probes the same `/healthz` and reports `httpReachable` per agent, and lists
existing direct MCP entries that do not match the Nexus HTTP URL as
`found,unmanaged`.

## Appendix (archived): legacy stdio fallback

stdio is archived, not supported — deprecated and gated behind
`NEXUS_ALLOW_STDIO=1` for one release, then removed. The notes below are
history only — every pass must be re-run over HTTP before it counts
toward MVP (see [feasibility](../docs/FEASIBILITY.md)).

One process per project folder, only ever for agents with no HTTP transport. The desktop shows a diff, asks for confirmation,
writes a timestamped backup (`<config>.bak.<nanos>`) before editing, and
re-runs the live test afterwards. `cwd` pins the
project. Importing an unmanaged slot writes a Nexus HTTP entry with the same
backup + diff summary; removing a direct entry also backs up first and
returns what was removed. Confirm in the UI before either edit — unknown
entries are never silently re-routed. Copy MCP settings from
[`../.codex/config.toml`](../.codex/config.toml), set `cwd`, build helper
with `cargo build --manifest-path src-tauri/Cargo.toml --bin nexus-keyring`,
restart Codex. stdio-era evidence must be re-run over HTTP before it
counts toward MVP (see [feasibility](../docs/FEASIBILITY.md)).

Context resolution (Notion §7, most → least authoritative): `.nexus/project.json` → previously verified mapping (per-process fingerprint; any change forces re-verification) → Git remote/branch cross-check → auto-discovery hints → agent intent (never sufficient; tool args cannot switch workspace).

`repo`/`branch` in the manifest are optional. When declared and the folder is a git checkout, a remote or branch mismatch fails closed with an explicit confirmation-required reason. Folders without git rely on manifest + verified mapping. Unresolved responses include observed git signals to aid registration — discovering never creates a project.

Non-secret `.nexus/project.json` (canonical per Notion 2026-09-27:
`{account, resource}` per service):

```json
{
  "project": "Koupa",
  "project_id": "koupa",
  "environment": "development",
  "connections": {
    "supabase": {
      "account": "personal",
      "resource": "koupa-development",
      "connection_id": "the-id-shown-on-the-desktop-connections-page",
      "project_ref": "abcdefghijklmnop",
      "method": "mcp",
      "status": "connected"
    }
  }
}
```

`project_id` must match desktop internal ID. Back-compat: the bridge
still reads `target` as an alias of `resource`, and still keys provider
auth on `connection_id` + `project_ref` — keep those fields. `account` is
canonical and enforced: `account`/`accountId`/`account_id` are normalized at
top level and per connection (per-connection wins), and any requested
`account`/`accountId`/`account_id`/`target`/`resource` — top-level or nested
under `arguments` — must match the configured binding before any token or
network use, else the call blocks as cross-account/cross-project.
`target`/`resource` aliases kept for migration. Desktop writes this file on
save. Never contains credentials.
`.nexus/` is gitignored; `.nexus/audit.log` is the best-effort local activity log.

OpenCode runs beside Codex with the same bridge: [`../opencode.json`](../opencode.json) defines the workspace-bound `nexus-http` remote entry (`http://127.0.0.1:3939/mcp?workspace=<repo path>` + `X-Nexus-Workspace` header). The legacy local `nexus` stdio server entry is removed. The direct `supabase-direct-unmanaged` remote entry is for admin use only and is **unmanaged** — agent work should go through `nexus-http` so Nexus stays in the path.

Claude Code and Pi agent share one config: [`../.mcp.json`](../.mcp.json) defines the workspace-bound Nexus HTTP remote. For another project folder, register per project with its own workspace value and restart the agent. Trust the project folder when prompted — untrusted project MCP definitions are not loaded. Prefer the HTTP endpoint above where the agent supports it.

## Limits

- Real-Supabase evidence exists but is stdio-era (see
  [feasibility](../docs/FEASIBILITY.md)); HTTP-era end-to-end is still
  pending and stdio passes must be re-run over HTTP.
- Manifest not independently verified vs desktop/Git. Editable file can claim another project — conflicts must ask, never silently guess (Notion §7).
- Keychain helper readable by same-UID shell. **Not a barrier vs untrusted local agent.**
- Direct provider MCP/CLI/browser outside Nexus is **unmanaged**, not protected.
- Per-provider safety policy required before new providers.

## Local test

`npm run test:mcp` (`node --test mcp/*.test.mjs` — 9 files, 80 cases):
discovery, forwarding, isolation, write-block, no-manifest, file-change
block, canonical surface (`nexus.context` / `nexus.request_access` / `nexus.execute`; underscore + legacy aliases hidden compat), secret-free audit,
refresh hook, account scoping (aliases, cross-account/cross-project block,
no top/nested masking, mid-session account change), GitHub native,
self-added fail-closed (curated when explicitly listed), HTTP multiplexing incl. workspace-bound sessions. Fake tokens only. HTTP-era
end-to-end against a live server is still pending (see
[VALIDATION-HTTP](../docs/VALIDATION-HTTP.md)) — unit suites do not check
those gates.

## Settings folder

Write grants, binding scopes and custom services live in the app's own
settings folder, never in a project folder, so an agent confined to its
workspace cannot change them. `mcp/config-dir.mjs` and `nexus_config_dir` in
`src-tauri/src/lib.rs` pick the same folder:

| System | Folder |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/nexus-guard`, else `~/.config/nexus-guard` |
| macOS | `~/Library/Application Support/nexus-guard` |
| Windows | `%APPDATA%\nexus-guard` |

`NEXUS_CONFIG_DIR` overrides it. The desktop app always sets it for the server
it starts, so the app and the server cannot disagree.

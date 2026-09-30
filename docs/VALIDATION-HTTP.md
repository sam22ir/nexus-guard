# Nexus Guard — HTTP-era validation checklist

**Source:** Notion “Nexus — Product & Technical Strategy” §§5,9 + `docs/FEASIBILITY.md` (stdio-era evidence, must re-run over HTTP).
**Scope:** single persistent `http://localhost:3939/mcp` (see `mcp/nexus-http-server.mjs`), Supabase and GitHub native adapters, disposable test projects first. No production writes.
**Rule:** a checked gate needs recorded command/config, OS/version, expected vs observed, short verdict. Docs don't check gates.

## Prerequisites

- `npm run build` passes; `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- Baseline suites: `npm run test:mcp` (34), `cargo test --manifest-path src-tauri/Cargo.toml --lib` (12), `cargo test --manifest-path prototype/nexus-check/Cargo.toml` (15).
- HTTP server: `NEXUS_HTTP_PORT=3939 node mcp/nexus-http-server.mjs` (or `startNexusHttpServer`), `curl 127.0.0.1:3939/healthz` → `{ok:true}`.
- Two temp workspaces with canonical manifests: `/tmp/nexus-e2e/{a,b}/.nexus/project.json` → `{project, project_id, environment, connections:{supabase:{account, resource, connection_id, project_ref, method:"mcp", status:"connected"}}}` with distinct `account+resource`.
- HTTP sessions are workspace-bound opaque tokens: mint via `POST /session`, send `X-Nexus-Session` + `X-Nexus-Workspace` on `/mcp` + `/context`, expect `401` on missing/expired and `403` on cross-workspace use, revoke via `DELETE /session`. Tokens live ~30min with sliding expiry (each validated request extends).

```bash
# Mint a workspace-bound session (returns { ok:true, token, expiresAt, workspace }).
curl -s -X POST 127.0.0.1:3939/session \
  -H 'content-type: application/json' \
  -d '{"workspace":"/tmp/nexus-e2e/a"}'
# → {"ok":true,"token":"<opaque>","expiresAt":<ms>,"workspace":"/tmp/nexus-e2e/a"}

# Use it: session + workspace on /context and /mcp.
curl -s '127.0.0.1:3939/context?workspace=/tmp/nexus-e2e/a' \
  -H "X-Nexus-Session: <opaque>" -H "X-Nexus-Workspace: /tmp/nexus-e2e/a"
# Cross-workspace token use → 403 block; expired/unknown token → 401 block.

# Revoke when done.
curl -s -X DELETE 127.0.0.1:3939/session \
  -H 'content-type: application/json' \
  -d '{"session":"<opaque>"}'
# → {"ok":true,"revoked":true}
```

## Gates (fail closed, no silent guess)

### 1. Multi-session isolation on one server
- [ ] `GET /context?workspace=/tmp/nexus-e2e/a` (+ `X-Nexus-Session` minted for A) → project A + `account/resource` A; `?workspace=/tmp/nexus-e2e/b` (+ session for B) → B. Parallel curls, no bleed.
- [ ] Two MCP clients over `POST /mcp?workspace=` simultaneously, each with its own `POST /session` token sent as `X-Nexus-Session`: A→`list_tables` resolves A resource, B→B resource. Record `session` IDs differ, `resource` correct. Cross-workspace token reuse → `403`.
- [ ] Tool arg switch rejected: `nexus.execute` with `workspace_path/project_ref/project_id/connection_id` → `block`.

### 2. Account scoping (Notion §2 chain)
- [ ] `nexus.request_access` with `target` = other account's resource → `block cross-project/account` before provider.
- [ ] `nexus.execute` cross-account → `block`, activity log has `decision:block, reason:cross-*`.
- [ ] Mid-session `.nexus/project.json` account change → next call `unresolved … confirmation required`, no silent switch (fingerprint includes account).
- [ ] Shared account across 2 projects → `detectBlastRadius` flags it (UI Services warning). Visible, deliberate.

### 3. Git/repo/branch re-verification (§7)
- [ ] Declared `repo` vs observed remote mismatch → `unresolved`, no mediated op.
- [ ] Branch switch (dev→feature) → `block confirmation required`; restore → `ready`.
- [ ] No-git folder → manifest + verified mapping only; missing manifest → `unresolved` with observed signals.

### 4. Guard tiers + overrides — POST-MVP (paper §14; `GUARD_ENABLED=false`; central table in `mcp/guard-policy.mjs`)
- [ ] Low read (`list_tables`) → `allow` (still via Nexus, audited).
- [ ] Unmapped op → `approval_required` (fail closed, never silent allow).
- [ ] Write/destructive in `production` → `block`; in `development` → `approval_required`.
- [ ] `costBearing:true` read → escalated to `approval_required` + warning.
- [ ] Escape hatch without reason → `block`; with reason → `allow` + audited.
- [ ] Overrides `service→tag→default`: service wins, then tag, then default; `always-block` shows itemized list; `block` keeps connection (`disconnect:false`); `auto-approve` still audited.

### 5. Token lifecycle (live keychain, fake-safe first)
- [ ] Unknown/revoked `projectId/connectionId` → `approval_required`, no fallback to another account, no secret in output.
- [ ] Broken helper (offline keychain) → `block unavailable`, explicit retry path.
- [ ] Refresh hook: one retry, else `approval_required`. Natural expiry noted if unobserved.

### 6. Agents CLI-first + import (§6)
- [ ] `claude mcp add --transport http nexus http://localhost:3939/mcp` + `codex mcp add nexus --url http://localhost:3939/mcp` → `detect_agents.http_reachable:true`, live `/context` ok before `Connected`.
- [ ] Existing direct `supabase` entry → `found,unmanaged`; import with backup `<config>.bak.<nanos>` + diff; remove-with-confirm; unknown provider stays visible.
- [ ] `opencode.json`: `nexus-http` remote works; `supabase-direct-unmanaged` treated as bypass.

### 7. Routing coverage + bypass honesty (Guard parts post-MVP)
- [ ] Through Nexus: correct-target allow, cross-target deny, ambiguous deny, one-op approval where permitted.
- [ ] Outside Nexus: direct provider CLI, direct MCP, browser action → recorded as `unmanaged`, never “protected”. UI/activity distinguishes `allowed/denied/approval_required/unmanaged`.

### 8. UX smoke (no fake coverage)
- [ ] Home shows live sessions/pending/merged feed (empty states ok, no fabricated rows).
- [ ] Bindings = per-project `account+resource`; Services = global registry; Guard Rules show vocab + overrides.
- [ ] Onboarding register→link→connect→prove ends with live `inspect_project_folder` result (`nexus_connections` shown).
- [ ] Quick-approve: pending lives in Home; no tray verdicts (per `/tmp/opencode/nexus-tray-feasibility.md`); expiry would be `deny/expired` audited.

## Evidence log

| Gate | OS / version | Command + observed | Verdict |
| --- | --- | --- | --- |
| suites | | `npm run test:mcp` 34/34; lib 12/12; proto 15/15 | Pass (automated) |
| HTTP suites 2026-09-29 | Linux Mint 22 (6.8.0-110-generic) / node v26.3.0 / rustc 1.96.0 | `npm run test:mcp` 86/86 pass; `cargo test --manifest-path src-tauri/Cargo.toml` lib 24 pass + edge 22 pass. Bridge `NEXUS_HTTP_PORT=3939 NEXUS_VAULT_STATE_FILE=/tmp/nexus-e2e/vault.json (unlocked test vault; real vault untouched) node mcp/nexus-http-server.mjs`; `curl 127.0.0.1:3939/healthz` → `{ok:true,service:nexus-http}` | Pass |
| HTTP isolation 2026-09-29 | same as above | Temp manifests `/tmp/nexus-e2e/{a,b}/.nexus/project.json` (e2e-a/acct-a/res-a/conn-a/ref-a vs e2e-b/acct-b/res-b/conn-b/ref-b). `POST /session` → A `cae3190b-…`, B `8828f57f-…` (distinct). `GET /context?workspace=` A→project e2e-a/acct-a/res-a, B→e2e-b/acct-b/res-b; parallel `POST /mcp` tools/call nexus.context → same, no bleed. A-token on B → 403 block; no token → 401. nexus.execute with workspace_path/project_ref/project_id/connection_id args → all 4 block `Calls cannot switch project or connection`. Session revoke: DELETE /session → `{ok:true,revoked:true}`; reuse → 401 revoked:true; re-revoke → 404 | Pass |
| HTTP account 2026-09-29 | same as above | From A: request_access target res-b → block; request_access account acct-b → block; execute nested args target res-b / account acct-b → block `That target does not belong to this project`. Audit `/tmp/nexus-e2e/a/.nexus/audit.log` shows 4× `decision:block reason:cross-account target` with session cae3190b-…, resource res-a. Mid-session manifest account→acct-EVIL: one-shot nexus.context returns ready (fresh server per request, fingerprint re-pinned); stateful MCP session (initialize, sid dcfc2d47-…) → next call block `Project context changed during this session … confirmation required`, manifest restored after. Shared-account blast: UI-side `detectBlastRadius` in src/accounts.ts + App.tsx:897,1043,1904 (not HTTP-runnable) | Pass (blast item Partial, UI-side only) |
| HTTP git 2026-09-29 | same as above | Temp git repo /tmp/nexus-e2e/g (remote https://example.com/observed.git, branch main→feature-x). Declared repo mismatch → `status:unresolved` `Git remote does not match … confirmation required` with declared+observed. Declared branch feature-x vs observed main → unresolved `branch changed … confirmation required`; after checkout match → ready. No-manifest folder /tmp/nexus-e2e/nogit → unresolved `no readable Nexus project file` with observed gitRemote/branch null | Pass |
| HTTP guard 2026-09-29 | same as above, GUARD_ENABLED=false verified via import | request_access list_tables (dev) → allow (capability, no credential). execute frobnicate_widgets_xyz → approval_required `not recognized`. execute create_table / delete_user_data (dev) → block `not enabled by guard policy` (MVP read-only gate: stricter than doc line `dev→approval_required`). execute drop_table_x (prod workspace e2e-p) → block. execute create_table + escapeHatch+reason → block (escape ignored, GUARD off). execute list_tables + costBearing → routes allow then fail-closed on missing credential (see token row). Overrides untested live (DEFERRED-PAID, GUARD off); unit-covered (Phase 1 Guard-hide test in 86) | Partial (dev-write divergence noted; overrides unit-only) |
| HTTP token 2026-09-29 | same as above, keyring bin src-tauri/target/debug/nexus-keyring present | execute list_tables with no saved approval → block `{revoked:true}` `APPROVAL_REQUIRED: Supabase rejected the saved approval … Reconnect …` (Phase-1 revocation surface: block+revoked, not approval_required as doc line predates it); output secret-free, single connection attempted, no fallback. NEXUS_KEYRING_BIN=/bin/false restart → block `Supabase is unavailable … check whether the operation completed before retrying` (explicit retry path). Refresh-hook path unit-covered (`Expired approval uses refresh hook…` in 86) | Partial (decision shape differs from doc line; fail-closed ok) |
| HTTP agents 2026-09-29 | same as above; `which claude/codex` → absent, opencode present | Command strings from src-tauri/src/lib.rs:1505-1506: `claude mcp add --transport http nexus <http_url>`, `codex mcp add nexus --url <http_url>` (shape check only, CLIs not installed). detect_agents http_reachable unit test passed in baseline 24; live `GET /context` on real repo workspace → 200 ready (project Nexus Guard, branch master). Project opencode.json contains workspace-bound `nexus-http` remote (X-Nexus-Workspace header) plus `supabase-direct-unmanaged` remote (bypass by shape); project .codex/config.toml has `[mcp_servers.nexus]` workspace-bound URL. Import/remove/backup/diff + unmanaged-scan unit tests passed in baseline (import_and_remove_roundtrip_with_backup, scan_project_mcp_flags_unmanaged_and_skips_nexus_http, unmanaged_classification_needs_http_workspace_binding) | Partial (no live CLI-run import; file+unit evidence) |
| HTTP bypass 2026-09-29 | same as above | Through Nexus: correct-target read allow (request_access list_tables, HTTP guard row); cross-target deny (HTTP account row, audit excerpt); unmapped → approval_required (HTTP guard row); unknown provider `acme` request_access+execute → block `No approved acme connection … self-added tier defaults to approval` (ambiguous deny, fail closed). Outside Nexus: direct `supabase-direct-unmanaged` remote in project opencode.json bypasses Nexus by construction (mcp.supabase.com URL, no session); classified `found,unmanaged` by scan logic unit-covered (see agents row). Full allowed-read execute needs live Supabase creds → pending dogfood | Pass (live-execute pending dogfood) |
| HTTP ux 2026-09-29 | same as above | Skipped: needs desktop GUI (Tauri WebView) — no automation harness in this env | Not-run |

## Pass / fail (§5)

- **Success:** Nexus stays on after novelty + catches ≥1 real mistake across Koupa/Marché/Nabdh/Green Algeria over 2–3 weeks.
- **Failure:** disabled as more friction than protection. Interviews/pricing only after this.

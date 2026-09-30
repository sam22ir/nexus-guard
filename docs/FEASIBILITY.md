# Nexus Guard — feasibility checklist

**Source of truth:** Notion “Nexus — Product & Technical Strategy” (paper is the single source of truth; aligned 2026-09-30), §9 roadmap
**Status:** scaffold toward MVP, not a claim of support
**Date:** 2026-09-27
**Rule:** use disposable test projects and test credentials; do not connect production accounts or run writes as part of the spike.

Notion roadmap (§9): 1 Foundation → 2 Broker core → 3 Validation → 4 Later, only if the MVP proves out (Guard, catalog growth toward 300–500, other users, team features). Guard is post-MVP.

> Paper alignment (2026-09-29): §§1–6 below are history — every row in the
> evidence log is stdio-era and does not count toward MVP. The only MVP
> gates are §7 + [VALIDATION-HTTP](VALIDATION-HTTP.md), re-run over HTTP.

A checked experiment needs a recorded command/configuration, OS and version, expected versus observed result, and a short conclusion. Documentation evidence is useful but does **not** check an experiment off.

## 1. Project identity and isolation — first gate

- [x] Create two disposable repositories with different Git remotes and two different Nexus Project registrations. Prove each resolves only its own Resource Bindings. Tested locally with fake services; see [Experiment 002](EXPERIMENT-002.md).
- [ ] Test a moved folder, Git worktree, clone, symlink, no remote, changed remote, and duplicate manifest. Define which evidence is authoritative and when human confirmation is required.
- [x] Make a manifest claim conflict with registered/Git evidence. Verify unresolved context and no mediated operation; never silently choose a different project. Tested locally with a fake operation; see [Experiment 002](EXPERIMENT-002.md).
- [ ] Test branch/environment changes (e.g., development versus production). If target selection is ambiguous, stop rather than inherit a stale target.
- [ ] Decide manifest schema and whether it can safely be committed; verify no secrets are written to the repository or source-control history.

**Pass condition:** project identity and target binding are deterministic in the happy path and fail closed in conflicts, including after a workspace switch.

## 2. Codex integration — second gate

Official Codex documentation describes STDIO and Streamable HTTP MCP servers, project-scoped `.codex/config.toml` for trusted projects, and shared MCP configuration for the desktop app, CLI, and IDE extension. This establishes an integration route, **not** Nexus-specific behavior or interception of shell commands.

- [ ] Create a minimal local MCP server with only `get_project_context` and a test-only read operation. Confirm discovery and calls from a trusted project in the Codex desktop app and CLI.
- [ ] From two distinct workspaces, verify the MCP server receives trustworthy workspace context or has a safe way to resolve it. Do not rely on a global “current project” shared across simultaneous agent tasks.
- [ ] Test a project that is not trusted, a missing manifest, and parallel Codex tasks in different repositories. Record whether the client passes cwd, launches separate processes, or needs explicit project identity.
- [ ] Confirm tool descriptions/results contain IDs and safe labels only, never tokens. Inspect agent-visible output and server logs.
- [ ] Record the actual setup required for another agent (such as Pi) as separate future work; do not assume Codex integration automatically transfers.

**Pass condition:** simultaneous project contexts cannot cross-contaminate; unresolved context returns a safe error instead of an incorrect resource.

## 3. Provider and credential boundary — third gate

- [ ] Choose two disposable Supabase test projects (ideally under separate test accounts) and verify provider-native project IDs using official, currently supported auth/API routes.
- [ ] Identify the minimum authorization needed for a **read-only** operation and whether credentials can be scoped to one project. If only account-wide credentials work, record that limitation prominently.
- [ ] Make the same safe read operation target Project A, then intentionally request Project B while A is active. Confirm the mismatch is denied **before** provider access.
- [ ] Validate token expiration, revocation, offline behavior, duplicate account labels, provider errors, and user cancellation. No automatic fallback to a different account.
- [ ] Evaluate OS keychain or another reviewed credential store on Linux, Windows, and macOS. Test locked/unavailable stores, secret redaction, process environment and child-process leakage, crash logs, and uninstall behavior.
- [ ] Define local API/MCP authentication so an unrelated local process cannot invoke privileged Nexus operations simply because it knows a port or socket path.

**Pass condition:** the test provider operation reaches only the approved resource, credentials are not exposed to the agent, and failure modes do not fall back to another account.

## 4. Routing coverage (Guard checks are post-MVP): prove both the boundary and the bypass

- [ ] Through the Nexus-managed operation, demonstrate expected-target allow, wrong-target deny, ambiguous-target deny, and explicit one-operation approval where policy permits.
- [ ] Run a normal provider CLI directly outside Nexus. Determine exactly whether it is visible; if not, mark it **unmanaged**, not “protected.” Repeat for a direct provider MCP connection and browser action.
- [ ] If exploring managed CLI launch or wrappers, test per OS: command resolution, environment injection, subprocesses, provider configuration files, existing logged-in sessions, and bypass by absolute executable path.
- [ ] Assess whether any proposed system-level interception is safe, portable, and enforceable. Do not include it in MVP unless independently demonstrated and threat-modeled.
- [ ] Ensure activity history distinguishes `allowed`, `denied`, `approval required`, and `unobserved/unmanaged`; never fabricate coverage data.

**Pass condition:** the UI and product wording describe only demonstrated enforcement. A bypass test is part of success, not a failure to hide.

## 5. Cross-platform desktop delivery — release gate

- [ ] Run Vite/React frontend hot reload and Tauri development builds on Linux, Windows, and macOS. Verify Rust/backend change behavior separately from frontend HMR.
- [ ] Test a local MCP process while the UI is closed, restarted, or updated; decide whether to package a sidecar/service or require an open app.
- [ ] Verify installer, autostart (if needed), OS credential access, filesystem paths, Git executable discovery, and update/recovery on each OS.
- [ ] Run the same project-switch, mismatch, secret-leak, and concurrent-task tests on all three OSes before advertising parity.

**Pass condition:** the core workflow, not merely the empty desktop shell, works on all three platforms.

## Evidence log

> stdio-era evidence: every row below was gathered over one-stdio-process-per-project
> (`mcp/nexus-server.mjs`). The locked transport is now a single local HTTP
> endpoint (`http://localhost:<port>/mcp`, `NEXUS_HTTP_PORT` default 3939,
> `mcp/nexus-http-server.mjs`). Each Pass below must be re-run over HTTP
> before it counts toward MVP.

| Experiment | OS / version | Setup and observed result | Verdict | HTTP re-run |
| --- | --- | --- | --- | --- |
| Project identity | Linux · Rust 1.96.0 + Node 22 · 2026-09-26 | Prototype 15/15; MCP 14/14 incl. branch-switch block, repo-mismatch block, mid-session change re-verification. Live: `~/Projects/Koupa` (git main = manifest main → ready) and `~/Projects/Nabdh` (branch switched to feature → `nexus.execute` blocked “confirmation required”, restored to develop). | Pass; moved-folder/symlink/worktree edge cases pending | pending |
| Notion-aligned MCP bridge | Linux · Node 22 · 2026-09-26 | `npm run test:mcp`: 11 passed — discovery, isolation, write-block, no-manifest, file-change block, canonical `nexus.context/request_access/execute`, secret-free audit, refresh hook. Fake provider only. | Pass (fake); real Supabase end-to-end pending | pending |
| Prototype broker | Linux · Rust 1.96.0 · 2026-09-26 | `cargo test --manifest-path prototype/nexus-check/Cargo.toml`: 15 passed, fake services | Pass (fake) | pending |
| Frontend + Rust check | Linux · 2026-09-26 | `npm run build` passed; `cargo check --manifest-path src-tauri/Cargo.toml` passed | Pass | pending |
| Codex MCP context (real) | Linux · live stdio MCP · 2026-09-26 | Two agents over live `StdioClientTransport`, cwd-pinned to `~/Projects/Koupa` (production) and `~/Projects/Nabdh` (development): Koupa → `public.waitlist`, Nabdh → 7 tables, workspaces confirmed in `nexus.context`, no cross-contamination. Per-folder `.mcp.json` + `opencode.json` installed. | Pass | pending |
| Supabase read-only target (real) | Linux · Supabase MCP + Nexus OAuth · 2026-09-26 | Real Nexus end-to-end PASS: `nexus.execute list_tables` via saved approvals returned `mobileforge-web` → `public.waitlist`, `Lamsa` → 7 tables; cross-target block, write block, secret-free context. Workspaces `/tmp/nexus-e2e/*`, keychain IDs `mobileforge/mfw-conn`, `lamsa/lamsa-conn`. | Pass | pending |
| Token lifecycle | Linux · live keychain · 2026-09-26 | Both approvals hold access+refresh tokens. Live probes: unknown (revoked) IDs → `approval_required`; broken helper (offline keychain) → `block` unavailable; no fallback to another account, no secret leak in either. Natural expiry not yet observed; live refresh against Supabase not attempted. | Partial pass | pending |
| Guard mismatch and bypass (real refs) | Linux · Node 22 · 2026-09-26 | Temp MobileForge/Lamsa manifests with real `project_ref`s: correct-target allow, cross-target block before provider, write block in production. `npm run test:mcp` 11/11 still pass. | Pass | pending |
| Linux / Windows / macOS parity | — | Not run | Pending | pending |

## Reference documentation (checked 2026-09-24)

- [Official OpenAI documentation: Codex MCP configuration](https://developers.openai.com/codex/mcp) — local MCP route and project-scoped configuration for trusted projects.
- [Official OpenAI documentation: Codex config basics](https://developers.openai.com/codex/config-basic) — configuration/trust behavior.
- [Supabase MCP setup guide](https://supabase.com/docs/guides/getting-started/mcp) — provider-specific MCP configuration and scope options to compare with Nexus-mediated access.
- [Tauri overview](https://v2.tauri.app/start/) — desktop platform and application framework baseline.

These links are starting points; current versions and exact security properties must be verified during implementation.

## 6. Credential broker and multiple agents — next test

The new goal is not only to identify a folder. Nexus must give the right service connection to the right agent session.

- [x] Create two fake Agent Sessions: one for Koupa and one for Nabdh. See [Experiment 003](EXPERIMENT-003.md).
- [x] Ask both sessions for Supabase at the same time. Confirm each gets only its own fake connection. See [Experiment 003](EXPERIMENT-003.md).
- [x] Ask a Koupa session for Nabdh's target. Confirm Nexus blocks it before the fake service step. See [Experiment 003](EXPERIMENT-003.md).
- [x] Close one session and confirm it cannot keep asking for services. See [Experiment 003](EXPERIMENT-003.md).
- [x] Confirm the service names and targets are visible, but no fake or real secret is returned to the agent. See [Experiment 003](EXPERIMENT-003.md).
- [ ] Test two sessions for the same project and decide whether they may share a connection or need separate permission.

**Pass condition:** Nexus chooses the service connection from the Agent Session's project, never from one shared current-project setting.

## 7. HTTP transport + account-scoping gates (added 2026-09-27 — gates only, no evidence yet)

Single-HTTP + provider→account→resource is locked but unproven. No new
evidence is claimed here; each gate needs a recorded run over
`http://localhost:<port>/mcp` before it passes.

- [ ] Serve two concurrent agent sessions for different projects from one HTTP process. Confirm per-request workspace pinning, no cross-contamination, no shared mutable current project.
- [ ] Re-run the stdio-era evidence log (project identity, Codex context, Supabase target, token lifecycle, Guard mismatch/bypass) over HTTP. Record command/configuration, OS and version, expected versus observed.
- [ ] Resolve every binding as provider→account→resource, never bare provider. Confirm a request naming only a service is denied before provider access.
- [ ] Confirm block ≠ disconnect over HTTP: a blocked operation is denied once while the binding stays registered and later allowed operations proceed.

**Pass condition:** the HTTP endpoint enforces the same isolation and Guard behavior the stdio bridge demonstrated, with account-scoped bindings throughout.

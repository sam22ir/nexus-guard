# Nexus Guard — product brief

**Source of truth:** Notion “Nexus — Product & Technical Strategy” (2026-09-27)
**Status:** scaffold implementing toward that spec, not yet at MVP
**Date:** 2026-09-27

## One-line pitch

Connect your agents once. Link your services once.

Who it is for (MVP): solo developer running multiple AI coding agents (Claude Code, Codex, etc.) across several own projects at the same time — not enterprise governance.

## Canonical model

```text
Agent → Session → Project → Environment → Service → Account → Resource → Capability → Policy Decision

Supabase + Project A ≠ Supabase + Project B
Supabase + Production ≠ Supabase + Development
Project links to account+resource per service, never bare provider.
```

`.nexus/project.json` example: `{"project":"koupa","connections":{"supabase":{"account":"personal","resource":"koupa-production"}}}`

Nexus sits as `Agent → Nexus → Provider → Nexus → Agent`. The agent asks for a
capability, never chooses project/credentials itself. Nexus resolves
project+environment+resource, forwards the call with the bound account's
credentials, and logs it. Nexus stays in the execution path. Guard (allow /
warn / approve / block) is post-MVP (paper §14).

What Nexus is not: generic vault, enterprise compliance platform, filesystem sandbox, policy engine in MVP (Guard is post-MVP, possibly paid).

## MVP scope (from Notion §4)

In scope:

- Local desktop app + local runtime (Linux first)
- Project registry + `.nexus/project.json` authoritative secret-free config
- Account registry: provider→account→resource per project+environment, never bare provider
- Services picker: per-project service bindings chosen in the desktop app
- Single local HTTP transport (HTTP-only): one persistent Nexus over `http://localhost:<port>/mcp`
- First-run onboarding: register a project, link one service, connect one agent, then a guided proof moment
- Accounts page: linked accounts and the ~50-service catalog (Native: Supabase, GitHub; Curated via generic MCP forwarding; Self-added)
- Accounts page, Agents section: official CLI add where available, else diff + confirm + backup; live test-connection; import of existing direct MCP connections
- Home topology view: fixed columns, drag-to-link with confirm step
- Dark and light themes
- Multiple concurrent agent sessions isolated by project
- Local activity log (routing decisions and forwarded calls)
- MCP as agent-facing interface (`nexus.context`, `nexus.request_access`, `nexus.execute`)

Canonical tool surface is dotted. Underscore spellings (`nexus_context`,
`nexus_request_access`, `nexus_execute`) remain as hidden compat aliases
(callable, never listed) for one release so strict-client mappings keep
working; legacy `nexus_get_project_context` / `nexus_check_target` are
deprecated aliases for one release. All spellings execute the same path.

Out of scope: Guard (policy engine, allow/warn/approve/block, override rules,
tray quick-approve, decision auditing; possible future paid feature), catalog
growth beyond ~50 services, SSO/RBAC/multi-user, compliance dashboards, Nexus
Brain AI layer, pricing/packaging.

## Validation plan (from Notion §5)

- Smallest loop: two agents, two projects, one provider, no cross-contamination.
- Run against real projects (Koupa, Marché, Nabdh, Green Algeria) for 2–3 weeks.
- Success: Nexus stays on after novelty, catches ≥1 real mistake.
- Failure: disabled as more friction than protection.

## How a service connects

1. **Manual:** safe details + allowed key in the Registry + OS-keychain-backed approval store. Pending ≠ connected.
2. **MCP browser approval:** sign in, choose org/project, approve; Nexus saves authorization linked to Nexus Project.
3. **Import later:** show what was imported, ask user to confirm project.

Every method ends as provider→account→resource linked to one Nexus
Project + Environment: the provider (Supabase), the account holding the
target (org/personal), and the concrete resource (e.g.
`koupa-production`). Account scoping bounds the blast radius — a wrong
or compromised credential can only reach that account's resources, never
a sibling project's.

## Safety rules

1. Resource belongs to project+environment, not global account.
2. Every binding is account-scoped: provider→account→resource, never bare provider.
3. One session has one clear project context, re-validated every request.
4. Two sessions never share mutable current project.
5. Routing resolves the binding; Guard decides the operation. Guard never decides on a bare service name.
6. Missing/conflicting identity stops the request; never silently guess.
7. Tools, not raw secrets, whenever possible.
8. Warn ≠ block; approval is explicit. Block ≠ disconnect: a blocked operation is denied once; the binding stays registered.
9. Bypass is **unmanaged**, not protected.
10. Disposable test projects first; no production writes in spikes.

## First-release limits

Cannot stop every local command, control browser logins, support every provider,
make every agent Nexus-aware, make secrets unexposable, or protect direct provider
use outside Nexus.

## Shape

Tauri 2 + React + TypeScript + Vite, Rust for local project/access rules, MCP for
agents. Secrets in OS secure storage; repo files hold only safe references.
Agents reach Nexus over a single local HTTP endpoint,
`http://localhost:<port>/mcp` (`NEXUS_HTTP_PORT`, default 3939), with the
workspace pinned per request.

See [domain language](../CONTEXT.md), [feasibility](FEASIBILITY.md),
[Experiment 002](EXPERIMENT-002.md), [Experiment 003](EXPERIMENT-003.md).

# Nexus Guard

Source of truth: Notion “Nexus — Product & Technical Strategy” (last restructured 2026-09-29). The paper is the single source of truth; where this file differs, the paper wins.
One-line pitch: Connect your agents once. Link your services once.

Nexus is a personal, project-aware infrastructure control plane for a solo developer
running multiple AI coding agents at the same time. It resolves the active
project and environment, finds the account and resource bound to them, and
forwards the call with that account's credentials. Anything unresolved or
unregistered is refused before any provider call. Agents never hold keys.

Canonical chain:

```text
Agent → Session → Project → Environment → Service → Account → Resource → Capability
```

`Supabase + Project A ≠ Supabase + Project B`.
`Supabase + Production ≠ Supabase + Development`.

## Language

**Workspace**:
A local project folder where an agent is working.
_Avoid_: Account, connection

**Nexus Project**:
The named project that owns workspaces and resources, such as Koupa, Marché, Nabdh, or Green Algeria.
_Avoid_: Account, repository

**Environment**:
Development or production (or similar) within one Nexus Project. Same service name never implies same resource across environments.
_Avoid_: Account

**Agent Session**:
One agent working on one workspace at a particular time, with server-held short-lived session context. Session context is re-validated on every request; workspace/repo/branch changes trigger re-resolution, not blind trust.
_Avoid_: User, account

**Service**:
A provider used by a project, such as Supabase. The MVP catalog is about 50
services in three tiers: Native (Supabase, GitHub), Curated (the rest, via
generic MCP forwarding), Self-added (developer-added, unverified).
A service name alone never identifies a target — only account+resource does.
_Avoid_: Resource, Account (as synonyms)

**Account**:
The provider-side identity that holds resources, such as a Supabase
organization or personal account. Each project links to one
account+resource per service, never a bare provider. Account scoping
bounds the blast radius: a compromised or mis-targeted credential affects
only that account's resources.
_Avoid_: Nexus Project, Environment

**Service vs Binding**:
Service is the provider name; a Binding is the resolved
account+resource for one project+environment+service. Routing picks the
binding. Post-MVP, Guard would decide on the resolved operation, never on a
bare service name.
_Avoid_: Using “service” to mean a concrete target

**Resource**:
The concrete project-scoped instance behind a service name, e.g. `koupa-production`. Stored without secrets in the Connection Registry.
_Avoid_: Credential, login

**Capability**:
Permission to invoke one specific operation through Nexus under one session — not a standing provider connection. Nexus stays in the execution path; revocation is enforced by pass-through.
_Avoid_: Standing connection, raw secret handoff

**Connection Registry**:
Project-to-service mappings with no raw secrets. `.nexus/project.json` is the authoritative secret-free config.
_Avoid_: Secret store

**Provider Adapter**:
One per provider (Supabase first), normalizing auth/resources/operations behind a common interface with `read_only=true` and `project_ref` scoping where supported.
_Avoid_: Direct provider credential

**Guard (post-MVP)**:
Out of the MVP (decided 2026-09-28); a possible future paid feature (paper §14).
Routing already makes cross-project access impossible; Guard would cover
“right project, wrong move” with allow / warn / require approval / block over
one central table of adapter-normalized operations. Until it exists, Curated
and Self-added services stay fail-closed, and native adapters keep their
read allowlists. A block would deny one operation; it is not a disconnect.
_Avoid_: Global protection, silent allow, block-means-disconnect,
policy-engine-in-MVP

## What Nexus is not (per paper)

- Not a vault / secrets manager.
- Not an enterprise-governance / compliance platform.
- Not a filesystem sandbox; boundary is infrastructure access.
- Not (in the MVP) a policy engine — Guard is post-MVP (paper §14).

**Activity Log**:
Simple local record of session, project, resource, operation, and outcome. Feeds Home and each project's Activity view. Never raw credentials.
_Avoid_: Audit Log, verbose credential log

**Project Context Resolution** (most to least authoritative):
Explicit `.nexus/project.json`, previously verified mappings, Git/repo identity, auto-discovery, agent-stated intent (never sufficient for ownership). Conflicts surface and ask; never silently guess.
_Avoid_: Active account

**Unmanaged Action**:
An action that does not go through Nexus, so Nexus cannot promise that it saw or stopped it. Direct provider CLI/MCP/browser use is unmanaged, not protected.
_Avoid_: Protected action

## Locked decisions (from Notion §8)

- Only the developer can change bindings or permissions; agents cannot grant themselves access, disable Guard (once it exists), or edit permissions.
- Agents may propose mapping changes; developer must approve.
- Branch, workspace, and external `.nexus/project.json` edits require developer confirmation.
- Fail-open must be explicit per environment, never implicit.
- Rollback belongs to the provider, not Nexus.
- Nexus does not sandbox the filesystem; boundary is infrastructure access.
- Discovering a project does not create it; developer registers explicitly.
- Routing resolves which account+resource a request targets. Guard (post-MVP)
  would decide whether the resolved operation may run.
- Agents call through Nexus; Nexus forwards with the bound account's
  credentials. Agents never hold provider keys.
- No agent MCP config file is modified without a confirm/dismiss step showing
  a diff, with a backup kept before any write.
- No tab scrolls the whole page; only a specific region may scroll (2026-09-28).
- MVP catalog is about 50 services (2026-09-29); the final list is pending review.
- The topology view is MVP: drag-to-link, but every link or unlink needs an
  explicit confirm, and the canvas never writes directly (2026-09-29).
- Fixed-column topology: agents left, projects middle, service accounts right.
- Single HTTP transport is locked: one persistent local Nexus serves all
  agent sessions over `http://localhost:<port>/mcp` (`NEXUS_HTTP_PORT`,
  default 3939), with the workspace pinned per request — not one stdio
  process per project folder.

## Visual identity (paper §11, decided 2026-09-29; supersedes dark-only)

- Two themes, dark and light, following the system setting by default with a
  manual toggle in Settings. Same component style in both: flat rounded cards,
  small uppercase section labels, system type, color used sparingly. The
  warm-light (2026-09-27) and amber/obsidian themes are retired.
- Dark (Codex-aligned, locked 2026-09-27): canvas `#1A1A1A`, sidebar `#242424`,
  cards `#212121`, raised `#262626`, hairline borders `#333333` / soft
  `#2B2B2B`, text `#F5F5F5` / `#A3A3A3` / faint `#737373`, primary action white
  `#F5F5F5` with black text.
- Light (estimated by eye, builder samples exact values): canvas `#F6F5F1`,
  sidebar and cards `#FFFFFF`, raised `#EFEEEA`, borders `#E6E4DE`, text
  `#1A1A1A` / `#6B6B66` / `#9A9A94`, primary action black with white text.
- Single source of truth: `src/theme.css`, one token set per theme.
- No brand accent color. Green is status only, never primary action. Status
  colors keep one meaning in both themes: green allow/flowing, red
  block/refused, amber warn, violet approval, blue info.
- Topology nodes stay neutral; category is a small tinted icon square; status
  appears only on lines and small badges.
- Type: system stack + system mono (IDs, values, code). Brand mark: white
  N-symbol on dark (`nexus-symbol.png`); black on light
  (`nexus-symbol-dark.png`). Never amber.
- Components: HeroUI v3 (Tailwind v4 + React Aria), adopted gradually; docs
  from HeroUI v3 only. The topology is custom SVG.
- Every screen is verified in both themes before it counts as done.

# Nexus Guard — decisions log

**Source of truth:** Notion “Nexus — Product & Technical Strategy” §8 and §15 (paper is the single source of truth; mirrored 2026-09-30 from the 2026-09-29 version).
**Rule:** if this file and the paper differ, the paper wins.

| Date | Decision | Status | Paper |
| --- | --- | --- | --- |
| 2026-09-26 | Dark visual theme chosen | Superseded | §15 |
| 2026-09-27 | Codex-aligned dark palette locked | Locked (dark palette) | §11 |
| 2026-09-27 | Navigation: Home, project sidebar with Bindings, global Services / Agents / Settings | Locked | §12 |
| 2026-09-28 | MVP simplified: agents connect to Nexus, Nexus connects to services registered once. Guard out of MVP, possible paid feature | Locked | §4, §14 |
| 2026-09-28 | No whole-page scrolling in any tab | Locked | §8 |
| 2026-09-29 | Execution model: agents call through Nexus, Nexus forwards with the bound account's credentials, agents never hold keys | Locked | §3, §8 |
| 2026-09-29 | MVP catalog: about 50 services by category (final list pending) | Locked | §13 |
| 2026-09-29 | Topology view is MVP: drag-to-link with explicit confirm, fixed columns, canvas never writes directly | Locked | §12 |
| 2026-09-29 | Themes: dark and light, system default with manual toggle (supersedes dark-only) | Locked | §11 |
| 2026-09-29 | Component library: HeroUI v3, adopted gradually | Locked | §11 |

## Standing rules (paper §8, §14)

- Only the developer can change bindings or permissions; agents cannot grant themselves access.
- Agents may propose mapping changes; the developer must approve.
- Branch, workspace, and external `.nexus/project.json` edits need developer confirmation.
- Discovering a project does not create it; the developer registers explicitly.
- No agent MCP config is modified without a confirm step with a diff and a backup.
- Nexus does not sandbox the filesystem; rollback belongs to the provider.
- All agents use one persistent local HTTP Nexus; no per-agent stdio subprocesses.
- Guard (post-MVP): fail-open must be explicit per environment; unanswered approvals deny; an agent can never disable Guard or edit its policy.

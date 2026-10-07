# Launch services

Checked 2026-10-07. Sign-in support was tested directly: each server's public
OAuth discovery metadata was fetched and read for dynamic client registration
(DCR) and PKCE (`S256`). Popularity is editorial (2026 stack guides and MCP
rankings), not survey data. See [Sources](#sources).

Two caveats that metadata cannot show:

- **DCR is not the same as "will accept Nexus".** Vercel says its MCP server only
  supports clients it has reviewed. Figma says only clients in its MCP catalog
  can connect. Test one real sign-in per service before launch.
- **Isolation.** Native services (Supabase, GitHub) are limited to one resource.
  Everything else ships with account-level isolation until a per-resource rule
  is added as data. Writes need approval.

## Native (done)

| Service | Notes |
| --- | --- |
| Supabase | MCP OAuth with DCR. Limited to one project. |
| GitHub | Own GitHub App with device flow ([setup](github-app-setup.md)). Limited to one repo. |

## Generic flow (OAuth + DCR + PKCE found in metadata)

| # | Service | MCP URL | Read-only handle | Watch out |
| --- | --- | --- | --- | --- |
| 3 | Vercel | `https://mcp.vercel.com` | tool annotations | **Approved clients only.** Apply via Vercel's client review form. |
| 4 | Stripe | `https://mcp.stripe.com` | `stripe_api_read` vs `stripe_api_write` tool split | Refunds and payouts need human confirmation. From 2026-10-31 only OAuth or Agent keys work. |
| 5 | Cloudflare | `https://mcp.cloudflare.com/mcp` | pick permissions at sign-in | Many product servers; start with the main one. |
| 6 | Neon | `https://mcp.neon.tech/mcp` | `?readonly=true`, scopes `read`/`write` | |
| 7 | Sentry | `https://mcp.sentry.dev/mcp` | scopes, optional org/project in URL | URL can scope to one org or project. |
| 8 | Linear | `https://mcp.linear.app/mcp` | `/mcp/readonly`, scope `read` | |
| 9 | Notion | `https://mcp.notion.com/mcp` | tool annotations | Docs give no read-only option. |
| 10 | Resend | `https://mcp.resend.com/mcp` | scopes `emails:send` vs `full_access` | |
| 11 | PostHog | `https://mcp.posthog.com/mcp` | scopes (`*:read`) | |
| 12 | Netlify | `https://netlify-mcp.netlify.app/mcp` | scopes `read`/`write` | |
| 13 | Railway | `https://mcp.railway.com` | role scopes (`workspace:viewer`) | |
| 14 | Figma | `https://mcp.figma.com/mcp` | read-oriented | **Catalog / waitlist only.** Needs approval. |
| 15 | Atlassian (Jira, Confluence) | `https://mcp.atlassian.com/v1/mcp` | tool annotations | |
| 16 | Airtable | `https://mcp.airtable.com/mcp` | scopes `*:read` | |
| 17 | Webflow | `https://mcp.webflow.com/mcp` | tool annotations | |
| 18 | Sanity | `https://mcp.sanity.io` | tool annotations | |
| 19 | Cloudinary | `https://asset-management.mcp.cloudinary.com/mcp` | scopes | |
| 20 | PayPal | `https://mcp.paypal.com/mcp` | tool annotations | Docs mention client credentials too; check the flow. |
| 21 | Mixpanel | `https://mcp.mixpanel.com/mcp` | scopes (`data:read`) | |
| 22 | GitLab | `https://gitlab.com/api/v4/mcp` | scope `read_api` | |
| 23 | PlanetScale | `https://mcp.pscale.dev/mcp/planetscale` | scopes `read_*` | |
| 24 | Hugging Face | `https://huggingface.co/mcp` | scope `read-mcp` | Answered 200 without a challenge; confirm it signs in. |
| 25 | Zapier | `https://mcp.zapier.com/api/mcp/mcp` | tool annotations | |

## Needs a registered app first (no DCR), like GitHub

Slack (directory-published apps only), Asana, HubSpot, MongoDB, Discord.

## Not a fit for the generic flow

- **Clerk:** its MCP server serves SDK docs, not instance management.
- **Firebase, Convex:** documented as local servers that use CLI logins.
- **Context7, Playwright, Chrome DevTools:** no account to connect.

## Not found (unverified, not proven absent)

Upstash, Twilio, SendGrid, Auth0, Turso, Pinecone, OpenAI. No hosted server
answered at the addresses tried. Check each vendor's docs before ruling out.

## How a service gets added

The generic engine needs no per-service code.

1. Add a row to [`mcp/services.json`](../mcp/services.json): `"name": { "name": "Name", "mcpUrl": "https://…" }`.
2. Add the service to `PROVIDER_CATALOG` in `src/store.ts` if it is not there yet.
3. Do one real sign-in with it and read its tool list.

What the engine does for you:

- **Sign-in:** finds the service's OAuth addresses from its MCP URL, registers Nexus as a client on the spot (no app to register), and signs in with PKCE. Tokens go straight to the OS keychain from the desktop app; the page never sees them.
- **Least access:** asks only for scopes that read (`read`, `*:read`, `viewer`), plus `offline_access` so the sign-in can renew. A service that advertises no read scope gets none requested, and Nexus's own rule below is the only limit.
- **Read-only rule:** only a tool that declares `readOnlyHint: true` (and not `destructiveHint`) is forwarded. Everything else returns `approval_required` and never reaches the service. Agents can run `list_tools` to see which are which.
- **Renewal:** `nexus-keyring` renews an expiring sign-in with the client Nexus registered, before the server uses it.
- **Isolation:** the signed-in account, not one resource. The dialog says so.

### Limiting a binding to one resource

By default a signed-in service covers the whole account. For services whose
tools take a resource argument, a binding can be limited to one project, site or
base, and the limit is generic: it is data, not code.

- **Data:** a `scope` row in `mcp/services.json` names the argument(s) the service's tools use for the resource, for example `{ "label": "project", "args": ["projectId", "project_id"], "verified": false }`.
- **Setting it:** Project → Bindings → the service → "Limit to one project". The value is saved in the app's own config folder (`binding-scopes.json`), never in the project folder, so an agent cannot widen it.
- **Enforcement, on every call:** Nexus reads the tool's own input schema. A tool that takes the argument gets the bound value forced in; naming a different value is refused; a tool that cannot be limited (an account-wide list or search) is refused. Only top-level arguments are checked.
- **Wrong data fails safe:** a wrong argument name makes the limit refuse more tools, never fewer.
- **Checking a new row:** sign in to the service, run `list_tools` through Nexus, and read `limitable` on each tool. Fix the argument names until the tools you expect are limitable, then set `verified` to true.

All rows are `verified: false` until each service has been signed in to.

Known limits: a service with a narrow read scope may expose fewer tools (Sentry
advertises only `org:read` as a read scope); a service that restricts which
clients may connect (Vercel, Figma) will refuse registration until Nexus is
approved; tools that do not set `readOnlyHint` need approval even if they only read.

## Sources

- [The Vibe Coding Stack for 2026](https://getintoai.beehiiv.com/p/the-vibe-coding-stack-for-2026)
- [Vibe coding tech stack, DataCamp](https://www.datacamp.com/blog/vibe-coding-tech-stack)
- [Top 10 MCP servers for developers in 2026](https://fungies.io/top-10-mcp-servers-developers-2026/)
- [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)
- [Stripe MCP](https://docs.stripe.com/mcp)
- [Neon MCP](https://neon.com/docs/ai/neon-mcp-server)
- [Linear MCP](https://linear.app/docs/mcp)
- [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/)
- [Slack MCP](https://docs.slack.dev/ai/mcp-server/)

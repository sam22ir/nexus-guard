# GitHub App setup

Each person connects Nexus to their own GitHub account. Nexus does this with one
GitHub App that you register once; every user approves it with their own login.
Nothing is shared, and tokens stay in each user's OS keychain.

## Register the app (once, by the project owner)

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Name: for example "Nexus Guard". Homepage URL: your site.
3. Turn **off** Webhook.
4. Repository permissions, all **Read-only**: Contents, Metadata, Issues, Pull requests.
5. Check **Enable Device Flow**.
6. "Where can this app be installed?": **Any account**, so other people can use it.
7. Create the app. Copy the **Client ID** (public, not a secret) and the app's URL slug.
8. Do not generate a client secret. Nexus does not use one.

## Give the build the client ID

The app reads these at run time, or bakes them in at build time:

| Variable | Meaning |
| --- | --- |
| `NEXUS_GITHUB_CLIENT_ID` | The GitHub App's client ID. Without it GitHub shows as "not set up" and is hidden from the setup wizard. |
| `NEXUS_GITHUB_APP_SLUG` | The app's slug, used for the "Install on GitHub" link. |

For release builds, add both as repository **variables** (not secrets); the
release workflow passes them to the build.

## What a user sees

1. Add binding → GitHub → Connect GitHub. Nexus shows a short code and opens github.com.
2. They enter the code and approve.
3. They pick a repository. Only repositories where they installed the app are listed; if there are none, the dialog links to the install page.
4. The Nexus account is named after their GitHub username.

## Details worth knowing

- Tokens come from device flow, so renewing them needs no client secret. Access tokens last 8 hours and are renewed automatically by `nexus-keyring` when the server reads them.
- The server sends the token to the GitHub MCP server (`NEXUS_GITHUB_MCP_URL`, default `https://api.githubcopilot.com/mcp`). GitHub's docs do not say which token types that server accepts, so test a real connection before releasing.
- Reads only: Nexus blocks write operations itself, and the app's permissions are read-only as well.

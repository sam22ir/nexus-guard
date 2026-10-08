# Release plan: 0.1.2 and 0.2

Written 2026-10-08 from research on the current code and official docs. Each item lists what changes, how we know it works, and what only the owner can do.

## 0.1.2: fixes

### 1. Block DNS rebinding (security)

A web page can use DNS rebinding to make the browser call the local server on 127.0.0.1:3939. The MCP spec says local servers "MUST validate the Origin header". Today `mcp/nexus-http-server.mjs` checks neither Host nor Origin.

- One check at the top of the request handler, before any route, so `/healthz`, `/session`, `/context` and `/mcp` are all covered. The SDK's own option only covers `/mcp`.
- Host: allow only the hostnames `127.0.0.1`, `localhost` and `[::1]`, with or without a port. The app's own probes send `Host: 127.0.0.1` without a port; agents send `127.0.0.1:3939`.
- Origin: refuse any request that has one, including `null`. Agents (native clients) send none; Node's fetch sends none (checked). Nothing in the app calls the server from its web view.
- Refusals are `403` with a plain reason, and are logged without request data.
- Tests: wrong Host, any Origin, port-less Host, and every route.

### 2. Test the built installers in CI

After `tauri-action` builds, unpack what users download and run it: `.deb` with `dpkg -x`, `.dmg` with `hdiutil attach`, Windows `setup.exe /S` (installs per user under `%LOCALAPPDATA%`). Start the packaged server and check `/healthz`; run the packaged `nexus-keyring` and expect its clean "no saved approval" exit (1), not a crash. The Intel Mac build runs under Rosetta on the Apple Silicon runner if available, else that leg only checks the files are present.

Depends on item 3 (the server becomes a binary), so it is written for the binary and lands after it.

## 0.2: less friction

### 3. No separate Node.js install

Ship the server as a standalone executable using Node's Single Executable Applications (SEA), the same Node runtime the app already relies on, so behaviour does not change.

- Keep the ESM bundle (`mainFormat: "module"`), no snapshot or code cache (needed for cross-builds).
- Per target, inject the blob into the official Node binary for that target (Linux x64, macOS arm64 and x64, Windows x64) with `postject`; re-sign ad hoc on macOS. Pin the Node version.
- Output `src-tauri/binaries/nexus-server-<target-triple>[.exe]`, listed in `externalBin` next to `nexus-keyring`.
- The app starts it from next to its own executable (like the keychain helper). A source checkout still falls back to `node mcp/nexus-http-server.mjs`.
- Remove the "needs Node.js" check and the "Get Node.js" button; update README, website and release notes.
- Cost: each installer grows by roughly 90–110 MB (a full Node runtime).

### 4. Automatic updates

`tauri-plugin-updater` v2 with `tauri-plugin-process` for the restart.

- `bundle.createUpdaterArtifacts: true`; the updater public key in `tauri.conf.json`; endpoint `https://github.com/sam22ir/nexus-guard/releases/latest/download/latest.json`; Windows `installMode: "passive"`.
- **Releases stop being marked pre-release.** GitHub's "latest" skips pre-releases, so the endpoint would 404 forever. "Alpha" stays in the title.
- `tauri-action` uploads `latest.json` and the `.sig` files (`updaterJsonPreferNsis: true`).
- Updatable formats: Windows NSIS, macOS `.app.tar.gz`, Linux AppImage. `.deb`/`.rpm` users update by hand.
- The app checks once at start; if a newer version exists it offers "Install and restart".
- Signing key: generated once with `tauri signer generate`. Private key in the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` (+ password). **If it is lost, existing installs can never update again**, so the owner keeps a backup.
- The first build with the updater can only update to later versions; 0.1.x users install 0.2 by hand.

### 5. Code signing (owner action, costs money)

| | What | Cost | Notes |
| --- | --- | --- | --- |
| macOS | Apple Developer Program, Developer ID Application certificate, notarization | USD 99/year | Enrolment from Algeria is not confirmed; try it. CI secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. Sidecars must be signed too; verify on the first signed build. |
| Windows | SignPath Foundation (free for open source) | 0 | Needs an OSI license in the repo (there is none yet) and a fully automated build. |
| Windows | Azure Trusted Signing | USD 120/year | Individuals only in the USA and Canada, so not an option. |
| Windows | OV certificate | ~USD 220+/year plus token | Hard for individuals without a company. |
| Linux | — | 0 | Not needed. |

Signing does not remove SmartScreen at once on Windows: reputation builds per file over time, and EV no longer skips that. CI is prepared to sign when the secrets exist and stays unsigned otherwise.

**Owner decisions:** pick a license (needed for SignPath), and try Apple enrolment.

## Order

1. Items 1, 3 and 4 in parallel (separate branches), each with its tests and the three-system checks.
2. Item 2 after item 3 lands.
3. Item 5 workflow wiring after item 4 (both edit the release workflow).
4. Release 0.1.2 with item 1 as soon as it merges; 0.2 when 2–4 are in.

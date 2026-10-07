# Nexus Guard

Connect your agents once. Link your services once.

Nexus Guard is a project-aware scaffold (not yet MVP) for developers who run
several coding agents across several projects. The MVP catalog is about 50
services: Supabase and GitHub are native adapters, the rest go through generic
MCP forwarding. Source of truth: the Notion paper “Nexus — Product & Technical
Strategy”.
Agents reach one persistent local Nexus over HTTP-only
(`http://localhost:<port>/mcp`, `NEXUS_HTTP_PORT` default 3939) with the
workspace pinned per request. Anything an agent does outside Nexus is
unmanaged, not protected — direct provider CLI/MCP/browser use bypasses Nexus.

## Quick start

You need **Node.js 20 or newer** and one coding agent (Claude Code, Codex or OpenCode). The desktop app runs a small local server with your Node, and shows a "Get Node.js" prompt if it is missing or too old.

**Installer:** download the build for your system from the project's GitHub Releases (unsigned for now, so your OS may ask you to confirm opening it).

**From source:** also install Rust (via [rustup](https://rustup.rs)) and the [Tauri desktop libraries](https://tauri.app/start/prerequisites/) for your OS, then:

```sh
npm install
npm run tauri dev
```

The app starts the local Nexus server for you (`http://localhost:3939/mcp`; set `NEXUS_HTTP_PORT` to change the port) and stops it when you close the window. The wizard header shows whether it is running. Without the desktop app you can still run it yourself with `node mcp/nexus-http-server.mjs`.

On first launch the setup wizard takes about two minutes:

1. **Project:** pick the folder your agent works in.
2. **Agent:** pick your agent and press Connect. Nexus adds one entry to that agent's project config, keeps your other servers and saves a backup first.
3. **See it work:** restart the agent in that folder and ask it "Which Nexus project am I in?". The wizard shows the call when it arrives.

Binding Supabase or GitHub to the project is optional and can be done at the end or later from the Project page (Bindings). Skipped setup resumes from Home ("Finish setup") or the Status checklist on the Project page.

### How the installer is built

`npm run tauri build` first runs `scripts/prepare-bundle.mjs`, which bundles the MCP server into one file (`src-tauri/resources/mcp/`) and builds the `nexus-keyring` helper as a Tauri sidecar (`src-tauri/binaries/`). Both are generated and git-ignored. The `Release installers` workflow does this on Linux, macOS (Apple silicon and Intel) and Windows and uploads a draft release.

## Current state

The desktop interface (dark and light themes, following the system setting) is now scaffolded with:

- a project overview;
- project switching;
- agent sessions;
- service connections;
- routing status (Guard is post-MVP);
- activity history;
- a desktop approval-store setup/lock screen (OS-keychain-backed);
- a Supabase publishable-key form in the desktop app.

The ~50-service catalog (paper §13) is bundled offline; its final list is
pending review. Guard is out of the MVP (paper §14).

The app starts with example projects. You can add projects and service names; these non-secret details are saved locally in the app. No project or agent has been verified or connected to a real service yet.

The desktop version uses the computer's secure keychain for **Supabase publishable keys and MCP approvals**. The browser preview cannot accept keys. Never enter a Supabase secret key, service-role key, database password, or personal access token in this interface. A saved key has not yet been checked against Supabase, and coding agents cannot use it yet.

## Run the interface

```sh
npm install
npm run dev
```

## Build the interface

```sh
npm run build
```

## Run the desktop app

Tauri also needs the desktop libraries for your operating system. After installing them:

```sh
npm run tauri dev
```

The app is being built with Tauri, React, TypeScript, Vite, and Rust.

## Approval-store limits (legacy “vault” screen)

The desktop app uses the operating system's secure keychain as an
OS-keychain-backed approval store. The password screen locks typed key access, and the app writes a secret-free lock state for the local Nexus bridge. The persistent HTTP bridge refuses agent MCP requests while locked (HTTP `423`) and resumes after unlock. Health checks and safe project context stay available.

The app shows saved project/service names, but never displays the key values. The stdio bridge is archived (see [mcp/README](mcp/README.md) appendix): the persistent HTTP endpoint is the only supported transport, and the only path where lock enforcement applies to agent calls.

The browser preview (`npm run dev`) does not unlock the keychain or accept keys. This is an early approval store, not a finished credential broker. Nexus cannot yet verify which Supabase project owns a key, connect a coding agent, or protect commands run outside Nexus.

The Linux desktop app has now built and opened successfully on Linux Mint 22. `npm run build` checks the web interface only; `npm run tauri dev` opens the desktop app.

## Codex bridge (early)

Codex can discover selected **real provider MCP tools through Nexus**. Nexus forwards approved, read-only Supabase MCP calls instead of building a replacement tool for each provider action. See [the bridge setup and limits](mcp/README.md). This is still a test-stage bridge: approvals do not refresh yet, and an agent with local shell access is not isolated from the keychain helper.

```sh
npm run test:mcp
```

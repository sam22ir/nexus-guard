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

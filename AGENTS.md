# Repository Guidelines

Source of truth: Notion paper “Nexus — Product & Technical Strategy” + `CONTEXT.md` + `docs/DECISIONS.md` (open items in `docs/OPEN-QUESTIONS.md`).

## Project Structure

Nexus Guard has two related interfaces and a small MCP bridge:

- `src/` — React and TypeScript desktop UI.
- `src-tauri/` — Tauri and Rust desktop code, including keychain access and Rust tests in `src-tauri/tests/`.
- `mcp/` — the Nexus MCP server, provider rules, and Node test files.
- `nexus guard website/` — the separate Vite/Cloudflare website.
- `public/` — desktop web assets; `src-tauri/icons/` — desktop icons.
- `docs/` — product, feasibility, and validation notes. Keep these aligned with real behavior.

`.nexus/` stores local project identity and is ignored by Git. Never commit keys, tokens, passwords, or local audit data.

## Build, Test, and Development Commands

Run from the repository root:

```sh
npm install             # install desktop dependencies
npm run dev             # start the Vite UI
npm run build           # type-check and build the desktop web UI
npm run tauri dev       # open the native Tauri app
npm run test:mcp        # run all MCP bridge tests
cargo test --manifest-path src-tauri/Cargo.toml  # run Rust tests
```

For the website, run from `nexus guard website/`:

```sh
npm install
npm run dev
npm run build
npm run deploy         # build and deploy with Wrangler; use only when release is intended
```

## Coding Style and Naming

Use two spaces in Markdown and the existing TypeScript/Rust formatting style. Keep TypeScript strict and avoid unused variables; `npm run build` checks this. Use `PascalCase` for React components, `camelCase` for functions and values, and kebab-case for new documentation filenames. Keep security decisions in the MCP policy modules instead of duplicating them in UI code.

## Testing Guidelines

MCP tests use Node's built-in test runner and follow `*.test.mjs`. Add tests beside the code they cover, especially for isolation, approval, write blocking, and secret-free logging. Run `npm run test:mcp` before submitting changes. Add Rust tests under `src-tauri/tests/` when changing native behavior.

## Commits and Pull Requests

This checkout has no Git commit history yet, so no existing message style can be confirmed. Use short imperative subjects, for example `Block unapproved provider writes`. Pull requests should explain the user-visible change, list verification commands, link related issues or docs, and include screenshots or a short recording for UI changes. Call out any security or configuration impact clearly.

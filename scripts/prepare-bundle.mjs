// Builds the two files the desktop app ships next to its UI so a packaged
// install needs nothing but Node.js:
//   1. src-tauri/resources/mcp/nexus-http-server.mjs  (the server, one file)
//   2. src-tauri/binaries/nexus-keyring-<target triple> (Tauri sidecar the
//      server uses to read approvals from the OS keychain)
// Usage: node scripts/prepare-bundle.mjs [dev|release]   (default: release)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv[2] === "dev" ? "dev" : "release";

export async function bundleServer(outfile) {
  await build({
    entryPoints: [path.join(root, "mcp", "nexus-http-server.mjs")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "warning",
    // Every bundled module would otherwise think it is the entry file.
    banner: { js: "globalThis.__NEXUS_BUNDLED = true; import { createRequire as __nxRequire } from 'node:module'; const require = __nxRequire(import.meta.url);" },
  });
}

function prepareKeyring() {
  const manifest = path.join(root, "src-tauri", "Cargo.toml");
  const triple = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
  if (!triple) throw new Error("Could not read the Rust target triple from `rustc -vV`.");
  const ext = triple.includes("windows") ? ".exe" : "";
  const outDir = path.join(root, "src-tauri", "binaries");
  const sidecar = path.join(outDir, `nexus-keyring-${triple}${ext}`);
  mkdirSync(outDir, { recursive: true });
  // The app's build script requires the sidecar to exist, and building the helper
  // runs that same script, so a placeholder comes first and the real binary replaces it.
  if (!existsSync(sidecar)) writeFileSync(sidecar, "");
  const args = ["build", "--manifest-path", manifest, "--bin", "nexus-keyring", ...(profile === "release" ? ["--release"] : [])];
  execFileSync("cargo", args, { stdio: "inherit" });
  copyFileSync(path.join(root, "src-tauri", "target", profile === "release" ? "release" : "debug", `nexus-keyring${ext}`), sidecar);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(path.join(root, "src-tauri", "resources", "mcp"), { recursive: true });
  await bundleServer(path.join(root, "src-tauri", "resources", "mcp", "nexus-http-server.mjs"));
  prepareKeyring();
  console.log(`Prepared the bundled server and keyring helper (${profile}).`);
}

// Builds the files the desktop app ships next to its UI so a packaged install
// needs no Node.js of its own:
//   1. src-tauri/resources/mcp/nexus-http-server.mjs  (the server as one ESM file;
//      the source-checkout fallback runs it with the user's Node)
//   2. src-tauri/binaries/nexus-keyring-<target triple> (Tauri sidecar the
//      server uses to read approvals from the OS keychain)
//   3. src-tauri/binaries/nexus-server-<target triple>[.exe] (the server as a
//      Node Single Executable Application: the official Node binary for the
//      target with the bundle injected)
// Usage: node scripts/prepare-bundle.mjs [dev|release]   (default: release)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv[2] === "dev" ? "dev" : "release";
const require = createRequire(import.meta.url);

// Injection fuse from the Node SEA documentation; it must match the Node binary.
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

// Node platform and arch names for each Rust target the app is built for, with
// the archive format Node publishes it in.
const NODE_TARGETS = {
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64", ext: "tar.xz" },
  "aarch64-unknown-linux-gnu": { platform: "linux", arch: "arm64", ext: "tar.xz" },
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64", ext: "tar.gz" },
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64", ext: "tar.gz" },
  "x86_64-pc-windows-msvc": { platform: "win", arch: "x64", ext: "zip" },
  "aarch64-pc-windows-msvc": { platform: "win", arch: "arm64", ext: "zip" },
};

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

function rustTriples() {
  const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
  if (!host) throw new Error("Could not read the Rust target triple from `rustc -vV`.");
  // `tauri build --target x` (Intel macOS on an Apple Silicon runner) passes x
  // here; the sidecars must be built for the same target as the app.
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || host;
  return { host, triple, cross: triple !== host };
}

function prepareKeyring({ triple, cross }) {
  const manifest = path.join(root, "src-tauri", "Cargo.toml");
  const ext = triple.includes("windows") ? ".exe" : "";
  const outDir = path.join(root, "src-tauri", "binaries");
  const sidecar = path.join(outDir, `nexus-keyring-${triple}${ext}`);
  mkdirSync(outDir, { recursive: true });
  // The app's build script requires the sidecar to exist, and building the helper
  // runs that same script, so a placeholder comes first and the real binary replaces it.
  if (!existsSync(sidecar)) writeFileSync(sidecar, "");
  const args = ["build", "--manifest-path", manifest, "--bin", "nexus-keyring", ...(profile === "release" ? ["--release"] : []), ...(cross ? ["--target", triple] : [])];
  execFileSync("cargo", args, { stdio: "inherit" });
  const built = path.join(root, "src-tauri", "target", ...(cross ? [triple] : []), profile === "release" ? "release" : "debug", `nexus-keyring${ext}`);
  copyFileSync(built, sidecar);
}

// `mainFormat: "module"` needs Node 25.5 or newer. Older Nodes accept the config
// and ignore that field, so the blob would hold the ESM bundle as if it were CJS.
function seaModuleFormatSupported(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return major > 25 || (major === 25 && minor >= 5);
}

// The Node platform and arch this script is running on.
function runningNodeTarget() {
  const platform = { linux: "linux", darwin: "darwin", win32: "win" }[process.platform];
  return { platform, arch: process.arch };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// The official Node binary of this exact version for the target, downloaded once
// into src-tauri/target/node-cache and checked against nodejs.org's SHASUMS256.txt.
async function nodeBinaryFor(version, target) {
  const cacheDir = path.join(root, "src-tauri", "target", "node-cache");
  const name = `node-${version}-${target.platform}-${target.arch}`;
  const archiveName = `${name}.${target.ext}`;
  const relative = target.platform === "win" ? "node.exe" : path.posix.join("bin", "node");
  const cached = path.join(cacheDir, name, ...relative.split("/"));
  if (existsSync(cached)) return cached;
  mkdirSync(cacheDir, { recursive: true });

  const sumsResponse = await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`);
  if (!sumsResponse.ok) throw new Error(`Could not fetch the Node.js ${version} checksums (HTTP ${sumsResponse.status}).`);
  const expected = (await sumsResponse.text())
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((fields) => fields[1] === archiveName)?.[0];
  if (!expected) throw new Error(`nodejs.org lists no ${archiveName} for ${version}.`);

  const archive = path.join(cacheDir, archiveName);
  if (!existsSync(archive) || sha256(archive) !== expected) {
    const response = await fetch(`https://nodejs.org/dist/${version}/${archiveName}`);
    if (!response.ok || !response.body) throw new Error(`Could not download ${archiveName} (HTTP ${response.status}).`);
    const partial = `${archive}.part`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if (sha256(partial) !== expected) {
      rmSync(partial, { force: true });
      throw new Error(`The download of ${archiveName} did not match nodejs.org's checksum, so it was discarded.`);
    }
    renameSync(partial, archive);
  }

  // Extract only the Node binary. bsdtar (macOS, Windows) reads .zip too.
  const extractDir = path.join(cacheDir, `${name}.partial`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xf", archive, "-C", extractDir, `${name}/${relative}`], { stdio: "inherit" });
  rmSync(path.join(cacheDir, name), { recursive: true, force: true });
  renameSync(path.join(extractDir, name), path.join(cacheDir, name));
  rmSync(extractDir, { recursive: true, force: true });
  return cached;
}

function serverExecutablePath(triple) {
  const ext = triple.includes("windows") ? ".exe" : "";
  return path.join(root, "src-tauri", "binaries", `nexus-server-${triple}${ext}`);
}

async function prepareServer({ triple, bundle }) {
  const out = serverExecutablePath(triple);
  mkdirSync(path.dirname(out), { recursive: true });

  const target = NODE_TARGETS[triple];
  if (!target) throw new Error(`No Node.js build is known for the target ${triple}.`);
  const running = runningNodeTarget();
  const sameHost = target.platform === running.platform && target.arch === running.arch;
  // In dev a missing executable is not fatal: the app runs the server with Node.
  // Truncate any older executable so that fallback is what runs, not a stale build.
  const skipInDev = (message) => {
    writeFileSync(out, "");
    console.warn(`${message} Dev falls back to running the server with Node.`);
  };
  if (profile === "dev" && !sameHost) {
    skipInDev(`Skipping the server executable for ${triple}: dev builds only the host.`);
    return;
  }
  if (!seaModuleFormatSupported()) {
    const message = `Building the server executable needs Node.js 25.5 or newer (SEA config with "mainFormat": "module"); this build runs Node ${process.version}, which ignores that field.`;
    if (profile === "dev") return skipInDev(message);
    throw new Error(`${message} Run the build with a newer Node.`);
  }

  const work = mkdtempSync(path.join(os.tmpdir(), "nexus-sea-"));
  try {
    const blob = path.join(work, "sea-prep.blob");
    const configPath = path.join(work, "sea-config.json");
    writeFileSync(configPath, JSON.stringify({
      main: bundle,
      output: blob,
      mainFormat: "module",
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }, null, 2));
    execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });

    const base = sameHost ? process.execPath : await nodeBinaryFor(process.version, target);
    const exe = path.join(work, path.basename(out));
    copyFileSync(base, exe);
    chmodSync(exe, 0o755);
    const mac = target.platform === "darwin";
    // Node's macOS binary is signed; the injected blob breaks that signature.
    if (mac) execFileSync("codesign", ["--remove-signature", exe], { stdio: "inherit" });
    const postject = path.join(path.dirname(require.resolve("postject/package.json")), "dist", "cli.js");
    execFileSync(process.execPath, [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SEA_FUSE, ...(mac ? ["--macho-segment-name", "NODE_SEA"] : [])], { stdio: "inherit" });
    if (mac) execFileSync("codesign", ["--sign", "-", exe], { stdio: "inherit" });
    copyFileSync(exe, out);
    chmodSync(out, 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(path.join(root, "src-tauri", "resources", "mcp"), { recursive: true });
  const bundle = path.join(root, "src-tauri", "resources", "mcp", "nexus-http-server.mjs");
  await bundleServer(bundle);
  const targets = rustTriples();
  // Tauri checks every externalBin while it builds (the keyring build runs that
  // script too), so the server's placeholder must exist before anything compiles.
  const serverOut = serverExecutablePath(targets.triple);
  mkdirSync(path.dirname(serverOut), { recursive: true });
  if (!existsSync(serverOut)) writeFileSync(serverOut, "");
  prepareKeyring(targets);
  await prepareServer({ triple: targets.triple, bundle });
  console.log(`Prepared the bundled server, its executable and the keyring helper (${profile}).`);
}

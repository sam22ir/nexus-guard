// Tests the executables from a built installer the way a user runs them, with
// no Node.js of their own: the server answers /healthz and the keyring helper
// reports a missing approval with its clean exit code. Exits non-zero on failure.
// Usage: node scripts/smoke-installer.mjs <nexus-server> <nexus-keyring>
//          [--run-under x86_64] [--expect-arch x86_64|arm64] [--files-only]
//   --run-under    run both executables through `arch -<arch>` (Rosetta on Apple Silicon)
//   --expect-arch  check the files' architecture with `file` (macOS and Linux)
//   --files-only   only check the files exist, are executable and match --expect-arch
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const positional = [];
const options = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    const name = argv[i].slice(2);
    if (name === "files-only") {
      options[name] = true;
    } else {
      options[name] = argv[i + 1];
      i += 1;
    }
  } else {
    positional.push(argv[i]);
  }
}
if (positional.length !== 2) {
  console.error("Usage: node scripts/smoke-installer.mjs <nexus-server> <nexus-keyring> [--run-under x86_64] [--expect-arch x86_64|arm64] [--files-only]");
  process.exit(2);
}
const [server, keyring] = positional.map((file) => path.resolve(file));
const ARCH_PATTERNS = { x86_64: /x86[-_]64/i, arm64: /arm64|aarch64/i };
if (options["expect-arch"] && !ARCH_PATTERNS[options["expect-arch"]]) fail(`Unknown architecture ${options["expect-arch"]}.`);
if (options["run-under"] && !ARCH_PATTERNS[options["run-under"]]) fail(`Unknown architecture ${options["run-under"]}.`);

// 1. The files are where the installer put them, non-empty and executable.
for (const [name, file] of [["nexus-server", server], ["nexus-keyring", keyring]]) {
  let info;
  try {
    info = statSync(file);
  } catch {
    fail(`${name} is missing at ${file}.`);
  }
  if (!info.isFile() || info.size === 0) fail(`${name} at ${file} is not a non-empty file.`);
  if (!isWindows) {
    try {
      accessSync(file, constants.X_OK);
    } catch {
      fail(`${name} at ${file} is not executable.`);
    }
  }
  console.log(`OK: ${name} is present (${Math.round(info.size / 1e6)} MB): ${file}`);
}

// 2. Architecture, when asked for. `file` is not on Windows, so this is macOS and Linux only.
if (options["expect-arch"]) {
  if (isWindows) fail("--expect-arch is not supported on Windows.");
  for (const [name, file] of [["nexus-server", server], ["nexus-keyring", keyring]]) {
    const described = spawnSync("file", ["-b", file], { encoding: "utf8" });
    if (described.status !== 0) fail(`file could not describe ${name}: ${described.stderr}`);
    if (!ARCH_PATTERNS[options["expect-arch"]].test(described.stdout)) {
      fail(`${name} is not ${options["expect-arch"]}: ${described.stdout.trim()}`);
    }
    console.log(`OK: ${name} is ${options["expect-arch"]}: ${described.stdout.trim()}`);
  }
}

if (options["files-only"]) {
  console.log("Installer files check passed (binaries not run).");
  process.exit(0);
}

// Run the executables under `arch -<arch>` when asked. The server check reads this
// through smoke-server.mjs; the keyring check below wraps its own command.
const underArch = options["run-under"];
if (underArch) process.env.NEXUS_SMOKE_UNDER_ARCH = underArch;

// 3. The server starts without Node and answers /healthz (the check lives in scripts/smoke-server.mjs).
const serverRun = spawnSync(process.execPath, [path.join(root, "scripts", "smoke-server.mjs"), server], {
  stdio: "inherit",
  timeout: 60_000,
  windowsHide: true,
});
if (serverRun.error || serverRun.status !== 0) fail(`The packaged server did not pass the health check (status ${serverRun.status ?? serverRun.signal}).`);

// 4. The keyring helper, asked about an approval that cannot exist, must exit 1.
// It prints "No saved approval for this connection." and exits 1 when the entry is
// missing. It maps every keychain error to that same exit 1, so on a runner with no
// Secret Service (Linux CI) an unavailable keychain also exits 1 and counts as the
// clean result. Exit 2 (bad arguments), a signal, a panic (101) or a hang are failures.
const keyCommand = underArch ? "arch" : keyring;
const keyArgs = [...(underArch ? [`-${underArch}`, keyring] : []), "github", "smoke-installer", "no-such-connection"];
const keyRun = spawnSync(keyCommand, keyArgs, { encoding: "utf8", timeout: 30_000, windowsHide: true });
const keyOutput = `${keyRun.stdout ?? ""}${keyRun.stderr ?? ""}`.trim();
if (keyRun.error) fail(`nexus-keyring could not run: ${keyRun.error.message}`);
if (keyRun.signal) fail(`nexus-keyring was killed by ${keyRun.signal}. Output:\n${keyOutput}`);
if (keyRun.status !== 1) fail(`nexus-keyring exited ${keyRun.status}, expected 1 (no saved approval). Output:\n${keyOutput}`);
console.log(`OK: nexus-keyring exits 1 for a missing approval. Output: ${keyOutput || "(none)"}`);

console.log("Installer smoke test passed.");

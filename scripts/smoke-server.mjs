// Start a built server executable and check it answers, the way the app runs
// it: no Node.js, no script argument. Exits non-zero on failure.
// Usage: node scripts/smoke-server.mjs [path-to-nexus-server]
// Default: src-tauri/binaries/nexus-server-<host triple>[.exe]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
const fallback = path.join(root, "src-tauri", "binaries", `nexus-server-${host}${host?.includes("windows") ? ".exe" : ""}`);
const binary = path.resolve(process.argv[2] ?? fallback);
if (!existsSync(binary) || statSync(binary).size === 0) {
  console.error(`No server executable at ${binary}.`);
  process.exit(1);
}

const port = 39391;
// NEXUS_SMOKE_UNDER_ARCH=x86_64 runs the executable through `arch -x86_64` (Rosetta on Apple Silicon).
const underArch = process.env.NEXUS_SMOKE_UNDER_ARCH;
const [command, commandArgs] = underArch ? ["arch", [`-${underArch}`, binary]] : [binary, []];
const child = spawn(command, commandArgs, { env: { ...process.env, NEXUS_HTTP_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
let exited = null;
child.on("exit", (code) => { exited = code; });

const stop = (code) => { child.kill(); process.exit(code); };
// Rosetta translates a large program on its first launch, which can take
// well over 20 seconds, so a run under another architecture waits longer.
const seconds = Number(process.env.NEXUS_SMOKE_TIMEOUT_S) || (underArch ? 120 : 20);
const started = Date.now();
for (let i = 0; i < seconds * 2; i += 1) {
  if (exited !== null) {
    console.error(`The server exited (${exited}) before answering:\n${output}`);
    process.exit(1);
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await res.json();
    if (res.status === 200 && body.ok === true) {
      console.log(`OK: ${path.basename(binary)} (${Math.round(statSync(binary).size / 1e6)} MB) answers /healthz after ${Math.round((Date.now() - started) / 1000)} s.`);
      stop(0);
    }
  } catch {
    // not listening yet
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`The server did not answer within ${seconds} seconds:\n${output || "(no output)"}`);
stop(1);

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
const child = spawn(binary, [], { env: { ...process.env, NEXUS_HTTP_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
let exited = null;
child.on("exit", (code) => { exited = code; });

const stop = (code) => { child.kill(); process.exit(code); };
for (let i = 0; i < 40; i += 1) {
  if (exited !== null) {
    console.error(`The server exited (${exited}) before answering:\n${output}`);
    process.exit(1);
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await res.json();
    if (res.status === 200 && body.ok === true) {
      console.log(`OK: ${path.basename(binary)} (${Math.round(statSync(binary).size / 1e6)} MB) answers /healthz.`);
      stop(0);
    }
  } catch {
    // not listening yet
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`The server did not answer within 20 seconds:\n${output}`);
stop(1);

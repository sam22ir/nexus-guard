import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundleServer } from "../scripts/prepare-bundle.mjs";

// The desktop app ships this single file and runs it with the user's Node, so it
// must start on its own, serve HTTP, and not start the deprecated stdio entry.
test("bundled server starts alone and answers /healthz", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-bundle-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nexus-http-server.mjs");
  await bundleServer(file);

  const child = spawn(process.execPath, [file], { env: { ...process.env, NEXUS_HTTP_PORT: "0", NEXUS_HTTP_HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 8000);
    child.stdout.on("data", () => {
      const match = /127\.0\.0\.1:(\d+)\/mcp/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });

  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.doesNotMatch(output, /stdio entrypoint is deprecated/i);
});

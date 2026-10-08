import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { isEntryFile } from "./entry.mjs";

const here = fileURLToPath(import.meta.url);

test("a module is the entry only when it is the file that was started", () => {
  // null, not undefined: undefined would fall back to process.argv[1] (the test runner).
  assert.equal(isEntryFile(import.meta.url, null), false);
  assert.equal(isEntryFile(import.meta.url, "/some/other/file.mjs"), false);
  assert.equal(isEntryFile(import.meta.url, here), true);
});

test("a bundled server is its own entry even with no script argument (single executable)", () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "__NEXUS_BUNDLED");
  const previous = globalThis.__NEXUS_BUNDLED;
  globalThis.__NEXUS_BUNDLED = true;
  try {
    assert.equal(isEntryFile(import.meta.url, undefined), true);
  } finally {
    if (had) globalThis.__NEXUS_BUNDLED = previous;
    else delete globalThis.__NEXUS_BUNDLED;
  }
});

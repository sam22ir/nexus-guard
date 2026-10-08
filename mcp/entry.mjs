// "Was this file started directly with node?" Compared after resolving links:
// macOS keeps temp folders under /var -> /private/var, and Windows may name a
// folder by its short 8.3 name, so plain path strings can differ for the same file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = (file) => {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
};

export function isEntryFile(metaUrl, argv1 = process.argv[1]) {
  // The bundled server is always its own entry. The desktop app starts the packaged
  // executable with no script argument (a Single Executable Application has no
  // script path, so argv[1] does not name the file), so the path check cannot match.
  if (globalThis.__NEXUS_BUNDLED) return true;
  if (!argv1) return false;
  return real(fileURLToPath(metaUrl)) === real(argv1);
}

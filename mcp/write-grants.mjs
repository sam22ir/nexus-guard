// Which bindings the developer has allowed to make changes. Kept in the app's
// own config folder, never in the project folder: an agent can edit the files
// in its workspace but must not be able to grant itself write access.
import fs from "node:fs/promises";
import path from "node:path";
import { nexusConfigDir } from "./config-dir.mjs";

export function writeGrantsPath(env = process.env) {
  if (typeof env.NEXUS_WRITE_GRANTS_FILE === "string" && env.NEXUS_WRITE_GRANTS_FILE.trim()) {
    return path.resolve(env.NEXUS_WRITE_GRANTS_FILE.trim());
  }
  return path.join(nexusConfigDir(env), "write-grants.json");
}

const keyFor = (projectId, connectionId) => `${projectId}:${connectionId}`;

/** True only when this exact binding was switched on. A missing or damaged file means no. */
export async function readWriteGrant(projectId, connectionId, filePath = writeGrantsPath()) {
  if (typeof projectId !== "string" || typeof connectionId !== "string" || !projectId || !connectionId) return false;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed?.grants?.[keyFor(projectId, connectionId)] === true;
  } catch {
    return false;
  }
}

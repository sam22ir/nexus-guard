// The one resource (one project, one site, one base…) a signed-in service
// binding is limited to. Kept in the app's own config folder, never in the
// project folder, so an agent cannot widen its own reach by editing files.
// No entry means the binding covers the whole signed-in account.
import fs from "node:fs/promises";
import path from "node:path";
import { nexusConfigDir } from "./config-dir.mjs";

export function bindingScopesPath(env = process.env) {
  if (typeof env.NEXUS_BINDING_SCOPES_FILE === "string" && env.NEXUS_BINDING_SCOPES_FILE.trim()) {
    return path.resolve(env.NEXUS_BINDING_SCOPES_FILE.trim());
  }
  return path.join(nexusConfigDir(env), "binding-scopes.json");
}

/** The value this exact binding is limited to, or null (whole account). */
export async function readBindingScope(projectId, connectionId, filePath = bindingScopesPath()) {
  if (typeof projectId !== "string" || typeof connectionId !== "string" || !projectId || !connectionId) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    const value = parsed?.scopes?.[`${projectId}:${connectionId}`];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

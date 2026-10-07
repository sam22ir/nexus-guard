// The one resource (one project, one site, one base…) a signed-in service
// binding is limited to. Kept in the app's own config folder, never in the
// project folder, so an agent cannot widen its own reach by editing files.
// No entry means the binding covers the whole signed-in account.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function bindingScopesPath(env = process.env) {
  if (typeof env.NEXUS_BINDING_SCOPES_FILE === "string" && env.NEXUS_BINDING_SCOPES_FILE.trim()) {
    return path.resolve(env.NEXUS_BINDING_SCOPES_FILE.trim());
  }
  const home = typeof env.HOME === "string" && env.HOME.trim() ? env.HOME : os.homedir();
  return path.join(home, ".config", "nexus-guard", "binding-scopes.json");
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

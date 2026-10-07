// Shared, secret-free lock state for the local Nexus HTTP bridge and Tauri app.
// A missing or damaged state file is treated as locked when enforcement is on.
import fs from "node:fs/promises";
import path from "node:path";
import { nexusConfigDir } from "./config-dir.mjs";

export function vaultStatePath(env = process.env) {
  if (typeof env.NEXUS_VAULT_STATE_FILE === "string" && env.NEXUS_VAULT_STATE_FILE.trim()) {
    return path.resolve(env.NEXUS_VAULT_STATE_FILE.trim());
  }
  if (typeof env.XDG_RUNTIME_DIR === "string" && env.XDG_RUNTIME_DIR.trim()) {
    return path.join(env.XDG_RUNTIME_DIR, "nexus-guard-vault-state.json");
  }
  return path.join(nexusConfigDir(env), "vault-state.json");
}

export async function readVaultState(filePath = vaultStatePath()) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return {
      locked: parsed?.locked !== false,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return { locked: true, updatedAt: null };
  }
}

export async function writeVaultState(locked, filePath = vaultStatePath()) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp-${process.pid}`;
  const payload = `${JSON.stringify({ locked: Boolean(locked), updatedAt: new Date().toISOString() })}\n`;
  await fs.writeFile(temporary, payload, { mode: 0o600 });
  await fs.rename(temporary, resolved);
  try {
    await fs.chmod(resolved, 0o600);
  } catch {
    // Windows and some mounted filesystems do not support chmod. The state is
    // secret-free; failure to change mode does not change the lock decision.
  }
}

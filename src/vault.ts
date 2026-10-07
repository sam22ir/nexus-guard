import { invoke, isTauri } from "@tauri-apps/api/core";

const text = new TextEncoder();

// Vault session gate — in-memory only by design.
//
// `unlocked` lives in module state, so a page reload re-locks the vault:
// every fresh load starts locked and the UI must re-verify saved-key badges
// after an explicit unlock (App refreshes `savedKeys` on lock/unlock
// transitions and reconciles the persisted `keySaved` flags on unlock, so a
// key deleted outside the app stops badging as saved).
//
// Publishable-key helpers require an unlocked session (browser approval is
// not involved there). MCP/token helpers intentionally bypass the gate: the
// tokens arrive via an in-session browser approval, which is itself the
// user's intent.
let unlocked = false;

export function desktopAvailable(): boolean {
  return isTauri();
}

/** Session view of the in-memory gate above (false again after any reload). */
export function isVaultUnlocked(): boolean {
  return unlocked;
}

export async function unlockVault(password: string): Promise<void> {
  if (!desktopAvailable()) throw new Error("Open the desktop app to use the vault.");
  const ok = await invoke<boolean>("vault_unlock", { password });
  if (!ok) throw new Error("That vault password is not correct.");
  unlocked = true;
}

export async function lockVault(): Promise<void> {
  if (desktopAvailable()) await invoke("vault_lock");
  unlocked = false;
}

function ensureUnlocked() {
  if (!unlocked) throw new Error("Unlock the vault first.");
}

function key(projectId: string, connectionId: string): string {
  return `supabase-publishable:${projectId}:${connectionId}`;
}

function mcpKey(projectId: string, connectionId: string): string {
  return `mcp:supabase:${projectId}:${connectionId}`;
}

export async function hasPublishableKey(projectId: string, connectionId: string): Promise<boolean> {
  ensureUnlocked();
  return invoke<boolean>("vault_has_secret", { key: key(projectId, connectionId) });
}

export async function savePublishableKey(projectId: string, connectionId: string, value: string): Promise<void> {
  ensureUnlocked();
  const candidate = value.trim();
  if (!candidate.startsWith("sb_publishable_")) {
    throw new Error("Use a Supabase publishable key (starts with sb_publishable_). Do not enter secret, service-role, or personal access keys.");
  }
  await invoke("vault_save_secret", { key: key(projectId, connectionId), value: candidate });
}

export async function removePublishableKey(projectId: string, connectionId: string): Promise<void> {
  ensureUnlocked();
  await invoke("vault_delete_secret", { key: key(projectId, connectionId) });
}

export async function saveMcpTokens(projectId: string, connectionId: string, tokens: { accessToken: string; refreshToken?: string; scope?: string }): Promise<void> {
  // No app-session gate: tokens arrive via an in-session browser approval, which is itself the user's intent.
  await invoke("vault_save_secret", { key: mcpKey(projectId, connectionId), value: JSON.stringify(tokens) });
}

export async function removeMcpTokens(projectId: string, connectionId: string): Promise<void> {
  await invoke("vault_delete_secret", { key: mcpKey(projectId, connectionId) });
}

export type SupabaseProjectChoice = { ref: string; name: string; region?: string | null; organization_id?: string | null; organization_name?: string | null };

export async function listSupabaseProjects(accessToken: string): Promise<SupabaseProjectChoice[]> {
  // No app-session gate: called with a just-approved token during connection setup.
  return invoke<SupabaseProjectChoice[]>("supabase_list_projects", { accessToken });
}

export function secretKeyFor(projectId: string, connectionId: string): string {
  return key(projectId, connectionId);
}

export function encodeForDisplay(value: string): Uint8Array {
  return text.encode(value);
}

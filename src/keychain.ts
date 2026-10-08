import { invoke, isTauri } from "@tauri-apps/api/core";

const text = new TextEncoder();

// Saved approvals and typed keys, kept in the system keychain (never in project
// files). There is no app password or lock: the keychain itself is the store.

export function desktopAvailable(): boolean {
  return isTauri();
}

function key(projectId: string, connectionId: string): string {
  return `supabase-publishable:${projectId}:${connectionId}`;
}

function mcpKey(projectId: string, connectionId: string, provider = "supabase"): string {
  return `mcp:${provider.toLowerCase()}:${projectId}:${connectionId}`;
}

export async function hasPublishableKey(projectId: string, connectionId: string): Promise<boolean> {
  return invoke<boolean>("keychain_has_secret", { key: key(projectId, connectionId) });
}

export async function savePublishableKey(projectId: string, connectionId: string, value: string): Promise<void> {
  const candidate = value.trim();
  if (!candidate.startsWith("sb_publishable_")) {
    throw new Error("Use a Supabase publishable key (starts with sb_publishable_). Do not enter secret, service-role, or personal access keys.");
  }
  await invoke("keychain_save_secret", { key: key(projectId, connectionId), value: candidate });
}

export async function removePublishableKey(projectId: string, connectionId: string): Promise<void> {
  await invoke("keychain_delete_secret", { key: key(projectId, connectionId) });
}

export async function saveMcpTokens(projectId: string, connectionId: string, tokens: { accessToken: string; refreshToken?: string; scope?: string }): Promise<void> {
  await invoke("keychain_save_secret", { key: mcpKey(projectId, connectionId), value: JSON.stringify(tokens) });
}

export async function removeMcpTokens(projectId: string, connectionId: string, provider = "supabase"): Promise<void> {
  await invoke("keychain_delete_secret", { key: mcpKey(projectId, connectionId, provider) });
}

export type SupabaseProjectChoice = { ref: string; name: string; region?: string | null; organization_id?: string | null; organization_name?: string | null };

export async function listSupabaseProjects(accessToken: string): Promise<SupabaseProjectChoice[]> {
  return invoke<SupabaseProjectChoice[]>("supabase_list_projects", { accessToken });
}

export function secretKeyFor(projectId: string, connectionId: string): string {
  return key(projectId, connectionId);
}

export function encodeForDisplay(value: string): Uint8Array {
  return text.encode(value);
}

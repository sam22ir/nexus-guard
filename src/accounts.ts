import type { Account, Connection, Project } from "./store";
import { accountKeyForConnection, accountLabelForConnection, starterAccounts } from "./store";

export type BlastRadiusEntry = {
  accountKey: string;
  accountLabel: string;
  provider: string;
  projectIds: string[];
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Canonical grouping key: stable across the accountId/account alias pair. */
export function accountGroupKey(provider: string, connection: Connection): string | undefined {
  const raw = accountKeyForConnection(connection);
  if (!raw) return undefined;
  // Canonical ids (e.g. "personal-supabase") are already unique per provider.
  // Legacy alias labels (e.g. "personal") are scoped by provider to avoid collisions.
  const normalized = normalizeKey(raw);
  if (normalized.includes("::") || normalized.includes("/") || normalized.startsWith("personal-")) {
    return normalized.includes("::") ? normalized : `${normalizeKey(provider)}::${normalized}`;
  }
  return `${normalizeKey(provider)}::${normalized}`;
}

/** List known accounts: registry defaults plus any extra entries, deduped by id. */
export function listAccounts(extra: Account[] = []): Account[] {
  const seen = new Set<string>();
  const out: Account[] = [];
  for (const account of [...starterAccounts, ...extra]) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);
    out.push(account);
  }
  return out;
}

/** Display label for an account id/key, falling back to the raw key. */
export function accountLabel(key: string | undefined, accounts: Account[] = starterAccounts): string | undefined {
  if (!key) return undefined;
  const found = accounts.find((a) => a.id === key);
  if (found) return found.label;
  if (key.includes("::")) return key.split("::").pop();
  return key;
}

/** Display label for a connection's account. */
export function labelForConnection(connection: Connection, accounts: Account[] = starterAccounts): string | undefined {
  return accountLabelForConnection(connection, accounts);
}

/** All projects linked to the given account key (matches either side of the alias). */
export function projectsUsingAccount(projects: Project[], accountKey: string): Project[] {
  const target = normalizeKey(accountKey);
  return projects.filter((p) =>
    (p.connections ?? []).some((c) => {
      const key = accountKeyForConnection(c);
      if (!key) return false;
      if (normalizeKey(key) === target) return true;
      const group = accountGroupKey(c.provider, c);
      return group === target;
    }),
  );
}

/**
 * Blast-radius detection: flag accounts linked to more than one project.
 * A shared login across projects is where one compromised/over-scoped
 * credential can affect multiple workspaces.
 */
export function detectBlastRadius(
  projects: Project[],
  accounts: Account[] = starterAccounts,
): BlastRadiusEntry[] {
  const groups = new Map<string, { provider: string; label: string; projectIds: Set<string> }>();
  for (const project of projects) {
    for (const connection of project.connections ?? []) {
      const groupKey = accountGroupKey(connection.provider, connection);
      if (!groupKey) continue;
      const label =
        labelForConnection(connection, accounts) ?? accountKeyForConnection(connection) ?? groupKey;
      let entry = groups.get(groupKey);
      if (!entry) {
        entry = { provider: connection.provider, label, projectIds: new Set<string>() };
        groups.set(groupKey, entry);
      }
      entry.projectIds.add(project.id);
    }
  }
  const out: BlastRadiusEntry[] = [];
  for (const [accountKey, entry] of groups) {
    if (entry.projectIds.size > 1) {
      out.push({
        accountKey,
        accountLabel: entry.label,
        provider: entry.provider,
        projectIds: [...entry.projectIds].sort(),
      });
    }
  }
  return out.sort((a, b) => a.accountKey.localeCompare(b.accountKey));
}

/**
 * Account options for a provider picker: filtered case-insensitively by
 * provider, sorted by label then id. Pure: no storage I/O. UI-ready for the
 * App.tsx account picker.
 */
export function accountOptionsForProvider(provider: string, accounts: Account[] = starterAccounts): Account[] {
  const name = provider.trim().toLowerCase();
  return accounts
    .filter((a) => a.provider.trim().toLowerCase() === name)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * Blast-radius entries affecting one project. Thin filter over
 * detectBlastRadius — UI-ready for a per-project <details> warning.
 * Pure: no storage I/O.
 */
export function blastRadiusWarningsFor(
  projectId: string,
  projects: Project[],
  accounts: Account[] = starterAccounts,
): BlastRadiusEntry[] {
  return detectBlastRadius(projects, accounts).filter((e) => e.projectIds.includes(projectId));
}

// TODO (remaining integrations, out of scope for this pure-helper pass):
// - App.tsx: account picker writes canonical accountId (see store.ts
//   makeCanonicalConnection/canonicalAccountIdFor) + per-project <details>
//   blast-radius warning via blastRadiusWarningsFor (ServicesView already uses
//   detectBlastRadius for the global list).
// - mcp/nexus-server.mjs: resolve project+account+resource per service, never bare provider.
// - Rust write_nexus_project_file / inspect_project_folder: persist
//   {"account","resource"} per service in .nexus/project.json.

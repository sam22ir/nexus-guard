import services from "../mcp/services.json";
export type AccountAuthState = "not_connected" | "pending" | "connected";

export type Account = {
  id: string;
  /** Human label shown in UI, e.g. "personal". Not a secret. */
  label: string;
  provider: string;
  authState: AccountAuthState;
};

export type Connection = {
  id: string;
  provider: string;
  short: string;
  target: string;
  /** Notion §2 Resource: concrete instance behind the service name. Alias of target for migration. */
  resource?: string;
  /** Notion §2 Account: login/owner that scopes the resource. Never a bare provider. */
  accountId?: string;
  /** Alias of accountId for migration (mirrors target/resource pattern). */
  account?: string;
  /** Notion §2 Environment: development | production | similar. */
  environment?: string;
  detail: string;
  tone: "blue" | "violet" | "green" | "orange";
  state: "Ready" | "Needs review";
  method?: "manual" | "mcp";
  authState?: "not_connected" | "pending" | "connected";
  /** Notion §6 Guard override: fixed rule for this binding (service scope, highest precedence).
   *  @deprecated Guard deferred per paper §14 — field stays stored for migration
   *  but UI must stop writing it. Read-side resolvers in guard.ts remain intact. */
  serviceOverride?: string;
  /** Alias of serviceOverride (mirrors target/resource pattern).
   *  @deprecated Guard deferred per paper §14 — do not write; kept for migration. */
  override?: string;
  /** Notion §6 Guard override: tag-scope rule applying to this binding.
   *  @deprecated Guard deferred per paper §14 — do not write; kept for migration. */
  tagOverride?: string;
  keySaved?: boolean;
  projectRef?: string;
  url?: string;
};

export type Project = {
  id: string;
  name: string;
  initials: string;
  path: string;
  branch: string;
  repo: string;
  /** Notion §2 Environment for this workspace registration. */
  environment: string;
  lastSeen: string;
  connections: Connection[];
};

const STORAGE_KEY = "nexus-guard.projects";
const ACCOUNTS_STORAGE_KEY = "nexus-guard.accounts";

export const starterAccounts: Account[] = [
  { id: "personal-supabase", label: "personal", provider: "Supabase", authState: "connected" },
  { id: "personal-clerk", label: "personal", provider: "Clerk", authState: "connected" },
  { id: "personal-github", label: "personal", provider: "GitHub", authState: "connected" },
  { id: "personal-sentry", label: "personal", provider: "Sentry", authState: "connected" },
];

export type ProviderTier = "native" | "curated" | "self-added";

export type ProviderMcp = { server: string; docs: string };

export type ProviderCatalogEntry = {
  provider: string;
  tier: Exclude<ProviderTier, "self-added">;
  tags: string[];
  /** MCP wiring state. `null` = unverified (no confirmed server/docs yet).
   *  Never guess URLs here — leave null until a server is verified. */
  mcp?: ProviderMcp | null;
};

/** Notion §6 catalog tiers: native = reviewed op-by-op; curated = known via passthrough, fail-closed; self-added = custom, fail-closed + confirm.
 *  Paper §13 offline catalog: ~50 services, multi-tag, tiers Native
 *  (Supabase, GitHub) / Curated (~48) / Self-added (anything else).
 *  Source of truth for enforcement is mcp/providers.mjs (NATIVE_PROVIDERS allowlists
 *  + fail-closed curated default). This mirror must match it: today exactly
 *  Supabase and GitHub are native in both places (see GITHUB_READ_TOOLS and
 *  mcp/github-native.test.mjs); everything else here is curated or self-added. */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // Database / backend
  { provider: "Supabase", tier: "native", tags: ["Database", "Auth", "Storage"], mcp: null },
  { provider: "Firebase", tier: "curated", tags: ["Database", "Auth", "Hosting"], mcp: null },
  { provider: "Convex", tier: "curated", tags: ["Database"], mcp: null },
  { provider: "Neon", tier: "curated", tags: ["Database"], mcp: null },
  { provider: "PlanetScale", tier: "curated", tags: ["Database"], mcp: null },
  { provider: "Turso", tier: "curated", tags: ["Database"], mcp: null },
  { provider: "MongoDB Atlas", tier: "curated", tags: ["Database"], mcp: null },
  { provider: "Upstash", tier: "curated", tags: ["Database", "Cache"], mcp: null },
  // Auth
  { provider: "Clerk", tier: "curated", tags: ["Auth"], mcp: null },
  { provider: "Auth0", tier: "curated", tags: ["Auth"], mcp: null },
  // SCM / CI
  { provider: "GitHub", tier: "native", tags: ["SCM", "CI"], mcp: null },
  { provider: "GitLab", tier: "curated", tags: ["SCM", "CI"], mcp: null },
  // Hosting
  { provider: "Vercel", tier: "curated", tags: ["Hosting"], mcp: null },
  { provider: "Netlify", tier: "curated", tags: ["Hosting"], mcp: null },
  { provider: "Cloudflare", tier: "curated", tags: ["Hosting", "Storage"], mcp: null },
  { provider: "Railway", tier: "curated", tags: ["Hosting"], mcp: null },
  { provider: "Render", tier: "curated", tags: ["Hosting"], mcp: null },
  { provider: "Fly.io", tier: "curated", tags: ["Hosting"], mcp: null },
  { provider: "DigitalOcean", tier: "curated", tags: ["Hosting"], mcp: null },
  // Observability
  { provider: "Sentry", tier: "curated", tags: ["Observability"], mcp: null },
  { provider: "PostHog", tier: "curated", tags: ["Observability", "Analytics"], mcp: null },
  { provider: "Datadog", tier: "curated", tags: ["Observability"], mcp: null },
  { provider: "Grafana", tier: "curated", tags: ["Observability"], mcp: null },
  { provider: "Mixpanel", tier: "curated", tags: ["Observability", "Analytics"], mcp: null },
  // Payments
  { provider: "Stripe", tier: "curated", tags: ["Payments"], mcp: null },
  { provider: "Paddle", tier: "curated", tags: ["Payments"], mcp: null },
  { provider: "LemonSqueezy", tier: "curated", tags: ["Payments"], mcp: null },
  { provider: "PayPal", tier: "curated", tags: ["Payments"], mcp: null },
  // Email / messaging infra
  { provider: "Resend", tier: "curated", tags: ["Email"], mcp: null },
  { provider: "SendGrid", tier: "curated", tags: ["Email"], mcp: null },
  { provider: "Twilio", tier: "curated", tags: ["Email", "SMS"], mcp: null },
  { provider: "Postmark", tier: "curated", tags: ["Email"], mcp: null },
  // Project management
  { provider: "Linear", tier: "curated", tags: ["Project mgmt"], mcp: null },
  { provider: "Jira", tier: "curated", tags: ["Project mgmt"], mcp: null },
  { provider: "Asana", tier: "curated", tags: ["Project mgmt"], mcp: null },
  // Docs
  { provider: "Notion", tier: "curated", tags: ["Docs", "Database"], mcp: null },
  { provider: "Confluence", tier: "curated", tags: ["Docs"], mcp: null },
  { provider: "Google Drive", tier: "curated", tags: ["Docs", "Storage"], mcp: null },
  // Chat
  { provider: "Slack", tier: "curated", tags: ["Chat"], mcp: null },
  { provider: "Discord", tier: "curated", tags: ["Chat"], mcp: null },
  // Design
  { provider: "Figma", tier: "curated", tags: ["Design"], mcp: null },
  // AI
  { provider: "OpenAI", tier: "curated", tags: ["AI"], mcp: null },
  { provider: "Replicate", tier: "curated", tags: ["AI"], mcp: null },
  { provider: "ElevenLabs", tier: "curated", tags: ["AI"], mcp: null },
  { provider: "HuggingFace", tier: "curated", tags: ["AI"], mcp: null },
  { provider: "Higgsfield", tier: "curated", tags: ["AI"], mcp: null },
  // Search / media
  { provider: "Algolia", tier: "curated", tags: ["Search"], mcp: null },
  { provider: "Cloudinary", tier: "curated", tags: ["Media", "Storage"], mcp: null },
  { provider: "Pinecone", tier: "curated", tags: ["Vectors", "Database"], mcp: null },
  // CMS
  { provider: "Sanity", tier: "curated", tags: ["CMS"], mcp: null },
  { provider: "Webflow", tier: "curated", tags: ["CMS", "Hosting"], mcp: null },
  // Data / automation
  { provider: "Airtable", tier: "curated", tags: ["Database"], mcp: null },
  { provider: "Zapier", tier: "curated", tags: ["Automation"], mcp: null },
];

/** Services Nexus can sign in to with one generic flow (mcp/services.json):
 *  the service's own remote MCP address, or null. Supabase and GitHub have their own flows. */
export function remoteServiceUrl(provider: string): string | null {
  const entry = (services as Record<string, { mcpUrl?: string } | string>)[provider.trim().toLowerCase()];
  return entry && typeof entry === "object" && typeof entry.mcpUrl === "string" ? entry.mcpUrl : null;
}

/** How this service names the one resource a binding can be limited to, or null (whole account only). */
export function remoteServiceScope(provider: string): { label: string; verified: boolean } | null {
  const entry = (services as Record<string, { scope?: { label?: string; args?: string[]; verified?: boolean } } | string>)[provider.trim().toLowerCase()];
  const scope = entry && typeof entry === "object" ? entry.scope : undefined;
  return scope && Array.isArray(scope.args) && scope.args.length > 0 ? { label: scope.label || "resource", verified: scope.verified === true } : null;
}

/** The lowercase slug used for this service's keychain entries and manifest key. */
export function serviceSlug(provider: string): string {
  return provider.trim().toLowerCase();
}

/** Spacing/punctuation-insensitive key for provider-name comparison
 *  ("Google Drive" === "GoogleDrive", "Hugging Face" === "HuggingFace"). */
function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Legacy provider names that resolve to a catalog entry. Unknown names
 *  stay self-added (fail-closed per paper §13). */
const PROVIDER_ALIASES: Record<string, string> = {
  mongodb: "mongodbatlas",
};

export function tierForProvider(provider: string): ProviderTier {
  const key = normalizeProviderKey(provider);
  const aliased = PROVIDER_ALIASES[key] ?? key;
  const found = PROVIDER_CATALOG.find((p) => normalizeProviderKey(p.provider) === aliased);
  return found ? found.tier : "self-added";
}

function normalizeAccountId(provider: string, label: string): string {
  const clean = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "account";
  return `${clean(label)}-${clean(provider)}`;
}

/**
 * Canonical account id for a (provider, label) pair. Pure: no storage I/O.
 * Same normalization as makeAccountId's base; uniqueness suffixing lives in
 * makeAccountId. App picker writes this id as Connection.accountId.
 */
export function canonicalAccountIdFor(provider: string, label: string): string {
  return normalizeAccountId(provider, label);
}

/** Input for canonical connection construction; all free-text fields. */
export type CanonicalConnectionInput = {
  provider: string;
  accountLabel: string;
  resource: string;
};

/**
 * Build the canonical account+resource fragment for a new connection. Pure:
 * no ids generated, no storage I/O. Caller assigns id/short/detail/tone/state.
 * Both alias sides (account/accountId, target/resource) are backfilled so old
 * readers keep working.
 */
export function makeCanonicalConnection(
  provider: string,
  accountLabel: string,
  resource: string,
): Pick<Connection, "provider" | "account" | "accountId" | "target" | "resource"> {
  const cleanProvider = provider.trim();
  const cleanLabel = accountLabel.trim();
  const cleanResource = resource.trim();
  return {
    provider: cleanProvider,
    account: cleanLabel,
    accountId: canonicalAccountIdFor(cleanProvider, cleanLabel),
    target: cleanResource,
    resource: cleanResource,
  };
}

/**
 * Validate account+resource free-text before building a connection.
 * Returns error strings; empty array = valid. Pure, no side effects.
 */
export function validateAccountResource(input: CanonicalConnectionInput): string[] {
  const errors: string[] = [];
  if (!input.provider || !input.provider.trim()) errors.push("provider must not be empty");
  if (!input.accountLabel || !input.accountLabel.trim()) errors.push("account must not be empty");
  if (!input.resource || !input.resource.trim()) errors.push("resource must not be empty");
  return errors;
}

export function makeAccountId(provider: string, label: string, existing: Account[]): string {
  const base = normalizeAccountId(provider, label);
  if (!existing.some((a) => a.id === base)) return base;
  let n = 2;
  while (existing.some((a) => a.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function loadAccounts(): Account[] {
  if (typeof window === "undefined") return starterAccounts;
  try {
    const saved = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!saved) return starterAccounts;
    const parsed = JSON.parse(saved) as Account[];
    if (!Array.isArray(parsed) || parsed.length === 0) return starterAccounts;
    return parsed.filter((a) => a && typeof a.id === "string" && typeof a.provider === "string");
  } catch {
    return starterAccounts;
  }
}

export function saveAccounts(accounts: Account[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  }
}

/** Resolve the stable account key for a connection (prefers accountId, falls back to legacy account alias). */
export function accountKeyForConnection(c: Connection): string | undefined {
  return c.accountId ?? c.account ?? undefined;
}

/** Human label for a connection's account; falls back to the raw key when no registry entry matches. */
export function accountLabelForConnection(c: Connection, accounts: Account[] = starterAccounts): string | undefined {
  const key = accountKeyForConnection(c);
  if (!key) return undefined;
  const byId = accounts.find((a) => a.id === key);
  if (byId) return byId.label;
  // Legacy alias entries store the bare label (e.g. "personal") — display as-is.
  // Remaining work (do NOT do here): App picker writes canonical accountId;
  // mcp/nexus-server.mjs and Rust write_nexus_project_file / inspect_project_folder
  // persist account+resource. See accounts.ts TODOs.
  return key.includes("::") ? key.split("::").pop() : key;
}

/** Canonical account duality (paper §13): `accountId` is the stable registry id
 *  (e.g. "personal-supabase"); `account` is the human display label
 *  (e.g. "personal"). New writers store both via makeCanonicalConnection;
 *  this helper derives the canonical pair from either side so legacy entries
 *  (bare-label `account` only, or `accountId` only) resolve identically.
 *  Pure: no storage I/O. */
export function manifestAccountFor(
  c: Pick<Connection, "provider" | "account" | "accountId">,
  accounts: Account[] = starterAccounts,
): Pick<Connection, "account" | "accountId"> {
  const rawId = c.accountId?.trim() || undefined;
  const rawLabel = c.account?.trim() || undefined;
  if (rawId && rawLabel) {
    // Legacy migration copied accountId -> account verbatim; prefer the
    // registry display label in that case.
    if (rawLabel === rawId) {
      const byId = accounts.find((a) => a.id === rawId);
      if (byId) return { accountId: rawId, account: byId.label };
    }
    return { accountId: rawId, account: rawLabel };
  }
  if (rawId) {
    const byId = accounts.find((a) => a.id === rawId);
    if (byId) return { accountId: rawId, account: byId.label };
    // Derive a display label by stripping the "-provider" suffix that
    // canonicalAccountIdFor appends (e.g. "personal-supabase" -> "personal").
    const slug = rawId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const providerSlug = c.provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (providerSlug && slug.endsWith(`-${providerSlug}`)) {
      const label = rawId.slice(0, -(providerSlug.length + 1)) || rawId;
      return { accountId: rawId, account: label };
    }
    return { accountId: rawId, account: rawId };
  }
  if (rawLabel) {
    // The label slot may hold a canonical id written by an old writer.
    const byId = accounts.find((a) => a.id === rawLabel);
    if (byId) return { accountId: byId.id, account: byId.label };
    return { accountId: canonicalAccountIdFor(c.provider, rawLabel), account: rawLabel };
  }
  return { accountId: undefined, account: undefined };
}

/** Backfill both sides of the target/resource and account/accountId aliases so old entries keep working.
 *  Canonical rule: accountId = stable id, account = display label (see manifestAccountFor). */
export function migrateConnection(c: Connection, fallbackEnvironment: string, accounts: Account[] = starterAccounts): Connection {
  const manifested = manifestAccountFor(c, accounts);
  return {
    ...c,
    target: c.target ?? c.resource ?? "",
    resource: c.resource ?? c.target,
    account: manifested.account ?? c.account ?? c.accountId,
    accountId: manifested.accountId ?? c.accountId ?? c.account,
    environment: c.environment ?? fallbackEnvironment,
  };
}

export const starterProjects: Project[] = [
  {
    id: "koupa",
    name: "Koupa",
    initials: "KO",
    path: "~/Projects/Koupa",
    branch: "main",
    repo: "github.com/saadi/koupa",
    environment: "production",
    lastSeen: "Active now",
    connections: [
      { id: "koupa-supabase", provider: "Supabase", short: "SB", target: "koupa-production", resource: "koupa-production", accountId: "personal-supabase", account: "personal", environment: "production", detail: "Database · Auth · Storage", tone: "green", state: "Needs review" },
      { id: "koupa-clerk", provider: "Clerk", short: "C", target: "koupa-auth", resource: "koupa-auth", accountId: "personal-clerk", account: "personal", environment: "production", detail: "Authentication", tone: "violet", state: "Needs review" },
      { id: "koupa-github", provider: "GitHub", short: "GH", target: "saadi/koupa", resource: "saadi/koupa", accountId: "personal-github", account: "personal", environment: "production", detail: "Repository", tone: "blue", state: "Needs review" },
      { id: "koupa-sentry", provider: "Sentry", short: "S", target: "koupa", resource: "koupa", accountId: "personal-sentry", account: "personal", environment: "production", detail: "Error tracking", tone: "orange", state: "Needs review" },
    ],
  },
  {
    id: "nabdh",
    name: "Nabdh",
    initials: "NA",
    path: "~/Projects/Nabdh",
    branch: "develop",
    repo: "github.com/saadi/nabdh",
    environment: "development",
    lastSeen: "12 min ago",
    connections: [
      { id: "nabdh-supabase", provider: "Supabase", short: "SB", target: "nabdh-development", resource: "nabdh-development", accountId: "personal-supabase", account: "personal", environment: "development", detail: "Database · Auth", tone: "green", state: "Needs review" },
      { id: "nabdh-clerk", provider: "Clerk", short: "C", target: "nabdh-auth", resource: "nabdh-auth", accountId: "personal-clerk", account: "personal", environment: "development", detail: "Authentication", tone: "violet", state: "Needs review" },
      { id: "nabdh-github", provider: "GitHub", short: "GH", target: "saadi/nabdh", resource: "saadi/nabdh", accountId: "personal-github", account: "personal", environment: "development", detail: "Repository", tone: "blue", state: "Needs review" },
    ],
  },
];

export function loadProjects(): Project[] {
  if (typeof window === "undefined") return starterProjects;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return starterProjects;
    const projects = JSON.parse(saved) as Project[];
    if (!Array.isArray(projects) || projects.length === 0) return starterProjects;
    // Migrate pre-Environment entries (Notion §2): default from branch/target.
    // Also preserves pre-Account entries: old {target} connections without
    // account/accountId keep working with both alias sides backfilled.
    return projects.map((p) => {
      const fallbackEnv =
        typeof p.environment === "string" && p.environment
          ? p.environment
          : p.branch === "main"
            ? "production"
            : "development";
      return {
        ...p,
        environment: fallbackEnv,
        connections: (p.connections ?? []).map((c) => migrateConnection(c, p.environment ?? fallbackEnv)),
      };
    });
  } catch {
    return starterProjects;
  }
}

export function saveProjects(projects: Project[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function initialsFor(name: string) {
  const letters = name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2);
  return (letters || "NX").toUpperCase();
}

// Provider registry + generic MCP-passthrough scaffold (Notion §6 three tiers).
// Additive by design: does NOT change Supabase behavior in nexus-server.mjs.
// - Native: Supabase (existing), GitHub (new) — operation-by-operation allowlist.
// - Curated / Self-added: any other provider via generic passthrough — every
//   operation defaults to approval_required (fail closed) until reclassified.
// Secret-free by construction: no tokens here, only names/tiers/allowlist.
//
// Phase 1 (Guard hide, MVP): cost-bearing axis (isCostBearing) is DEFERRED-PAID —
// annotated, never enforced in MVP routing. Unknown-tier default is "self-added"
// to match UI vocabulary; enforcement stays fail-closed (approval_required) for
// both curated and self-added. Do NOT delete enforcement.

export const PROVIDER_TIERS = Object.freeze(["native", "curated", "self-added"]);

/** Minimal native read allowlists. Runtime still intersects with upstream listTools. */
export const SUPABASE_READ_TOOLS = Object.freeze([
  "list_tables",
  "list_extensions",
  "list_migrations",
  "get_project_url",
  "generate_typescript_types",
  "get_logs",
  "get_advisors",
  "list_edge_functions",
  "get_edge_function",
  "search_docs",
]);

export const GITHUB_READ_TOOLS = Object.freeze([
  "search_repositories",
  "search_code",
  "search_issues",
  "search_users",
  "get_repository",
  "get_file_contents",
  "list_branches",
  "get_branch",
  "list_commits",
  "get_commit",
  "list_issues",
  "get_issue",
  "get_issue_comments",
  "list_pull_requests",
  "get_pull_request",
  "get_pull_request_comments",
  "get_pull_request_diff",
  "list_workflows",
  "get_workflow_run",
]);

const NATIVE_PROVIDERS = Object.freeze({
  supabase: {
    tier: "native",
    proxyPrefix: "supabase__",
    readTools: new Set(SUPABASE_READ_TOOLS),
    costBearingDefault: false,
  },
  github: {
    tier: "native",
    proxyPrefix: "github__",
    readTools: new Set(GITHUB_READ_TOOLS),
    costBearingDefault: false,
  },
});

export function normalizeProvider(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Tier for a provider name: native if reviewed, curated if known-beyond-native, self-added otherwise. */
export function providerTier(provider, knownCurated = []) {
  const name = normalizeProvider(provider);
  if (NATIVE_PROVIDERS[name]) return "native";
  if (Array.isArray(knownCurated) && knownCurated.map(normalizeProvider).includes(name)) return "curated";
  // DEFERRED-PAID note: unknown providers default to "self-added" to match UI
  // vocabulary. Enforcement is identical to curated (fail-closed approval);
  // only the label changed. Callers needing the curated/self-added distinction
  // pass knownCurated explicitly.
  return "self-added";
}

export function isNative(provider) {
  return providerTier(provider) === "native";
}

export function proxyPrefixFor(provider) {
  const name = normalizeProvider(provider);
  return NATIVE_PROVIDERS[name]?.proxyPrefix ?? `${name}__`;
}

export function readToolsFor(provider) {
  const name = normalizeProvider(provider);
  return NATIVE_PROVIDERS[name]?.readTools ?? new Set();
}

export function isReadTool(provider, operation) {
  return readToolsFor(provider).has(operation);
}

/**
 * Curated / self-added default: every operation requires approval.
 * Never silent allow. Overrides (service->tag->default) can still tighten to
 * always-block or, explicitly, auto-approve — resolved by resolveOverride
 * (DEFERRED-PAID: Guard OUT of MVP — hidden, routing stays approval_required).
 */
export function curatedDecision({ provider, operation, env, knownCurated = [] } = {}) {
  // Label matches providerTier: self-added unless explicitly curated.
  // Enforcement identical either way (fail-closed approval).
  const tier = providerTier(provider, knownCurated);
  return {
    decision: "approval_required",
    reason: `Unreviewed provider (${normalizeProvider(provider) || "unknown"}): every action defaults to requiring developer approval until reclassified (${operation ?? "unknown"} in ${env ?? "unknown"}).`,
    vocab: null,
    env: env ?? null,
    tier: tier === "native" ? "curated" : tier,
    audited: true,
    disconnect: false,
  };
}

/**
 * Stripe-style placeholder (DEFERRED-PAID: cost axis OUT of MVP — annotated
 * only, never enforced in MVP routing): providers with consumption pricing
 * mark ops cost-bearing.
 */
export function isCostBearing(provider, _operation) {
  const name = normalizeProvider(provider);
  if (NATIVE_PROVIDERS[name]) return NATIVE_PROVIDERS[name].costBearingDefault === true;
  return false;
}

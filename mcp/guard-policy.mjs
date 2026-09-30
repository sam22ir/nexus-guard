// Phase 5 Guard vocabulary + override scaffold (isolated module).
// Notion §6: adapters emit only a small vocab; a central (term,env)->tier table
// owns the decision. Unmapped terms fail closed to approval. Escape hatch
// requires a reason. Overrides resolve service->tag->default. Block never
// disconnects. Auto-approve is still audited. Cost-bearing is a boolean second
// axis (Supabase has no cost-bearing ops; scaffold only).
//
// Phase 1 (Guard hide, MVP OUT): costBearing second axis, escapeHatch, and
// resolveOverride chain are DEFERRED-PAID — annotated here, never enforced in
// MVP routing. MVP routing is read-allow/block only (see nexus-server.mjs
// GUARD_ENABLED gate). Do NOT delete enforcement; hide, don't break routing.
//
// Isolated by design: does NOT import nexus-server.mjs (no edits to existing
// server). Mirrors its conventions: ESM, pure decide* functions returning
// { decision, reason }, secret-free audit records.

/** Adapter-emitted vocabulary. Only these four terms leave adapters. */
export const VOCAB = Object.freeze(["read", "write", "destructive", "sensitive"]);

/** Valid override values for the service->tag->default chain. */
export const OVERRIDE_VALUES = Object.freeze(["auto-approve", "review-each-time", "always-block"]);

/** Tier decisions owned by the central table. */
export const TIER_DECISIONS = Object.freeze(["allow", "approval_required", "block"]);

// Mirror of DEFAULT_READ_TOOLS in mcp/nexus-server.mjs (kept local to stay isolated).
const READ_OPERATIONS = new Set([
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

const SENSITIVE_PATTERN = /(token|secret|password|private[_-]?key|credential|auth|api[_-]?key)/i;
const DESTRUCTIVE_PATTERN = /(apply_migration|delete_|drop_|truncate|destroy|remove_|pause_project|restore_project|deregister|revoke)/i;
const WRITE_PATTERN = /^(create_|update_|insert_|upsert_|execute_sql|run_|apply_)|(_branch$|_migration$|_function$)/i;
const GENERIC_READ_PATTERN = /^(list_|get_|search_|describe_|show_)/i;

/**
 * Central (vocab,env)->tier table. Key format is `${vocab}:${env}`.
 * Tiers are terminal decisions: allow | approval_required | block.
 * Reads are low-risk (allow everywhere). Writes need review outside dev.
 * Sensitive always needs review, blocked in production. Destructive is
 * blocked in production, review elsewhere. Unknown (vocab,env) pairs are
 * absent on purpose -> callers fail closed to approval_required.
 */
export const CENTRAL_TABLE = Object.freeze({
  "read:development": "allow",
  "read:test": "allow",
  "read:staging": "allow",
  "read:production": "allow",
  "write:development": "approval_required",
  "write:test": "approval_required",
  "write:staging": "approval_required",
  "write:production": "block",
  "sensitive:development": "approval_required",
  "sensitive:test": "approval_required",
  "sensitive:staging": "approval_required",
  "sensitive:production": "block",
  "destructive:development": "approval_required",
  "destructive:test": "approval_required",
  "destructive:staging": "approval_required",
  "destructive:production": "block",
});

/**
 * Map a provider operation name to the guard vocabulary.
 * Current read tools -> "read"; apply_migration / deletes -> "destructive";
 * generic mutating prefixes -> "write"; secret-ish names -> "sensitive".
 * Unknown operations -> null (caller must require approval).
 */
export function classify(operation) {
  if (typeof operation !== "string") return null;
  const op = operation.trim().toLowerCase();
  if (!op) return null;
  if (READ_OPERATIONS.has(op) || READ_OPERATIONS.has(operation)) return "read";
  // Sensitive wins over generic read/write prefixes (e.g. get_secret).
  if (SENSITIVE_PATTERN.test(op)) return "sensitive";
  if (DESTRUCTIVE_PATTERN.test(op)) return "destructive";
  if (WRITE_PATTERN.test(op)) return "write";
  if (GENERIC_READ_PATTERN.test(op)) return "read";
  return null;
}

/**
 * Central guard decision. Mirrors decidePolicy({environment,operation,isExposed})
 * conventions from nexus-server.mjs but keys off (vocab,env).
 *
 * DEFERRED-PAID (Guard OUT of MVP): costBearing + escapeHatch params are
 * annotated, never enforced when GUARD_ENABLED=false in nexus-server.mjs.
 * This function itself is unchanged (enforcement kept) so paid-tier callers
 * keep working; MVP routing simply never passes cost/escape flags.
 *
 * @param {object} args
 * @param {string|null} args.vocab - one of VOCAB, or null for unmapped.
 * @param {string} args.env - environment (development|test|staging|production).
 * @param {string} [args.operation] - raw operation name (for reason strings).
 * @param {boolean} [args.isExposed=true] - false means the adapter did not expose it.
 * @param {boolean} [args.costBearing=false] - second axis; true forces warn/approval.
 * @param {boolean} [args.escapeHatch=false] - escape hatch requested.
 * @param {string} [args.escapeReason] - required when escapeHatch is true.
 */
export function decideGuard({
  vocab,
  env,
  operation,
  isExposed = true,
  costBearing = false,
  escapeHatch = false,
  escapeReason,
} = {}) {
  const opLabel = typeof operation === "string" && operation ? operation : String(vocab ?? "unknown");

  // Unexposed tools are not enabled (mirrors decidePolicy fail-closed).
  if (isExposed === false) {
    return { decision: "block", reason: "This tool is not enabled by the guard policy. Use an allowed read tool, or ask the developer to enable it.", vocab: vocab ?? null, env };
  }

  // Unmapped vocabulary fails closed to approval (never silent allow).
  if (!VOCAB.includes(vocab)) {
    return {
      decision: "approval_required",
      reason: "This operation is not recognized, so developer approval is required. Ask the developer to review it.",
      vocab: vocab ?? null,
      env,
    };
  }

  const tier = CENTRAL_TABLE[`${vocab}:${env}`];
  if (!tier) {
    return {
      decision: "approval_required",
      reason: "This operation needs developer approval in this environment. Ask the developer to review it.",
      vocab,
      env,
    };
  }

  // Escape hatch: explicit reason overrides tier, but stays audited.
  if (escapeHatch === true) {
    const reason = typeof escapeReason === "string" ? escapeReason.trim() : "";
    if (!reason) {
      return { decision: "block", reason: "An override needs a written reason. Retry with a reason, or ask the developer.", vocab, env };
    }
    if (tier === "allow" && costBearing !== true) {
      return { decision: "allow", reason: `Escape hatch noted (already allowed): ${reason}`, vocab, env, escapeHatch: true };
    }
    const costNote = costBearing === true ? " Cost-bearing flag noted." : "";
    return {
      decision: "allow",
      reason: `Escape hatch approved: ${reason} (overrode tier ${tier} for ${vocab}/${env}).${costNote}`,
      vocab,
      env,
      escapeHatch: true,
      costBearing: costBearing === true,
    };
  }

  // Cost-bearing second axis (scaffold; Supabase has no cost-bearing ops).
  // An allow is escalated to approval with a warning; stricter tiers keep
  // their decision and gain a warning note.
  if (costBearing === true) {
    if (tier === "allow") {
      return {
        decision: "approval_required",
        reason: "This operation may incur cost, so developer approval is required. Ask the developer to review it.",
        vocab,
        env,
        costBearing: true,
        warning: "cost-bearing",
      };
    }
    return {
      decision: tier,
      reason: "This operation may incur cost and is restricted in this environment. Ask the developer to review it.",
      vocab,
      env,
      costBearing: true,
      warning: "cost-bearing",
    };
  }

  if (tier === "allow") return { decision: "allow", reason: `Low-risk ${vocab} in ${env}; auto-allowed through Nexus.`, vocab, env };
  if (tier === "approval_required") {
    return { decision: "approval_required", reason: "This operation needs developer approval in this environment. Ask the developer to review it.", vocab, env };
  }
  return { decision: "block", reason: "This type of operation is blocked in this environment. Ask the developer to run it elsewhere or change the policy.", vocab, env };
}

function normalizeOverride(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/_/g, "-");
  if (v === "inherit" || v === "") return null;
  if (v === "auto-approve" || v === "autoapprove") return "auto-approve";
  if (v === "review-each-time" || v === "review") return "review-each-time";
  if (v === "always-block" || v === "alwaysblock" || v === "block") return "always-block";
  return null;
}

const OVERRIDE_TO_DECISION = {
  "auto-approve": "allow",
  "review-each-time": "approval_required",
  "always-block": "block",
};

/**
 * Resolve the override chain with visible inheritance.
 * DEFERRED-PAID (Guard OUT of MVP): hidden by GUARD_ENABLED=false in
 * nexus-server.mjs applyOverride. Kept (not deleted) so paid tier + existing
 * unit tests keep working; MVP routing ignores overrides entirely.
 * Precedence: serviceOverride > tagOverride > default.
 * "inherit"/null/undefined fall through; all-empty falls back to the safe
 * default "review-each-time". Block never disconnects (disconnect:false).
 * Every resolution is auditable (audited:true), including auto-approve.
 */
export function resolveOverride({ serviceOverride, tagOverride, default: defaultOverride } = {}) {
  const service = normalizeOverride(serviceOverride);
  const tag = normalizeOverride(tagOverride);
  const def = normalizeOverride(defaultOverride);
  const override = service ?? tag ?? def ?? "review-each-time";
  const source = service ? "service" : tag ? "tag" : def ? "default" : "default";
  const decision = OVERRIDE_TO_DECISION[override];
  return {
    override,
    source,
    decision,
    // Visible inheritance: which level contributed what.
    chain: { service: service ?? null, tag: tag ?? null, default: def ?? null },
    // Block != disconnect: a block decision never tears down the connection.
    disconnect: false,
    // Auto-approve is still audited.
    audited: true,
  };
}

/**
 * Build a secret-free audit record for guard decisions. Drops token-ish keys
 * (tokens, secrets, headers, raw arguments) by construction.
 */
export function auditGuard(entry = {}) {
  const { __context, token, accessToken, secret, password, authorization, headers, arguments: _args, args: _a2, ...rest } = entry;
  void __context;
  void token;
  void accessToken;
  void secret;
  void password;
  void authorization;
  void headers;
  void _args;
  void _a2;
  return {
    ts: new Date().toISOString(),
    operation: rest.operation ?? null,
    vocab: rest.vocab ?? null,
    env: rest.env ?? rest.environment ?? null,
    decision: rest.decision ?? null,
    reason: rest.reason ?? null,
    override: rest.override ?? null,
    overrideSource: rest.overrideSource ?? rest.source ?? null,
    costBearing: rest.costBearing === true,
    escapeHatch: rest.escapeHatch === true,
    audited: true,
    disconnect: false,
  };
}

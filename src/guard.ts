// Display mirror of mcp/guard-policy.mjs (override types + precedence resolver).
// Adapters emit a 4-term vocabulary; the central (vocabulary, environment)
// table owns the decision; overrides resolve service -> tag -> default.
// Read-only display port — no persistence here. Do not import the .mjs
// directly (MCP runtime boundary); keep this mirror in sync by hand.
//
// Paper §14 — Guard DEFERRED: override fields stay stored (see Connection
// serviceOverride/override/tagOverride in store.ts) but UI must stop writing
// them. Everything marked @deprecated below is read-side only: resolvers stay
// intact so stored values keep displaying, but no new writes should occur.

export type GuardVocab = "read" | "write" | "destructive" | "sensitive";

export type GuardEnv = "development" | "test" | "staging" | "production";

export type GuardDecision = "allow" | "approval_required" | "block";

export type OverrideValue = "auto-approve" | "review-each-time" | "always-block";

/** @deprecated Guard deferred per paper §14 — read-side only; UI must stop writing overrides. */
export type OverrideSource = "service" | "tag" | "default";

/** Adapter-emitted vocabulary. Only these four terms leave adapters. */
export const VOCAB: readonly GuardVocab[] = ["read", "write", "destructive", "sensitive"];

/** Valid override values for the service -> tag -> default chain.
 *  @deprecated Guard deferred per paper §14 — read-side only; UI must stop writing overrides. */
export const OVERRIDE_VALUES: readonly OverrideValue[] = ["auto-approve", "review-each-time", "always-block"];

/** Tier decisions owned by the central table. */
export const TIER_DECISIONS: readonly GuardDecision[] = ["allow", "approval_required", "block"];

/**
 * Central (vocabulary, environment) -> tier table. Mirrors CENTRAL_TABLE in
 * mcp/guard-policy.mjs. Unknown pairs are absent on purpose — callers
 * fail closed to approval_required.
 */
export const CENTRAL_TABLE: Readonly<Record<`${GuardVocab}:${GuardEnv}`, GuardDecision>> = {
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
};

const OVERRIDE_TO_DECISION: Record<OverrideValue, GuardDecision> = {
  "auto-approve": "allow",
  "review-each-time": "approval_required",
  "always-block": "block",
};

function normalizeOverride(value: string | null | undefined): OverrideValue | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/_/g, "-");
  if (v === "inherit" || v === "") return null;
  if (v === "auto-approve" || v === "autoapprove") return "auto-approve";
  if (v === "review-each-time" || v === "review") return "review-each-time";
  if (v === "always-block" || v === "alwaysblock" || v === "block") return "always-block";
  return null;
}

/**
 * @deprecated Guard deferred per paper §14 — read-side only; UI must stop writing overrides.
 * Stored override values keep resolving for display; no new writes should occur.
 */
export type OverrideInput = {
  serviceOverride?: string | null;
  tagOverride?: string | null;
  default?: string | null;
};

/**
 * @deprecated Guard deferred per paper §14 — read-side only; UI must stop writing overrides.
 */
export type OverrideResolution = {
  override: OverrideValue;
  source: OverrideSource;
  decision: GuardDecision;
  chain: { service: OverrideValue | null; tag: OverrideValue | null; default: OverrideValue | null };
  /** A block decision never tears down the connection. */
  disconnect: false;
  /** Auto-approve is still audited. */
  audited: true;
};

/**
 * Resolve the override chain with visible inheritance.
 * Precedence: serviceOverride > tagOverride > default.
 * All-empty falls back to the safe default "review-each-time".
 *
 * @deprecated Guard deferred per paper §14 — read-side only. Resolvers stay
 * intact so stored values keep displaying, but UI must stop writing overrides.
 */
export function resolveOverride({ serviceOverride, tagOverride, default: defaultOverride }: OverrideInput = {}): OverrideResolution {
  const service = normalizeOverride(serviceOverride);
  const tag = normalizeOverride(tagOverride);
  const def = normalizeOverride(defaultOverride);
  const override = service ?? tag ?? def ?? "review-each-time";
  const source: OverrideSource = service ? "service" : tag ? "tag" : "default";
  return {
    override,
    source,
    decision: OVERRIDE_TO_DECISION[override],
    chain: { service, tag, default: def },
    disconnect: false,
    audited: true,
  };
}

/** Look up the central tier for a (vocabulary, environment) pair; null = fail closed to approval. */
export function centralTier(vocab: GuardVocab, env: GuardEnv): GuardDecision | null {
  return CENTRAL_TABLE[`${vocab}:${env}`] ?? null;
}

import test from "node:test";
import assert from "node:assert/strict";
import { VOCAB, CENTRAL_TABLE, classify, decideGuard, resolveOverride, auditGuard } from "./guard-policy.mjs";

test("low-risk read is auto-allowed (classify + central table)", () => {
  assert.equal(classify("list_tables"), "read");
  assert.equal(classify("get_logs"), "read");
  const got = decideGuard({ vocab: "read", env: "development", operation: "list_tables" });
  assert.equal(got.decision, "allow");
  const prod = decideGuard({ vocab: "read", env: "production", operation: "get_logs" });
  assert.equal(prod.decision, "allow");
  assert.ok(CENTRAL_TABLE["read:production"] === "allow");
});

test("unmapped operation requires approval (fail closed)", () => {
  assert.equal(classify("some_future_tool_xyz"), null);
  const got = decideGuard({ vocab: null, env: "development", operation: "some_future_tool_xyz" });
  assert.equal(got.decision, "approval_required");
  const unknown = decideGuard({ vocab: "teleport", env: "development", operation: "teleport" });
  assert.equal(unknown.decision, "approval_required");
});

test("production destructive is blocked; writes map to write/destructive", () => {
  assert.equal(classify("apply_migration"), "destructive");
  assert.equal(classify("execute_sql"), "write");
  const got = decideGuard({ vocab: "destructive", env: "production", operation: "apply_migration" });
  assert.equal(got.decision, "block");
  assert.match(got.reason, /block/i);
});

test("override precedence is service > tag > default with visible inheritance", () => {
  const s = resolveOverride({ serviceOverride: "always-block", tagOverride: "auto-approve", default: "auto-approve" });
  assert.equal(s.override, "always-block");
  assert.equal(s.source, "service");
  assert.equal(s.decision, "block");
  const t = resolveOverride({ serviceOverride: null, tagOverride: "auto-approve", default: "always-block" });
  assert.equal(t.override, "auto-approve");
  assert.equal(t.source, "tag");
  assert.equal(t.decision, "allow");
  const d = resolveOverride({ default: "always-block" });
  assert.equal(d.override, "always-block");
  assert.equal(d.source, "default");
  // Block != disconnect; auto-approve still audited.
  assert.equal(s.disconnect, false);
  assert.equal(t.audited, true);
  assert.deepEqual(Object.keys(s.chain).sort(), ["default", "service", "tag"]);
});

test("cost-bearing flag forces warn/approval even for low-risk reads", () => {
  const got = decideGuard({ vocab: "read", env: "development", operation: "list_tables", costBearing: true });
  assert.equal(got.decision, "approval_required");
  assert.equal(got.warning, "cost-bearing");
  assert.equal(got.costBearing, true);
});

test("escape hatch requires a reason, allows with reason (still audited)", () => {
  const missing = decideGuard({ vocab: "destructive", env: "production", operation: "apply_migration", escapeHatch: true });
  assert.equal(missing.decision, "block");
  assert.match(missing.reason, /reason/i);
  const blank = decideGuard({ vocab: "destructive", env: "production", operation: "apply_migration", escapeHatch: true, escapeReason: "   " });
  assert.equal(blank.decision, "block");
  const ok = decideGuard({
    vocab: "destructive",
    env: "production",
    operation: "apply_migration",
    escapeHatch: true,
    escapeReason: "incident rollback approved by on-call",
  });
  assert.equal(ok.decision, "allow");
  assert.equal(ok.escapeHatch, true);
  assert.match(ok.reason, /Escape hatch approved/);
});

test("audit helper is secret-free and marks auto-approve audited without disconnect", () => {
  const r = resolveOverride({ serviceOverride: "auto-approve" });
  assert.equal(r.decision, "allow");
  assert.equal(r.audited, true);
  assert.equal(r.disconnect, false);
  const entry = auditGuard({
    operation: "list_tables",
    vocab: "read",
    env: "development",
    decision: "allow",
    reason: "ok",
    token: "sekret",
    accessToken: "sekret",
    headers: { Authorization: "Bearer x" },
    arguments: { sql: "select 1" },
  });
  assert.equal(entry.audited, true);
  assert.equal(entry.disconnect, false);
  assert.ok(!("token" in entry) && !("accessToken" in entry) && !("headers" in entry) && !("arguments" in entry));
});

test("VOCAB only exposes the four adapter terms", () => {
  assert.deepEqual([...VOCAB].sort(), ["destructive", "read", "sensitive", "write"]);
});

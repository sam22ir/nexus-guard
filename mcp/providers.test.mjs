import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_TIERS,
  providerTier,
  isNative,
  proxyPrefixFor,
  readToolsFor,
  isReadTool,
  curatedDecision,
} from "./providers.mjs";
import { decideGitHubExecute, decideCuratedExecute, approvedGitHub, approvedCurated } from "./nexus-server.mjs";

test("registry tiers: supabase+github native, others self-added fail-closed (matches UI)", () => {
  assert.ok(PROVIDER_TIERS.includes("native"));
  assert.equal(providerTier("supabase"), "native");
  assert.equal(providerTier("GitHub"), "native");
  // Phase 1: unknown defaults to self-added (was curated); enforcement identical.
  assert.equal(providerTier("stripe"), "self-added");
  assert.equal(providerTier("stripe", ["stripe"]), "curated");
  assert.equal(isNative("github"), true);
  assert.equal(isNative("notion"), false);
  assert.equal(proxyPrefixFor("github"), "github__");
  assert.equal(proxyPrefixFor("notion"), "notion__");
});

test("github allowlist is read-only and enforced", () => {
  assert.equal(isReadTool("github", "get_file_contents"), true);
  assert.equal(isReadTool("github", "search_repositories"), true);
  assert.equal(isReadTool("github", "create_issue"), false);
  assert.ok(readToolsFor("github").size > 0);
  assert.equal(readToolsFor("notion").size, 0);
});

test("github execute: reads allow, writes block, unknown requires approval", () => {
  const allow = decideGitHubExecute({ operation: "get_file_contents", env: "production" });
  assert.equal(allow.decision, "allow");
  const write = decideGitHubExecute({ operation: "create_issue", env: "development" });
  assert.equal(write.decision, "block");
  const unknown = decideGitHubExecute({ operation: "some_future_github_xyz", env: "development" });
  assert.equal(unknown.decision, "approval_required");
});

test("curated execute always requires approval, never silent allow", () => {
  const got = decideCuratedExecute({ provider: "notion", operation: "search", env: "development" });
  assert.equal(got.decision, "approval_required");
  assert.match(got.reason, /approval/i);
  assert.equal(got.audited, true);
  assert.equal(got.disconnect, false);
  const direct = curatedDecision({ provider: "stripe", operation: "create_charge", env: "production" });
  assert.equal(direct.decision, "approval_required");
});

test("approval helpers scope by account+resource, never bare provider", () => {
  const ctx = {
    status: "ready",
    project: "Koupa",
    project_id: "koupa",
    environment: "development",
    connections: [
      { provider: "github", target: "saadi/koupa", resource: "saadi/koupa", accountId: "personal-github", connection_id: "koupa-gh", status: "connected" },
      { provider: "notion", target: "koupa-docs", resource: "koupa-docs", accountId: "personal", connection_id: "koupa-notion", status: "connected" },
    ],
  };
  assert.ok(approvedGitHub(ctx));
  assert.equal(approvedGitHub(ctx, { target: "saadi/other" }), null);
  assert.equal(approvedGitHub(ctx, { account: "other" }), null);
  assert.ok(approvedCurated(ctx, "notion"));
  assert.equal(approvedCurated(ctx, "notion", { target: "other-docs" }), null);
  assert.equal(approvedCurated(ctx, "supabase"), null);
  assert.equal(approvedCurated(ctx, "github"), null);
});

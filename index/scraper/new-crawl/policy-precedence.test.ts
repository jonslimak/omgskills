import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRepoStatePrecedence,
  buildPolicyPrecedenceReport,
  renderPolicyPrecedenceReport,
} from "./policy-precedence.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, TrustedSeeds } from "./types.js";

function seeds(overrides: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...overrides,
  };
}

function repo(name: string, state: "library" | "rising" | "core"): ShadowRepoIndexEntry {
  return {
    repo: name,
    repoUrl: `https://github.com/${name}`,
    state,
    discoveredSources: ["baseline"],
    skillIds: [`${name}:skill`],
    skillCount: 1,
    stars: 100,
    lastSeenAt: "2026-07-22T00:00:00Z",
    lastRefreshedAt: "2026-07-22T00:00:00Z",
    trustSignals: ["gold-basket"],
    promotionReasons: ["gold-basket"],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: true,
    topSkillId: `${name}:skill`,
    topSkillStars: 100,
  };
}

test("observe reports unsafe repo-state promotion without changing it", () => {
  const index: ShadowRepoIndex = { generatedAt: "now", repoCount: 1, repos: [repo("catalog/repo", "core")] };
  const observations = applyRepoStatePrecedence(
    index,
    seeds({ catalogRepoRules: [{ repo: "catalog/repo", defaultProvenanceType: "catalog" }] }),
    false,
  );
  assert.equal(index.repos[0]?.state, "core");
  assert.deepEqual(observations.map((row) => row.reasonCode), ["catalog-repo"]);
});

test("enforce demotes unsafe repo state", () => {
  const index: ShadowRepoIndex = { generatedAt: "now", repoCount: 1, repos: [repo("mirror/repo", "rising")] };
  applyRepoStatePrecedence(
    index,
    seeds({ provenanceOverrides: [{ repo: "mirror/repo", provenanceType: "mirrored" }] }),
    true,
  );
  assert.equal(index.repos[0]?.state, "library");
  assert.deepEqual(index.repos[0]?.promotionReasons, ["non-original-provenance"]);
});

test("report groups changes by shared reason and bounds samples", () => {
  const report = buildPolicyPrecedenceReport({
    generatedAt: "2026-07-22T00:00:00Z",
    sourceCommit: "abc123",
    policyDigest: "sha256:test",
    mode: "observe",
    admissions: [{
      repo: "catalog/repo",
      legacyEligible: true,
      proposedEligible: false,
      legacyReasonCode: "official",
      proposedReasonCode: "catalog-repo",
      matchedSource: "catalogRepos",
      skippedSuppressedCandidateIds: ["catalog/repo:suppressed"],
    }],
    repoStates: [{ repo: "catalog/repo", currentState: "core", proposedState: "library", reasonCode: "catalog-repo" }],
    qualityTiers: [],
  });
  assert.equal(report.admissionChangeCount, 1);
  assert.equal(report.admissionObservationCount, 1);
  assert.equal(report.admissionAdditionCount, 0);
  assert.equal(report.admissionRemovalCount, 1);
  assert.equal(report.skippedSuppressedCandidateCount, 1);
  assert.equal(report.countsByReason["catalog-repo"], 2);
  assert.equal(report.countsByReason["suppressed-skill"], 1);
  assert.match(renderPolicyPrecedenceReport(report), /Mode: observe/);
  assert.match(renderPolicyPrecedenceReport(report), /Source commit: abc123/);
});

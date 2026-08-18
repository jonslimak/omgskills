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
    newRepoAdmissions: [],
    appliedAdmissionRepos: new Set(),
    finalRepoIndex: { generatedAt: "now", repoCount: 0, repos: [] },
    repoStates: [{ repo: "catalog/repo", currentState: "core", proposedState: "library", reasonCode: "catalog-repo" }],
    qualityTiers: [],
  });
  assert.equal(report.admissionChangeCount, 1);
  assert.equal(report.admissionObservationCount, 1);
  assert.equal(report.admissionAdditionCount, 0);
  assert.equal(report.admissionRemovalCount, 1);
  assert.equal(report.appliedAdmissionAdditionCount, 0);
  assert.equal(report.persistedAdmissionAdditionCount, 0);
  assert.equal(report.droppedAdmissionAdditionCount, 0);
  assert.equal(report.skippedSuppressedCandidateCount, 1);
  assert.equal(report.countsByReason["catalog-repo"], 2);
  assert.equal(report.countsByReason["suppressed-skill"], 1);
  assert.match(renderPolicyPrecedenceReport(report), /Mode: observe/);
  assert.match(renderPolicyPrecedenceReport(report), /Source commit: abc123/);
});

test("report distinguishes eligible applied persisted and dropped admissions", () => {
  const admissions = ["Owner/Persisted", "owner/dropped"].map((repoName) => ({
    repo: repoName,
    legacyEligible: false,
    proposedEligible: true,
    legacyReasonCode: "below-value-threshold" as const,
    proposedReasonCode: "trusted-creator" as const,
    matchedSource: "creators",
    skippedSuppressedCandidateIds: [],
  }));
  const report = buildPolicyPrecedenceReport({
    generatedAt: "2026-07-22T00:00:00Z",
    sourceCommit: "abc123",
    policyDigest: "sha256:test",
    mode: "admission",
    admissions,
    newRepoAdmissions: [
      {
        repo: "Owner/Persisted",
        sources: ["creator-watch"],
        eligible: true,
        reasonCode: "trusted-creator",
      },
      {
        repo: "owner/dropped",
        sources: ["official"],
        eligible: true,
        reasonCode: "official",
      },
      {
        repo: "owner/rejected",
        sources: ["code"],
        eligible: false,
        reasonCode: "below-value-threshold",
      },
    ],
    appliedAdmissionRepos: new Set(["owner/persisted", "OWNER/DROPPED", "other/repo"]),
    finalRepoIndex: {
      generatedAt: "now",
      repoCount: 1,
      repos: [repo("owner/persisted", "library")],
    },
    repoStates: [],
    qualityTiers: [],
  });

  assert.equal(report.admissionAdditionCount, 2);
  assert.equal(report.appliedAdmissionAdditionCount, 2);
  assert.equal(report.persistedAdmissionAdditionCount, 1);
  assert.equal(report.droppedAdmissionAdditionCount, 1);
  assert.equal(report.newRepoCandidateCount, 3);
  assert.equal(report.eligibleNewRepoCount, 2);
  assert.equal(report.appliedNewRepoCount, 2);
  assert.equal(report.persistedNewRepoCount, 1);
  assert.equal(report.droppedNewRepoCount, 1);
  assert.equal(report.eligibleNotAppliedCount, 0);
  assert.deepEqual(report.newRepoAdmissionSample, [
    {
      repo: "owner/dropped",
      sources: ["official"],
      reasonCode: "official",
      outcome: "dropped",
      skillCount: 0,
    },
    {
      repo: "owner/persisted",
      sources: ["creator-watch"],
      reasonCode: "trusted-creator",
      outcome: "persisted",
      skillCount: 1,
    },
  ]);
  assert.deepEqual(report.persistedAdmissionSample, [{
    repo: "owner/persisted",
    skillCount: 1,
    skillIds: ["owner/persisted:skill"],
  }]);
  assert.deepEqual(report.droppedAdmissionSample, [{
    repo: "owner/dropped",
    reason: "no-publishable-skills-after-refresh",
  }]);
  assert.match(renderPolicyPrecedenceReport(report), /Persisted admission additions: 1/);
  assert.match(renderPolicyPrecedenceReport(report), /owner\/dropped: no-publishable-skills-after-refresh/);
  assert.match(renderPolicyPrecedenceReport(report), /New repo candidates: 3/);
  assert.match(renderPolicyPrecedenceReport(report), /owner\/persisted: persisted, 1 publishable skills/);
});

test("observe mode does not classify an unapplied eligible addition as dropped", () => {
  const report = buildPolicyPrecedenceReport({
    generatedAt: "2026-07-22T00:00:00Z",
    sourceCommit: "abc123",
    policyDigest: "sha256:test",
    mode: "observe",
    admissions: [{
      repo: "owner/eligible",
      legacyEligible: false,
      proposedEligible: true,
      legacyReasonCode: "below-value-threshold",
      proposedReasonCode: "trusted-creator",
      matchedSource: "creators",
      skippedSuppressedCandidateIds: [],
    }],
    newRepoAdmissions: [{
      repo: "owner/eligible",
      sources: ["creator-watch"],
      eligible: true,
      reasonCode: "trusted-creator",
    }],
    appliedAdmissionRepos: new Set(),
    finalRepoIndex: { generatedAt: "now", repoCount: 0, repos: [] },
    repoStates: [],
    qualityTiers: [],
  });

  assert.equal(report.admissionAdditionCount, 1);
  assert.equal(report.appliedAdmissionAdditionCount, 0);
  assert.equal(report.persistedAdmissionAdditionCount, 0);
  assert.equal(report.droppedAdmissionAdditionCount, 0);
  assert.equal(report.newRepoCandidateCount, 1);
  assert.equal(report.eligibleNewRepoCount, 1);
  assert.equal(report.appliedNewRepoCount, 0);
  assert.equal(report.persistedNewRepoCount, 0);
  assert.equal(report.droppedNewRepoCount, 0);
  assert.equal(report.eligibleNotAppliedCount, 1);
});

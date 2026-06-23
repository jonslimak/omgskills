import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSteadyStateAcceptance } from "./verify-steady-state-acceptance.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, ShadowRunReport } from "./types.js";

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo">): ShadowRepoIndexEntry {
  const { repo: repoName, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "library",
    discoveredSources: ["baseline"],
    skillIds: [`${repoName}:skill`],
    skillCount: 1,
    stars: 10,
    lastSeenAt: "2026-06-04T00:00:00Z",
    lastRefreshedAt: "2026-06-04T00:00:00Z",
    lastCheapCheckedAt: null,
    lastObservedRepoUpdatedAt: null,
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: `${repoName}:skill`,
    topSkillStars: 10,
    ...rest,
  };
}

function repoIndex(repos: ShadowRepoIndexEntry[]): ShadowRepoIndex {
  return {
    generatedAt: "2026-06-04T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

function report(overrides: Partial<ShadowRunReport> = {}): ShadowRunReport {
  return {
    enrichmentCounts: {
      cheapReposChecked: 100,
      dailyPriorityRepoCount: 0,
      skillsDeepRefreshed: 45,
      monitoredDeepRefreshed: 40,
      cheapTriggeredRefreshCandidateCount: 5,
      cheapTriggeredRefreshDeferredCount: 0,
      cheapTriggeredDeepRefreshed: 5,
      carriedForwardCount: 0,
      correctedCount: 0,
      staleInvalidCandidateCount: 0,
    },
    stageTimings: {
      runRefresh: 30 * 60 * 1000,
    },
    ...overrides,
  } as ShadowRunReport;
}

test("passes when cheap checks, ratio, runtime, and admissions are in range", () => {
  const result = evaluateSteadyStateAcceptance(
    report(),
    repoIndex(Array.from({ length: 700 }, (_, index) => repo({ repo: `owner/repo-${index}` }))),
  );

  assert.equal(result.passed, true);
  assert.equal(result.metrics.weeklyCheapCheckTarget, 100);
  assert.equal(result.failures.length, 0);
});

test("weekly target excludes repo-missing quarantined repos", () => {
  const result = evaluateSteadyStateAcceptance(
    report({ enrichmentCounts: { ...report().enrichmentCounts, cheapReposChecked: 100 } }),
    repoIndex([
      ...Array.from({ length: 700 }, (_, index) => repo({ repo: `owner/repo-${index}` })),
      ...Array.from({ length: 70 }, (_, index) =>
        repo({
          repo: `owner/missing-${index}`,
          staleOrInvalidState: { reason: "repoMissing", observedRepoUpdatedAt: "" },
        }),
      ),
    ]),
  );

  assert.equal(result.metrics.eligibleRefreshableRepoCount, 700);
  assert.equal(result.metrics.weeklyCheapCheckTarget, 100);
  assert.equal(result.passed, true);
});

test("warns but does not fail for watch ranges", () => {
  const result = evaluateSteadyStateAcceptance(
    report({
      enrichmentCounts: {
        cheapReposChecked: 118,
        dailyPriorityRepoCount: 0,
        skillsDeepRefreshed: 58,
        monitoredDeepRefreshed: 40,
        cheapTriggeredRefreshCandidateCount: 18,
        cheapTriggeredRefreshDeferredCount: 0,
        cheapTriggeredDeepRefreshed: 18,
        carriedForwardCount: 0,
        correctedCount: 0,
        staleInvalidCandidateCount: 0,
      },
      stageTimings: { runRefresh: 50 * 60 * 1000 },
    }),
    repoIndex(Array.from({ length: 700 }, (_, index) => repo({ repo: `owner/repo-${index}` }))),
  );

  assert.equal(result.passed, true);
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("cheap check attempts")));
  assert.ok(result.warnings.some((warning) => warning.includes("cheap-triggered")));
  assert.ok(result.warnings.some((warning) => warning.includes("runRefresh")));
});

test("fails on hard threshold breaches", () => {
  const result = evaluateSteadyStateAcceptance(
    report({
      enrichmentCounts: {
        cheapReposChecked: 130,
        dailyPriorityRepoCount: 0,
        skillsDeepRefreshed: 80,
        monitoredDeepRefreshed: 40,
        cheapTriggeredRefreshCandidateCount: 30,
        cheapTriggeredRefreshDeferredCount: 0,
        cheapTriggeredDeepRefreshed: 30,
        carriedForwardCount: 0,
        correctedCount: 0,
        staleInvalidCandidateCount: 0,
      },
      stageTimings: { runRefresh: 61 * 60 * 1000 },
    }),
    repoIndex(Array.from({ length: 700 }, (_, index) => repo({ repo: `owner/repo-${index}` }))),
  );

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("cheap check attempts")));
  assert.ok(result.failures.some((failure) => failure.includes("cheap-triggered")));
  assert.ok(result.failures.some((failure) => failure.includes("runRefresh")));
});

test("fails when empty admitted repos persist", () => {
  const result = evaluateSteadyStateAcceptance(
    report(),
    repoIndex([
      ...Array.from({ length: 700 }, (_, index) => repo({ repo: `owner/repo-${index}` })),
      repo({ repo: "owner/empty", skillIds: [], topSkillId: null, promotionReasons: ["library-admission"] }),
    ]),
  );

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("empty admitted")));
});

test("fails clearly when required fields are missing", () => {
  const result = evaluateSteadyStateAcceptance(
    { enrichmentCounts: {}, stageTimings: {} } as ShadowRunReport,
    repoIndex([]),
  );

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("enrichmentCounts.cheapReposChecked")));
  assert.ok(result.failures.some((failure) => failure.includes("stageTimings.runRefresh")));
});

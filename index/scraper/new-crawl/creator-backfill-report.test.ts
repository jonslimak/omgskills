import assert from "node:assert/strict";
import test from "node:test";
import type { CreatorBackfillApplyProgress } from "./creator-backfill-apply.js";
import { creatorBackfillCandidateKey, creatorBackfillPlanFingerprint } from "./creator-backfill-apply.js";
import type { CreatorBackfillPlan, CreatorBackfillPlanCandidate } from "./creator-backfill-plan.js";
import { buildCreatorBackfillFinalReport, renderCreatorBackfillFinalReport } from "./creator-backfill-report.js";

function candidate(index: number): CreatorBackfillPlanCandidate {
  return {
    creator: "creator",
    repo: "creator/skills",
    repoUrl: "https://github.com/creator/skills",
    defaultBranch: "main",
    path: `skills/${index}/SKILL.md`,
    proposedId: `creator/skills:skills/${index}`,
  };
}

function plan(): CreatorBackfillPlan {
  return {
    version: 5,
    complete: true,
    generatedAt: "2026-08-17T00:00:00.000Z",
    sourceCommit: "abc",
    policyDigest: "sha256:policy",
    creatorRegistryRevision: "sha256:creators",
    quota: { initialRemaining: 4000, requiredAtStart: 3500, reservedForScheduledCrawler: 2000 },
    summary: {
      creatorCount: 1,
      repositoryCount: 1,
      discoveredSkillCount: 4,
      candidateCount: 2,
      excludedCount: 2,
      reviewRequiredRepositoryCount: 0,
    },
    creators: [{ handle: "creator", repositoryCount: 1, discoveredSkillCount: 4, candidateCount: 2 }],
    repositories: [{
      creator: "creator",
      repo: "creator/skills",
      discoveredSkillCount: 4,
      candidateCount: 2,
      excludedCount: 2,
      reviewRequired: false,
      reasons: [],
    }],
    candidates: [candidate(0), candidate(1)],
    exclusions: [
      {
        creator: "creator",
        repo: "creator/skills",
        path: "skills/2/SKILL.md",
        proposedId: "creator/skills:skills/2",
        reason: "already-present",
      },
      {
        creator: "creator",
        repo: "creator/skills",
        path: "tests/3/SKILL.md",
        proposedId: "creator/skills:tests/3",
        reason: "non-publishable-path",
      },
    ],
  };
}

function progress(value: CreatorBackfillPlan, secondStatus: "added" | "transient-failed"): CreatorBackfillApplyProgress {
  const outcomes = value.candidates.map((entry, index) => ({
    key: creatorBackfillCandidateKey(entry),
    id: entry.proposedId,
    creator: entry.creator,
    repo: entry.repo,
    path: entry.path,
    status: index === 0 ? "added" as const : secondStatus,
    attemptedAt: "2026-08-17T00:01:00.000Z",
    attemptCount: 1,
    ...(secondStatus === "transient-failed" && index === 1 ? { reason: "timeout" } : {}),
  }));
  return {
    version: 1,
    planFingerprint: creatorBackfillPlanFingerprint(value),
    planGeneratedAt: value.generatedAt,
    startedAt: "2026-08-17T00:01:00.000Z",
    updatedAt: "2026-08-17T00:01:00.000Z",
    stoppedReason: secondStatus === "added" ? "complete" : "limit",
    summary: {
      planCandidateCount: 2,
      finalCount: secondStatus === "added" ? 2 : 1,
      pendingCount: secondStatus === "added" ? 0 : 1,
      addedCount: secondStatus === "added" ? 2 : 1,
      existingCount: 0,
      policySkippedCount: 0,
      stableFailedCount: 0,
      transientFailedCount: secondStatus === "added" ? 0 : 1,
    },
    outcomes,
  };
}

test("final report blocks unresolved transient failures", () => {
  const reviewed = plan();
  const report = buildCreatorBackfillFinalReport({
    plan: reviewed,
    progress: progress(reviewed, "transient-failed"),
    generatedAt: "2026-08-17T00:02:00.000Z",
  });
  assert.equal(report.ready, false);
  assert.equal(report.summary.dispositionCount, 4);
  assert.equal(report.summary.transientFailedCount, 1);
  assert.match(renderCreatorBackfillFinalReport(report), /Ready: no/);
});

test("final report proves every discovered path has a final disposition", () => {
  const reviewed = plan();
  const report = buildCreatorBackfillFinalReport({
    plan: reviewed,
    progress: progress(reviewed, "added"),
    generatedAt: "2026-08-17T00:02:00.000Z",
  });
  assert.equal(report.ready, true);
  assert.deepEqual(report.summary, {
    discoveredSkillCount: 4,
    dispositionCount: 4,
    addedCount: 2,
    alreadyPresentCount: 1,
    policyRejectedCount: 0,
    invalidCount: 1,
    transientFailedCount: 0,
    pendingCount: 0,
    reviewRequiredRepositoryCount: 0,
  });
});

test("final report rejects progress from a different plan", () => {
  const reviewed = plan();
  const staleProgress = progress(reviewed, "added");
  staleProgress.planFingerprint = "sha256:stale";
  const report = buildCreatorBackfillFinalReport({
    plan: reviewed,
    progress: staleProgress,
    generatedAt: "2026-08-17T00:02:00.000Z",
  });
  assert.equal(report.ready, false);
  assert.match(report.issues.join("\n"), /different creator backfill plan/);
});

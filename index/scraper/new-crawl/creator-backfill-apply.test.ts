import test from "node:test";
import assert from "node:assert/strict";
import type { ShadowSkillRecord } from "./types.js";
import {
  creatorBackfillCandidateKey,
  executeCreatorBackfillApply,
  initializeCreatorBackfillApplyProgress,
  parseCreatorBackfillApplyLimit,
  type CreatorBackfillApplyProgress,
  type CreatorBackfillEnrichResult,
} from "./creator-backfill-apply.js";
import type {
  CreatorBackfillPlan,
  CreatorBackfillPlanCandidate,
} from "./creator-backfill-plan.js";
import {
  CREATOR_BACKFILL_SOURCE,
  type ShadowSkillPersistenceAddition,
} from "./shadow-skill-persistence.js";

const timestamp = "2026-08-10T20:00:00.000Z";

function candidate(index: number): CreatorBackfillPlanCandidate {
  return {
    creator: "creator",
    repo: "creator/skills",
    repoUrl: "https://github.com/creator/skills",
    defaultBranch: "main",
    path: `skills/${index}/SKILL.md`,
    proposedId: `Creator/Skills:skills/${index}`,
  };
}

function plan(count: number): CreatorBackfillPlan {
  const candidates = Array.from({ length: count }, (_, index) => candidate(index));
  return {
    version: 1,
    complete: true,
    generatedAt: timestamp,
    sourceCommit: "abc123",
    policyDigest: "sha256:policy",
    creatorRegistryRevision: "sha256:creators",
    quota: {
      initialRemaining: 4000,
      requiredAtStart: 3500,
      reservedForScheduledCrawler: 2000,
    },
    summary: {
      creatorCount: 1,
      repositoryCount: 1,
      discoveredSkillCount: count,
      candidateCount: count,
      excludedCount: 0,
      reviewRequiredRepositoryCount: 0,
    },
    creators: [{ handle: "creator", repositoryCount: 1, discoveredSkillCount: count, candidateCount: count }],
    repositories: [{
      creator: "creator",
      repo: "creator/skills",
      discoveredSkillCount: count,
      candidateCount: count,
      excludedCount: 0,
      reviewRequired: false,
      reasons: [],
    }],
    candidates,
    exclusions: [],
  };
}

function skillFor(candidateValue: CreatorBackfillPlanCandidate): ShadowSkillRecord {
  return {
    id: candidateValue.proposedId,
    name: candidateValue.path.split("/").at(-2) ?? "skill",
    description: "A useful creator skill with a valid description.",
    github_url: candidateValue.repoUrl,
    skill_md_path: candidateValue.path,
    install_cmd: "git clone",
    author_handle: "Creator",
    tags: [],
    stars: 10,
    last_updated: timestamp,
    first_seen: "2026-08-10",
    skill_md_sha: `sha-${candidateValue.proposedId}`,
    publisher_handle: "Creator",
    publisher_repo: candidateValue.repo,
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
  };
}

function addition(candidateValue: CreatorBackfillPlanCandidate): ShadowSkillPersistenceAddition {
  return {
    skill: skillFor(candidateValue),
    repoKey: candidateValue.repo,
    repoUrl: candidateValue.repoUrl,
    source: CREATOR_BACKFILL_SOURCE,
    isTrustedCreator: true,
  };
}

function harness(input: {
  plan: CreatorBackfillPlan;
  progress?: CreatorBackfillApplyProgress | null;
  limit?: number;
  reconcile?: (candidate: CreatorBackfillPlanCandidate) => Promise<Parameters<typeof executeCreatorBackfillApply>[0]["reconcile"] extends (...args: never[]) => Promise<infer R> ? R : never>;
  enrich?: (candidate: CreatorBackfillPlanCandidate) => Promise<CreatorBackfillEnrichResult>;
  reserveQuotaAvailable?: () => Promise<boolean>;
  persist?: (additions: ShadowSkillPersistenceAddition[]) => Promise<Array<{ id: string; status: "added" | "existing"; existingId?: string; reason?: string }>>;
  selection?: "pending-and-transient" | "transient-only";
}) {
  let preflightCount = 0;
  let reserveCheckCount = 0;
  const writes: CreatorBackfillApplyProgress[] = [];
  const persistBatchSizes: number[] = [];
  const enrichIds: string[] = [];
  const run = executeCreatorBackfillApply({
    plan: input.plan,
    progress: input.progress ?? null,
    limit: input.limit ?? 125,
    now: () => timestamp,
    initialQuotaPreflight: async () => { preflightCount += 1; },
    reserveQuotaAvailable: async () => {
      reserveCheckCount += 1;
      return input.reserveQuotaAvailable ? input.reserveQuotaAvailable() : true;
    },
    reconcile: input.reconcile ?? (async () => null),
    enrich: async (candidateValue) => {
      enrichIds.push(candidateValue.proposedId);
      return input.enrich
        ? input.enrich(candidateValue)
        : { status: "addition", addition: addition(candidateValue) };
    },
    persist: async (additions) => {
      persistBatchSizes.push(additions.length);
      return input.persist
        ? input.persist(additions)
        : additions.map((entry) => ({ id: entry.skill.id, status: "added" as const }));
    },
    writeProgress: (progress) => { writes.push(structuredClone(progress)); },
    selection: input.selection,
  });
  return {
    run,
    writes,
    persistBatchSizes,
    enrichIds,
    counts: () => ({ preflightCount, reserveCheckCount }),
  };
}

test("apply limit defaults to 125 and rejects values above the hard cap", () => {
  assert.equal(parseCreatorBackfillApplyLimit(undefined), 125);
  assert.equal(parseCreatorBackfillApplyLimit("150"), 150);
  assert.throws(() => parseCreatorBackfillApplyLimit("151"), /integer from 1 to 150/);
  assert.throws(() => parseCreatorBackfillApplyLimit("1.5"), /integer from 1 to 150/);
});

test("existing candidates finalize without quota or enrichment work", async () => {
  const testPlan = plan(2);
  const testHarness = harness({
    plan: testPlan,
    reconcile: async (candidateValue) => ({
      status: "existing",
      existingId: candidateValue.proposedId,
      reason: "current-shadow-state",
    }),
  });
  const progress = await testHarness.run;
  assert.equal(progress.stoppedReason, "complete");
  assert.equal(progress.summary.existingCount, 2);
  assert.deepEqual(testHarness.enrichIds, []);
  assert.deepEqual(testHarness.counts(), { preflightCount: 0, reserveCheckCount: 0 });
});

test("successful additions persist in bounded batches", async () => {
  const testHarness = harness({ plan: plan(12) });
  const progress = await testHarness.run;
  assert.equal(progress.summary.addedCount, 12);
  assert.deepEqual(testHarness.persistBatchSizes, [10, 2]);
  assert.equal(testHarness.counts().preflightCount, 1);
});

test("stable failures finalize while transient failures retry without blocking later candidates", async () => {
  const testPlan = plan(3);
  const first = harness({
    plan: testPlan,
    enrich: async (candidateValue) => {
      if (candidateValue.proposedId.endsWith("/0")) return { status: "stable-failed", reason: "skill-file-404" };
      if (candidateValue.proposedId.endsWith("/1")) return { status: "transient-failed", reason: "timeout" };
      return { status: "addition", addition: addition(candidateValue) };
    },
  });
  const firstProgress = await first.run;
  assert.equal(firstProgress.summary.stableFailedCount, 1);
  assert.equal(firstProgress.summary.transientFailedCount, 1);
  assert.equal(firstProgress.summary.addedCount, 1);
  assert.equal(firstProgress.summary.pendingCount, 1);
  assert.equal(firstProgress.outcomes.find((outcome) => outcome.status === "transient-failed")?.attemptCount, 1);

  const second = harness({
    plan: testPlan,
    progress: firstProgress,
    enrich: async (candidateValue) => ({ status: "addition", addition: addition(candidateValue) }),
  });
  const secondProgress = await second.run;
  assert.deepEqual(second.enrichIds, [testPlan.candidates[1]?.proposedId]);
  assert.equal(secondProgress.stoppedReason, "complete");
  assert.equal(secondProgress.summary.stableFailedCount, 1);
  assert.equal(secondProgress.summary.addedCount, 2);
  assert.equal(secondProgress.summary.transientFailedCount, 0);
  assert.equal(secondProgress.outcomes.find((outcome) => outcome.id.endsWith("/1"))?.attemptCount, 2);
});

test("transient-only retry does not process untouched pending candidates", async () => {
  const testPlan = plan(2);
  const first = await harness({
    plan: testPlan,
    limit: 1,
    enrich: async () => ({ status: "transient-failed", reason: "timeout" }),
  }).run;
  const secondHarness = harness({
    plan: testPlan,
    progress: first,
    selection: "transient-only",
  });
  const second = await secondHarness.run;
  assert.deepEqual(secondHarness.enrichIds, [testPlan.candidates[0]?.proposedId]);
  assert.equal(second.summary.addedCount, 1);
  assert.equal(second.summary.pendingCount, 1);
});

test("periodic quota failure stops cleanly and leaves later candidates pending", async () => {
  const testHarness = harness({
    plan: plan(30),
    reserveQuotaAvailable: async () => false,
  });
  const progress = await testHarness.run;
  assert.equal(progress.stoppedReason, "quota-reserve");
  assert.equal(progress.summary.addedCount, 25);
  assert.equal(progress.summary.pendingCount, 5);
  assert.deepEqual(testHarness.persistBatchSizes, [10, 10, 5]);
  assert.deepEqual(testHarness.counts(), { preflightCount: 1, reserveCheckCount: 1 });
});

test("failed persistence never reports pending additions as added", async () => {
  const testHarness = harness({
    plan: plan(1),
    persist: async () => { throw new Error("transaction failed"); },
  });
  await assert.rejects(() => testHarness.run, /transaction failed/);
  assert.equal(testHarness.writes.some((progress) => progress.summary.addedCount > 0), false);
});

test("progress resets for a different reviewed plan and keeps deterministic candidate keys", () => {
  const firstPlan = plan(1);
  const progress = initializeCreatorBackfillApplyProgress(firstPlan, null, timestamp);
  const changedPlan = { ...firstPlan, generatedAt: "2026-08-11T00:00:00.000Z" };
  const reset = initializeCreatorBackfillApplyProgress(changedPlan, progress, timestamp);
  assert.notEqual(reset.planFingerprint, progress.planFingerprint);
  assert.deepEqual(reset.outcomes, []);
  assert.equal(creatorBackfillCandidateKey(firstPlan.candidates[0]!), "creator/skills#skills/0/skill.md");
});

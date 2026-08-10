import { createHash } from "node:crypto";
import type { ShadowSkillPersistenceAddition } from "./shadow-skill-persistence.js";
import type { CreatorBackfillPlan, CreatorBackfillPlanCandidate } from "./creator-backfill-plan.js";

export const CREATOR_BACKFILL_APPLY_VERSION = 1;
export const CREATOR_BACKFILL_DEFAULT_APPLY_LIMIT = 125;
export const CREATOR_BACKFILL_MAX_APPLY_LIMIT = 150;
export const CREATOR_BACKFILL_PERSIST_BATCH_SIZE = 10;
export const CREATOR_BACKFILL_QUOTA_RECHECK_INTERVAL = 25;

export type CreatorBackfillApplyStatus =
  | "added"
  | "existing"
  | "policy-skipped"
  | "stable-failed"
  | "transient-failed";

export type CreatorBackfillApplyOutcome = {
  key: string;
  id: string;
  creator: string;
  repo: string;
  path: string;
  status: CreatorBackfillApplyStatus;
  attemptedAt: string;
  reason?: string;
  existingId?: string;
};

export type CreatorBackfillApplyProgress = {
  version: number;
  planFingerprint: string;
  planGeneratedAt: string;
  startedAt: string;
  updatedAt: string;
  stoppedReason: "complete" | "limit" | "quota-reserve";
  summary: {
    planCandidateCount: number;
    finalCount: number;
    pendingCount: number;
    addedCount: number;
    existingCount: number;
    policySkippedCount: number;
    stableFailedCount: number;
    transientFailedCount: number;
  };
  outcomes: CreatorBackfillApplyOutcome[];
};

export type CreatorBackfillReconcileResult =
  | { status: "existing"; existingId: string; reason?: string }
  | { status: "policy-skipped"; reason: string }
  | null;

export type CreatorBackfillEnrichResult =
  | { status: "addition"; addition: ShadowSkillPersistenceAddition }
  | { status: "policy-skipped"; reason: string }
  | { status: "stable-failed"; reason: string }
  | { status: "transient-failed"; reason: string };

export type CreatorBackfillPersistResult = {
  id: string;
  status: "added" | "existing";
  existingId?: string;
  reason?: string;
};

const finalStatuses = new Set<CreatorBackfillApplyStatus>([
  "added",
  "existing",
  "policy-skipped",
  "stable-failed",
]);

function normalizePath(value: string): string {
  return value.trim().replace(/^\.\//, "").toLowerCase();
}

export function creatorBackfillCandidateKey(candidate: CreatorBackfillPlanCandidate): string {
  return `${candidate.repo.trim().toLowerCase()}#${normalizePath(candidate.path)}`;
}

export function creatorBackfillPlanFingerprint(plan: CreatorBackfillPlan): string {
  const payload = {
    version: plan.version,
    generatedAt: plan.generatedAt,
    sourceCommit: plan.sourceCommit,
    policyDigest: plan.policyDigest,
    candidates: plan.candidates,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function parseCreatorBackfillApplyLimit(value: string | undefined): number {
  if (value === undefined) return CREATOR_BACKFILL_DEFAULT_APPLY_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > CREATOR_BACKFILL_MAX_APPLY_LIMIT) {
    throw new Error(`Creator backfill apply limit must be an integer from 1 to ${CREATOR_BACKFILL_MAX_APPLY_LIMIT}.`);
  }
  return parsed;
}

function emptyProgress(plan: CreatorBackfillPlan, now: string): CreatorBackfillApplyProgress {
  return {
    version: CREATOR_BACKFILL_APPLY_VERSION,
    planFingerprint: creatorBackfillPlanFingerprint(plan),
    planGeneratedAt: plan.generatedAt,
    startedAt: now,
    updatedAt: now,
    stoppedReason: "limit",
    summary: {
      planCandidateCount: plan.candidates.length,
      finalCount: 0,
      pendingCount: plan.candidates.length,
      addedCount: 0,
      existingCount: 0,
      policySkippedCount: 0,
      stableFailedCount: 0,
      transientFailedCount: 0,
    },
    outcomes: [],
  };
}

export function initializeCreatorBackfillApplyProgress(
  plan: CreatorBackfillPlan,
  existing: CreatorBackfillApplyProgress | null,
  now: string,
): CreatorBackfillApplyProgress {
  const fingerprint = creatorBackfillPlanFingerprint(plan);
  if (
    !existing
    || existing.version !== CREATOR_BACKFILL_APPLY_VERSION
    || existing.planFingerprint !== fingerprint
  ) {
    return emptyProgress(plan, now);
  }
  return recalculateProgress(plan, { ...existing, outcomes: [...existing.outcomes] }, existing.stoppedReason, now);
}

function countStatus(outcomes: CreatorBackfillApplyOutcome[], status: CreatorBackfillApplyStatus): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function recalculateProgress(
  plan: CreatorBackfillPlan,
  progress: CreatorBackfillApplyProgress,
  stoppedReason: CreatorBackfillApplyProgress["stoppedReason"],
  now: string,
): CreatorBackfillApplyProgress {
  const planOrder = new Map(plan.candidates.map((candidate, index) => [creatorBackfillCandidateKey(candidate), index]));
  const outcomes = [...progress.outcomes]
    .filter((outcome) => planOrder.has(outcome.key))
    .sort((left, right) => (planOrder.get(left.key) ?? 0) - (planOrder.get(right.key) ?? 0));
  const finalCount = outcomes.filter((outcome) => finalStatuses.has(outcome.status)).length;
  return {
    ...progress,
    updatedAt: now,
    stoppedReason,
    summary: {
      planCandidateCount: plan.candidates.length,
      finalCount,
      pendingCount: Math.max(0, plan.candidates.length - finalCount),
      addedCount: countStatus(outcomes, "added"),
      existingCount: countStatus(outcomes, "existing"),
      policySkippedCount: countStatus(outcomes, "policy-skipped"),
      stableFailedCount: countStatus(outcomes, "stable-failed"),
      transientFailedCount: countStatus(outcomes, "transient-failed"),
    },
    outcomes,
  };
}

function outcomeFor(
  candidate: CreatorBackfillPlanCandidate,
  status: CreatorBackfillApplyStatus,
  attemptedAt: string,
  details: { reason?: string; existingId?: string } = {},
): CreatorBackfillApplyOutcome {
  return {
    key: creatorBackfillCandidateKey(candidate),
    id: candidate.proposedId,
    creator: candidate.creator,
    repo: candidate.repo,
    path: candidate.path,
    status,
    attemptedAt,
    ...details,
  };
}

function replaceOutcome(
  progress: CreatorBackfillApplyProgress,
  outcome: CreatorBackfillApplyOutcome,
): CreatorBackfillApplyProgress {
  return {
    ...progress,
    outcomes: [...progress.outcomes.filter((existing) => existing.key !== outcome.key), outcome],
  };
}

export async function executeCreatorBackfillApply(input: {
  plan: CreatorBackfillPlan;
  progress: CreatorBackfillApplyProgress | null;
  limit: number;
  now: () => string;
  initialQuotaPreflight: () => Promise<void>;
  reserveQuotaAvailable: () => Promise<boolean>;
  reconcile: (candidate: CreatorBackfillPlanCandidate) => Promise<CreatorBackfillReconcileResult>;
  enrich: (candidate: CreatorBackfillPlanCandidate) => Promise<CreatorBackfillEnrichResult>;
  persist: (additions: ShadowSkillPersistenceAddition[]) => Promise<CreatorBackfillPersistResult[]>;
  writeProgress: (progress: CreatorBackfillApplyProgress) => void;
}): Promise<CreatorBackfillApplyProgress> {
  const limit = parseCreatorBackfillApplyLimit(String(input.limit));
  let progress = initializeCreatorBackfillApplyProgress(input.plan, input.progress, input.now());
  const finalKeys = new Set(
    progress.outcomes.filter((outcome) => finalStatuses.has(outcome.status)).map((outcome) => outcome.key),
  );
  const candidates = input.plan.candidates.filter((candidate) => !finalKeys.has(creatorBackfillCandidateKey(candidate)));
  const pending: Array<{ candidate: CreatorBackfillPlanCandidate; addition: ShadowSkillPersistenceAddition }> = [];
  let attempted = 0;
  let enrichAttempts = 0;
  let quotaStarted = false;
  let quotaStopped = false;

  const write = (reason: CreatorBackfillApplyProgress["stoppedReason"]) => {
    progress = recalculateProgress(input.plan, progress, reason, input.now());
    input.writeProgress(progress);
  };

  const flush = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    const persisted = await input.persist(batch.map((row) => row.addition));
    const byId = new Map(persisted.map((result) => [result.id, result]));
    for (const row of batch) {
      const result = byId.get(row.addition.skill.id);
      if (!result) throw new Error(`Missing creator backfill persistence result for ${row.addition.skill.id}.`);
      progress = replaceOutcome(progress, outcomeFor(
        row.candidate,
        result.status,
        input.now(),
        { reason: result.reason, existingId: result.existingId },
      ));
    }
    write("limit");
  };

  for (const candidate of candidates) {
    if (attempted >= limit) break;
    const reconciled = await input.reconcile(candidate);
    attempted += 1;
    if (reconciled) {
      progress = replaceOutcome(progress, outcomeFor(
        candidate,
        reconciled.status,
        input.now(),
        { reason: reconciled.reason, existingId: reconciled.status === "existing" ? reconciled.existingId : undefined },
      ));
      write("limit");
      continue;
    }

    if (!quotaStarted) {
      await input.initialQuotaPreflight();
      quotaStarted = true;
    } else if (
      enrichAttempts > 0
      && enrichAttempts % CREATOR_BACKFILL_QUOTA_RECHECK_INTERVAL === 0
      && !(await input.reserveQuotaAvailable())
    ) {
      quotaStopped = true;
      break;
    }

    enrichAttempts += 1;
    const enriched = await input.enrich(candidate);
    if (enriched.status === "addition") {
      pending.push({ candidate, addition: enriched.addition });
      if (pending.length >= CREATOR_BACKFILL_PERSIST_BATCH_SIZE) await flush();
      continue;
    }
    progress = replaceOutcome(progress, outcomeFor(candidate, enriched.status, input.now(), { reason: enriched.reason }));
    write("limit");
  }

  await flush();
  const remainingFinalKeys = new Set(
    progress.outcomes.filter((outcome) => finalStatuses.has(outcome.status)).map((outcome) => outcome.key),
  );
  const complete = input.plan.candidates.every((candidate) => remainingFinalKeys.has(creatorBackfillCandidateKey(candidate)));
  write(quotaStopped ? "quota-reserve" : complete ? "complete" : "limit");
  return progress;
}

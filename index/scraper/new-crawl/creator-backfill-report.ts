import type { CreatorBackfillApplyProgress, CreatorBackfillApplyStatus } from "./creator-backfill-apply.js";
import { creatorBackfillCandidateKey, creatorBackfillPlanFingerprint } from "./creator-backfill-apply.js";
import type { CreatorBackfillPlan, CreatorBackfillPlanExclusion } from "./creator-backfill-plan.js";

export const CREATOR_BACKFILL_REPORT_VERSION = 1;

export type CreatorBackfillDispositionStatus =
  | "added"
  | "already-present"
  | "policy-rejected"
  | "invalid"
  | "transient-failed"
  | "pending";

export type CreatorBackfillDisposition = {
  key: string;
  creator: string;
  repo: string;
  path: string;
  proposedId: string;
  status: CreatorBackfillDispositionStatus;
  reason?: string;
  attemptCount?: number;
};

export type CreatorBackfillFinalReport = {
  version: number;
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  creatorRegistryRevision: string;
  planFingerprint: string;
  ready: boolean;
  summary: {
    discoveredSkillCount: number;
    dispositionCount: number;
    addedCount: number;
    alreadyPresentCount: number;
    policyRejectedCount: number;
    invalidCount: number;
    transientFailedCount: number;
    pendingCount: number;
    reviewRequiredRepositoryCount: number;
  };
  issues: string[];
  dispositions: CreatorBackfillDisposition[];
};

const alreadyPresentReasons = new Set(["already-present", "exact-sha-present"]);
const invalidReasons = new Set([
  "creator-path-excluded",
  "non-publishable-path",
  "duplicate-plan-sha",
  "duplicate-plan-candidate",
]);

function exclusionStatus(exclusion: CreatorBackfillPlanExclusion): CreatorBackfillDispositionStatus {
  if (alreadyPresentReasons.has(exclusion.reason)) return "already-present";
  if (invalidReasons.has(exclusion.reason)) return "invalid";
  return "policy-rejected";
}

function applyStatus(status: CreatorBackfillApplyStatus): CreatorBackfillDispositionStatus {
  if (status === "added") return "added";
  if (status === "existing") return "already-present";
  if (status === "policy-skipped") return "policy-rejected";
  if (status === "stable-failed") return "invalid";
  return "transient-failed";
}

function count(dispositions: CreatorBackfillDisposition[], status: CreatorBackfillDispositionStatus): number {
  return dispositions.filter((disposition) => disposition.status === status).length;
}

export function buildCreatorBackfillFinalReport(input: {
  plan: CreatorBackfillPlan;
  progress: CreatorBackfillApplyProgress | null;
  generatedAt: string;
}): CreatorBackfillFinalReport {
  const outcomes = new Map((input.progress?.outcomes ?? []).map((outcome) => [outcome.key, outcome]));
  const dispositions: CreatorBackfillDisposition[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  const expectedFingerprint = creatorBackfillPlanFingerprint(input.plan);
  if (input.progress && input.progress.planFingerprint !== expectedFingerprint) {
    issues.push("Apply progress belongs to a different creator backfill plan.");
  }

  for (const exclusion of input.plan.exclusions) {
    if (!exclusion.path || !exclusion.proposedId) continue;
    const key = `${exclusion.repo.toLowerCase()}#${exclusion.path.toLowerCase()}`;
    if (seen.has(key)) issues.push(`Duplicate path disposition: ${key}`);
    seen.add(key);
    dispositions.push({
      key,
      creator: exclusion.creator,
      repo: exclusion.repo,
      path: exclusion.path,
      proposedId: exclusion.proposedId,
      status: exclusionStatus(exclusion),
      reason: exclusion.reason,
    });
  }

  for (const candidate of input.plan.candidates) {
    const key = creatorBackfillCandidateKey(candidate);
    if (seen.has(key)) issues.push(`Duplicate path disposition: ${key}`);
    seen.add(key);
    const outcome = outcomes.get(key);
    dispositions.push({
      key,
      creator: candidate.creator,
      repo: candidate.repo,
      path: candidate.path,
      proposedId: candidate.proposedId,
      status: outcome ? applyStatus(outcome.status) : "pending",
      ...(outcome?.reason ? { reason: outcome.reason } : {}),
      ...(outcome?.attemptCount ? { attemptCount: outcome.attemptCount } : {}),
    });
  }

  dispositions.sort((left, right) => left.key.localeCompare(right.key));
  if (dispositions.length !== input.plan.summary.discoveredSkillCount) {
    issues.push(
      `Discovered ${input.plan.summary.discoveredSkillCount} skill paths but classified ${dispositions.length}.`,
    );
  }
  if (input.plan.summary.reviewRequiredRepositoryCount > 0) {
    issues.push(`${input.plan.summary.reviewRequiredRepositoryCount} repositories still require review.`);
  }
  const transientFailedCount = count(dispositions, "transient-failed");
  const pendingCount = count(dispositions, "pending");
  if (transientFailedCount > 0) issues.push(`${transientFailedCount} skill paths have transient failures.`);
  if (pendingCount > 0) issues.push(`${pendingCount} skill paths are pending.`);

  return {
    version: CREATOR_BACKFILL_REPORT_VERSION,
    generatedAt: input.generatedAt,
    sourceCommit: input.plan.sourceCommit,
    policyDigest: input.plan.policyDigest,
    creatorRegistryRevision: input.plan.creatorRegistryRevision,
    planFingerprint: expectedFingerprint,
    ready: issues.length === 0,
    summary: {
      discoveredSkillCount: input.plan.summary.discoveredSkillCount,
      dispositionCount: dispositions.length,
      addedCount: count(dispositions, "added"),
      alreadyPresentCount: count(dispositions, "already-present"),
      policyRejectedCount: count(dispositions, "policy-rejected"),
      invalidCount: count(dispositions, "invalid"),
      transientFailedCount,
      pendingCount,
      reviewRequiredRepositoryCount: input.plan.summary.reviewRequiredRepositoryCount,
    },
    issues,
    dispositions,
  };
}

export function renderCreatorBackfillFinalReport(report: CreatorBackfillFinalReport): string {
  const lines = [
    "# Creator Backfill Final Report",
    "",
    `- Ready: ${report.ready ? "yes" : "no"}`,
    `- Discovered: ${report.summary.discoveredSkillCount}`,
    `- Added: ${report.summary.addedCount}`,
    `- Already present: ${report.summary.alreadyPresentCount}`,
    `- Policy rejected: ${report.summary.policyRejectedCount}`,
    `- Invalid: ${report.summary.invalidCount}`,
    `- Transient failures: ${report.summary.transientFailedCount}`,
    `- Pending: ${report.summary.pendingCount}`,
    `- Repositories requiring review: ${report.summary.reviewRequiredRepositoryCount}`,
  ];
  if (report.issues.length) {
    lines.push("", "## Issues", "", ...report.issues.map((issue) => `- ${issue}`));
  }
  return `${lines.join("\n")}\n`;
}

import type { PolicyReasonCode } from "../policy/types.js";
import type { PolicyPrecedenceMode, AdmissionEvaluation } from "./admission.js";
import type { QualityTier, RepoState, ShadowRepoIndex, TrustedSeeds } from "./types.js";

const SAMPLE_LIMIT = 20;

export type AdmissionPolicyObservation = {
  repo: string;
  legacyEligible: boolean;
  proposedEligible: boolean;
  legacyReasonCode: PolicyReasonCode;
  proposedReasonCode: PolicyReasonCode;
  matchedSource: string;
  skippedSuppressedCandidateIds: string[];
};

export type RepoStatePolicyObservation = {
  repo: string;
  currentState: RepoState;
  proposedState: RepoState;
  reasonCode: PolicyReasonCode;
};

export type QualityTierPolicyObservation = {
  skillId: string;
  currentTier: QualityTier;
  proposedTier: QualityTier;
  reasonCode: PolicyReasonCode;
};

export type PolicyPrecedenceReport = {
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  snapshotId?: string;
  snapshotCapturedAt?: string;
  snapshotSourceCommit?: string;
  mode: PolicyPrecedenceMode;
  admissionObservationCount: number;
  admissionChangeCount: number;
  admissionAdditionCount: number;
  admissionRemovalCount: number;
  skippedSuppressedCandidateCount: number;
  repoStateChangeCount: number;
  qualityTierChangeCount: number;
  countsByReason: Partial<Record<PolicyReasonCode, number>>;
  admissionSample: AdmissionPolicyObservation[];
  repoStateSample: RepoStatePolicyObservation[];
  qualityTierSample: QualityTierPolicyObservation[];
};

export function repoClassificationSafetyReason(repo: string, seeds: TrustedSeeds): PolicyReasonCode | null {
  if (seeds.catalogRepoRules.some((entry) => entry.repo === repo)) return "catalog-repo";
  const override = seeds.provenanceOverrides.find((entry) => entry.repo === repo);
  return override?.provenanceType && override.provenanceType !== "original"
    ? "non-original-provenance"
    : null;
}

export function applyRepoStatePrecedence(
  repoIndex: ShadowRepoIndex,
  seeds: TrustedSeeds,
  enforce: boolean,
): RepoStatePolicyObservation[] {
  const observations: RepoStatePolicyObservation[] = [];
  for (const repo of repoIndex.repos) {
    const reasonCode = repoClassificationSafetyReason(repo.repo, seeds);
    if (!reasonCode || repo.state === "library") continue;
    observations.push({
      repo: repo.repo,
      currentState: repo.state,
      proposedState: "library",
      reasonCode,
    });
    if (enforce) {
      repo.state = "library";
      repo.promotionReasons = [reasonCode];
    }
  }
  return observations;
}

export function admissionObservation(
  repo: string,
  evaluation: AdmissionEvaluation,
): AdmissionPolicyObservation | null {
  const decisionChanged =
    evaluation.legacy.eligible !== evaluation.proposed.eligible ||
    evaluation.legacy.reasonCode !== evaluation.proposed.reasonCode ||
    evaluation.legacy.candidate?.id !== evaluation.proposed.candidate?.id;
  if (!decisionChanged && evaluation.skippedSuppressedCandidateIds.length === 0) return null;
  return {
    repo,
    legacyEligible: evaluation.legacy.eligible,
    proposedEligible: evaluation.proposed.eligible,
    legacyReasonCode: evaluation.legacy.reasonCode,
    proposedReasonCode: evaluation.proposed.reasonCode,
    matchedSource: evaluation.proposed.matchedSource,
    skippedSuppressedCandidateIds: evaluation.skippedSuppressedCandidateIds,
  };
}

function increment(counts: Partial<Record<PolicyReasonCode, number>>, reason: PolicyReasonCode): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export function buildPolicyPrecedenceReport(input: {
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  mode: PolicyPrecedenceMode;
  admissions: AdmissionPolicyObservation[];
  repoStates: RepoStatePolicyObservation[];
  qualityTiers: QualityTierPolicyObservation[];
  snapshotId?: string;
  snapshotCapturedAt?: string;
  snapshotSourceCommit?: string;
}): PolicyPrecedenceReport {
  const admissions = [...input.admissions].sort((a, b) => a.repo.localeCompare(b.repo));
  const repoStates = [...input.repoStates].sort((a, b) => a.repo.localeCompare(b.repo));
  const qualityTiers = [...input.qualityTiers].sort((a, b) => a.skillId.localeCompare(b.skillId));
  const countsByReason: Partial<Record<PolicyReasonCode, number>> = {};
  for (const row of admissions) {
    increment(countsByReason, row.proposedReasonCode);
    for (const _skillId of row.skippedSuppressedCandidateIds) {
      increment(countsByReason, "suppressed-skill");
    }
  }
  for (const row of repoStates) increment(countsByReason, row.reasonCode);
  for (const row of qualityTiers) increment(countsByReason, row.reasonCode);
  return {
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    policyDigest: input.policyDigest,
    snapshotId: input.snapshotId,
    snapshotCapturedAt: input.snapshotCapturedAt,
    snapshotSourceCommit: input.snapshotSourceCommit,
    mode: input.mode,
    admissionObservationCount: admissions.length,
    admissionChangeCount: admissions.filter((row) => row.legacyEligible !== row.proposedEligible).length,
    admissionAdditionCount: admissions.filter((row) => !row.legacyEligible && row.proposedEligible).length,
    admissionRemovalCount: admissions.filter((row) => row.legacyEligible && !row.proposedEligible).length,
    skippedSuppressedCandidateCount: admissions.reduce(
      (total, row) => total + row.skippedSuppressedCandidateIds.length,
      0,
    ),
    repoStateChangeCount: repoStates.length,
    qualityTierChangeCount: qualityTiers.length,
    countsByReason: Object.fromEntries(Object.entries(countsByReason).sort(([a], [b]) => a.localeCompare(b))),
    admissionSample: admissions.slice(0, SAMPLE_LIMIT),
    repoStateSample: repoStates.slice(0, SAMPLE_LIMIT),
    qualityTierSample: qualityTiers.slice(0, SAMPLE_LIMIT),
  };
}

export function renderPolicyPrecedenceReport(report: PolicyPrecedenceReport): string {
  return `${[
    "# Crawl 4 Policy Precedence",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Source commit: ${report.sourceCommit}`,
    `- Policy digest: ${report.policyDigest}`,
    ...(report.snapshotId ? [`- Snapshot: ${report.snapshotId}`] : []),
    ...(report.snapshotCapturedAt ? [`- Snapshot captured: ${report.snapshotCapturedAt}`] : []),
    ...(report.snapshotSourceCommit ? [`- Snapshot source commit: ${report.snapshotSourceCommit}`] : []),
    `- Mode: ${report.mode}`,
    `- Admission observations: ${report.admissionObservationCount}`,
    `- Admission changes: ${report.admissionChangeCount}`,
    `- Admission additions: ${report.admissionAdditionCount}`,
    `- Admission removals: ${report.admissionRemovalCount}`,
    `- Suppressed bootstrap candidates skipped: ${report.skippedSuppressedCandidateCount}`,
    `- Repo-state changes: ${report.repoStateChangeCount}`,
    `- Quality-tier changes: ${report.qualityTierChangeCount}`,
    ...Object.entries(report.countsByReason).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Admission sample",
    ...(report.admissionSample.length
      ? report.admissionSample.map((row) => `- ${row.repo}: ${row.legacyEligible}/${row.legacyReasonCode} -> ${row.proposedEligible}/${row.proposedReasonCode}`)
      : ["- none"]),
    "",
    "## Repo-state sample",
    ...(report.repoStateSample.length
      ? report.repoStateSample.map((row) => `- ${row.repo}: ${row.currentState} -> ${row.proposedState} (${row.reasonCode})`)
      : ["- none"]),
    "",
    "## Quality-tier sample",
    ...(report.qualityTierSample.length
      ? report.qualityTierSample.map((row) => `- ${row.skillId}: ${row.currentTier} -> ${row.proposedTier} (${row.reasonCode})`)
      : ["- none"]),
  ].join("\n")}\n`;
}

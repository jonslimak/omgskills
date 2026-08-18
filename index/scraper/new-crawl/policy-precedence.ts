import type { PolicyReasonCode } from "../policy/types.js";
import type { PolicyPrecedenceMode, AdmissionEvaluation } from "./admission.js";
import type { QualityTier, RepoState, ShadowRepoIndex, TrustedSeeds } from "./types.js";
import { normalizePolicyRepo } from "../../../scripts/policy-identifiers.mjs";

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

export type NewRepoAdmissionObservation = {
  repo: string;
  sources: string[];
  eligible: boolean;
  reasonCode: PolicyReasonCode;
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

export type PersistedAdmissionSample = {
  repo: string;
  skillCount: number;
  skillIds: string[];
};

export type DroppedAdmissionSample = {
  repo: string;
  reason: "no-publishable-skills-after-refresh";
};

export type NewRepoAdmissionSample = {
  repo: string;
  sources: string[];
  reasonCode: PolicyReasonCode;
  outcome: "eligible-not-applied" | "persisted" | "dropped";
  skillCount: number;
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
  appliedAdmissionAdditionCount: number;
  persistedAdmissionAdditionCount: number;
  droppedAdmissionAdditionCount: number;
  newRepoCandidateCount: number;
  eligibleNewRepoCount: number;
  appliedNewRepoCount: number;
  persistedNewRepoCount: number;
  droppedNewRepoCount: number;
  eligibleNotAppliedCount: number;
  skippedSuppressedCandidateCount: number;
  repoStateChangeCount: number;
  qualityTierChangeCount: number;
  countsByReason: Partial<Record<PolicyReasonCode, number>>;
  admissionSample: AdmissionPolicyObservation[];
  persistedAdmissionSample: PersistedAdmissionSample[];
  droppedAdmissionSample: DroppedAdmissionSample[];
  newRepoAdmissionSample: NewRepoAdmissionSample[];
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

export function newRepoAdmissionObservation(
  repo: string,
  sources: Iterable<string>,
  evaluation: AdmissionEvaluation,
): NewRepoAdmissionObservation {
  return {
    repo,
    sources: [...new Set(sources)].sort(),
    eligible: evaluation.effective.eligible,
    reasonCode: evaluation.effective.reasonCode,
  };
}

function increment(counts: Partial<Record<PolicyReasonCode, number>>, reason: PolicyReasonCode): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export function buildAdmissionOutcomeSummary(input: {
  admissions: AdmissionPolicyObservation[];
  appliedAdmissionRepos: ReadonlySet<string>;
  finalRepoIndex: ShadowRepoIndex;
}): {
  appliedCount: number;
  persistedCount: number;
  droppedCount: number;
  persistedSample: PersistedAdmissionSample[];
  droppedSample: DroppedAdmissionSample[];
} {
  const eligibleAdditionRepos = new Set(
    input.admissions
      .filter((row) => !row.legacyEligible && row.proposedEligible)
      .map((row) => normalizePolicyRepo(row.repo)),
  );
  const appliedRepos = [...input.appliedAdmissionRepos]
    .map(normalizePolicyRepo)
    .filter((repo) => eligibleAdditionRepos.has(repo))
    .sort();
  const finalRepoByName = new Map(
    input.finalRepoIndex.repos.map((entry) => [normalizePolicyRepo(entry.repo), entry]),
  );
  const persisted: PersistedAdmissionSample[] = [];
  const dropped: DroppedAdmissionSample[] = [];

  for (const repo of appliedRepos) {
    const entry = finalRepoByName.get(repo);
    if (!entry || entry.skillIds.length === 0) {
      dropped.push({ repo, reason: "no-publishable-skills-after-refresh" });
      continue;
    }
    persisted.push({
      repo,
      skillCount: entry.skillIds.length,
      skillIds: [...entry.skillIds].sort().slice(0, SAMPLE_LIMIT),
    });
  }

  return {
    appliedCount: appliedRepos.length,
    persistedCount: persisted.length,
    droppedCount: dropped.length,
    persistedSample: persisted.slice(0, SAMPLE_LIMIT),
    droppedSample: dropped.slice(0, SAMPLE_LIMIT),
  };
}

export function buildNewRepoAdmissionSummary(input: {
  admissions: NewRepoAdmissionObservation[];
  appliedAdmissionRepos: ReadonlySet<string>;
  finalRepoIndex: ShadowRepoIndex;
}): {
  candidateCount: number;
  eligibleCount: number;
  appliedCount: number;
  persistedCount: number;
  droppedCount: number;
  eligibleNotAppliedCount: number;
  sample: NewRepoAdmissionSample[];
} {
  const admissionByRepo = new Map(
    input.admissions.map((row) => [normalizePolicyRepo(row.repo), row]),
  );
  const eligibleRepos = new Set(
    input.admissions
      .filter((row) => row.eligible)
      .map((row) => normalizePolicyRepo(row.repo)),
  );
  const appliedRepos = new Set(
    [...input.appliedAdmissionRepos]
      .map(normalizePolicyRepo)
      .filter((repo) => eligibleRepos.has(repo)),
  );
  const finalRepoByName = new Map(
    input.finalRepoIndex.repos.map((entry) => [normalizePolicyRepo(entry.repo), entry]),
  );
  const sample: NewRepoAdmissionSample[] = [];
  let persistedCount = 0;
  let droppedCount = 0;

  for (const repo of [...eligibleRepos].sort()) {
    const observation = admissionByRepo.get(repo);
    if (!observation) continue;
    const entry = finalRepoByName.get(repo);
    const applied = appliedRepos.has(repo);
    const persisted = applied && Boolean(entry?.skillIds.length);
    const outcome = !applied
      ? "eligible-not-applied"
      : persisted
        ? "persisted"
        : "dropped";
    if (outcome === "persisted") persistedCount += 1;
    if (outcome === "dropped") droppedCount += 1;
    if (sample.length < SAMPLE_LIMIT) {
      sample.push({
        repo,
        sources: observation.sources,
        reasonCode: observation.reasonCode,
        outcome,
        skillCount: persisted ? entry?.skillIds.length ?? 0 : 0,
      });
    }
  }

  return {
    candidateCount: input.admissions.length,
    eligibleCount: eligibleRepos.size,
    appliedCount: appliedRepos.size,
    persistedCount,
    droppedCount,
    eligibleNotAppliedCount: eligibleRepos.size - appliedRepos.size,
    sample,
  };
}

export function buildPolicyPrecedenceReport(input: {
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  mode: PolicyPrecedenceMode;
  admissions: AdmissionPolicyObservation[];
  newRepoAdmissions: NewRepoAdmissionObservation[];
  appliedAdmissionRepos: ReadonlySet<string>;
  finalRepoIndex: ShadowRepoIndex;
  repoStates: RepoStatePolicyObservation[];
  qualityTiers: QualityTierPolicyObservation[];
  snapshotId?: string;
  snapshotCapturedAt?: string;
  snapshotSourceCommit?: string;
}): PolicyPrecedenceReport {
  const admissions = [...input.admissions].sort((a, b) => a.repo.localeCompare(b.repo));
  const repoStates = [...input.repoStates].sort((a, b) => a.repo.localeCompare(b.repo));
  const qualityTiers = [...input.qualityTiers].sort((a, b) => a.skillId.localeCompare(b.skillId));
  const admissionOutcomes = buildAdmissionOutcomeSummary(input);
  const newRepoOutcomes = buildNewRepoAdmissionSummary({
    admissions: input.newRepoAdmissions,
    appliedAdmissionRepos: input.appliedAdmissionRepos,
    finalRepoIndex: input.finalRepoIndex,
  });
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
    appliedAdmissionAdditionCount: admissionOutcomes.appliedCount,
    persistedAdmissionAdditionCount: admissionOutcomes.persistedCount,
    droppedAdmissionAdditionCount: admissionOutcomes.droppedCount,
    newRepoCandidateCount: newRepoOutcomes.candidateCount,
    eligibleNewRepoCount: newRepoOutcomes.eligibleCount,
    appliedNewRepoCount: newRepoOutcomes.appliedCount,
    persistedNewRepoCount: newRepoOutcomes.persistedCount,
    droppedNewRepoCount: newRepoOutcomes.droppedCount,
    eligibleNotAppliedCount: newRepoOutcomes.eligibleNotAppliedCount,
    skippedSuppressedCandidateCount: admissions.reduce(
      (total, row) => total + row.skippedSuppressedCandidateIds.length,
      0,
    ),
    repoStateChangeCount: repoStates.length,
    qualityTierChangeCount: qualityTiers.length,
    countsByReason: Object.fromEntries(Object.entries(countsByReason).sort(([a], [b]) => a.localeCompare(b))),
    admissionSample: admissions.slice(0, SAMPLE_LIMIT),
    persistedAdmissionSample: admissionOutcomes.persistedSample,
    droppedAdmissionSample: admissionOutcomes.droppedSample,
    newRepoAdmissionSample: newRepoOutcomes.sample,
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
    `- Applied admission additions: ${report.appliedAdmissionAdditionCount}`,
    `- Persisted admission additions: ${report.persistedAdmissionAdditionCount}`,
    `- Dropped admission additions after refresh: ${report.droppedAdmissionAdditionCount}`,
    `- New repo candidates: ${report.newRepoCandidateCount}`,
    `- Eligible new repos: ${report.eligibleNewRepoCount}`,
    `- Applied new repos: ${report.appliedNewRepoCount}`,
    `- Persisted new repos: ${report.persistedNewRepoCount}`,
    `- Dropped new repos after refresh: ${report.droppedNewRepoCount}`,
    `- Eligible new repos not applied: ${report.eligibleNotAppliedCount}`,
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
    "## Persisted admission sample",
    ...(report.persistedAdmissionSample.length
      ? report.persistedAdmissionSample.map((row) => `- ${row.repo}: ${row.skillCount} publishable skills`)
      : ["- none"]),
    "",
    "## Dropped admission sample",
    ...(report.droppedAdmissionSample.length
      ? report.droppedAdmissionSample.map((row) => `- ${row.repo}: ${row.reason}`)
      : ["- none"]),
    "",
    "## New repo admission sample",
    ...(report.newRepoAdmissionSample.length
      ? report.newRepoAdmissionSample.map((row) =>
          `- ${row.repo}: ${row.outcome}, ${row.skillCount} publishable skills ` +
          `(${row.reasonCode}; sources: ${row.sources.join(", ") || "none"})`
        )
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

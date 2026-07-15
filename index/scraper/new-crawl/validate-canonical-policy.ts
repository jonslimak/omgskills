import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import { loadTrustedSeeds } from "./seeds.js";
import { indexRoot } from "./shadow-path-guard.js";
import {
  buildShaCanonicalArtifact,
  shaCanonicalOptionsFromSeeds,
  type ShaCanonicalArtifact,
  type ShaCanonicalOptions,
  type ShaCanonicalSkill,
} from "./sha-canonical.js";

export type CanonicalPolicyFailure = {
  code:
    | "duplicate-cluster-sha"
    | "duplicate-member-id"
    | "unsorted-member-ids"
    | "missing-member-id"
    | "member-sha-mismatch"
    | "invalid-canonical-id"
    | "invalid-confidence-reason"
    | "summary-mismatch";
  skillMdSha?: string;
  skillId?: string;
  detail: string;
};

export type CanonicalPolicyReport = {
  generatedAt: string;
  mode: "read-only";
  valid: boolean;
  summary: {
    clusterCount: number;
    promotableHighCount: number;
    promotableSameRepoCount: number;
    advisoryTrustedCreatorCount: number;
    advisoryStarLeaderCount: number;
    advisoryMediumCount: number;
    ambiguousCount: number;
    failureCount: number;
  };
  failures: CanonicalPolicyFailure[];
  excludedCandidates: Array<{
    skillMdSha: string;
    proposedSkillId: string | null;
    confidence: "medium" | "unresolved";
    reason: "trusted-creator" | "clear-star-leader" | "ambiguous";
  }>;
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function pushSummaryFailure(
  failures: CanonicalPolicyFailure[],
  field: string,
  actual: number,
  expected: number,
): void {
  if (actual === expected) return;
  failures.push({
    code: "summary-mismatch",
    detail: `${field} is ${actual}; expected ${expected}`,
  });
}

export function validateShaCanonicalArtifact(
  artifact: ShaCanonicalArtifact,
  skills: ShaCanonicalSkill[],
): CanonicalPolicyFailure[] {
  const failures: CanonicalPolicyFailure[] = [];
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const seenShas = new Set<string>();

  for (const cluster of artifact.clusters) {
    if (seenShas.has(cluster.skillMdSha)) {
      failures.push({
        code: "duplicate-cluster-sha",
        skillMdSha: cluster.skillMdSha,
        detail: "SHA appears in more than one cluster",
      });
    }
    seenShas.add(cluster.skillMdSha);

    const uniqueMemberIds = [...new Set(cluster.memberSkillIds)];
    if (uniqueMemberIds.length !== cluster.memberSkillIds.length) {
      failures.push({
        code: "duplicate-member-id",
        skillMdSha: cluster.skillMdSha,
        detail: "cluster contains duplicate member IDs",
      });
    }
    if (JSON.stringify(cluster.memberSkillIds) !== JSON.stringify([...cluster.memberSkillIds].sort())) {
      failures.push({
        code: "unsorted-member-ids",
        skillMdSha: cluster.skillMdSha,
        detail: "member IDs are not sorted",
      });
    }

    for (const skillId of cluster.memberSkillIds) {
      const skill = skillsById.get(skillId);
      if (!skill) {
        failures.push({
          code: "missing-member-id",
          skillMdSha: cluster.skillMdSha,
          skillId,
          detail: "member ID is absent from current Crawl 4 skills",
        });
      } else if (normalize(skill.skill_md_sha) !== cluster.skillMdSha) {
        failures.push({
          code: "member-sha-mismatch",
          skillMdSha: cluster.skillMdSha,
          skillId,
          detail: `member SHA is ${normalize(skill.skill_md_sha) || "missing"}`,
        });
      }
    }

    if (cluster.canonicalSkillId && !cluster.memberSkillIds.includes(cluster.canonicalSkillId)) {
      failures.push({
        code: "invalid-canonical-id",
        skillMdSha: cluster.skillMdSha,
        skillId: cluster.canonicalSkillId,
        detail: "canonical ID is not a member of its SHA cluster",
      });
    }

    const validConfidenceReason =
      (cluster.confidence === "high" &&
        cluster.canonicalSkillId !== null &&
        cluster.reason === "same-repo") ||
      (cluster.confidence === "medium" &&
        cluster.canonicalSkillId !== null &&
        (cluster.reason === "trusted-creator" || cluster.reason === "clear-star-leader")) ||
      (cluster.confidence === "unresolved" &&
        cluster.canonicalSkillId === null &&
        cluster.reason === "ambiguous");
    if (!validConfidenceReason) {
      failures.push({
        code: "invalid-confidence-reason",
        skillMdSha: cluster.skillMdSha,
        detail: `${cluster.confidence}/${cluster.reason}/${cluster.canonicalSkillId ?? "null"} is not a valid policy state`,
      });
    }
  }

  const high = artifact.clusters.filter((cluster) => cluster.confidence === "high").length;
  const medium = artifact.clusters.filter((cluster) => cluster.confidence === "medium").length;
  const unresolved = artifact.clusters.filter((cluster) => cluster.confidence === "unresolved").length;
  pushSummaryFailure(failures, "clusterCount", artifact.clusterCount, artifact.clusters.length);
  pushSummaryFailure(failures, "highConfidenceCount", artifact.highConfidenceCount, high);
  pushSummaryFailure(failures, "mediumCandidateCount", artifact.mediumCandidateCount, medium);
  pushSummaryFailure(failures, "unresolvedClusterCount", artifact.unresolvedClusterCount, unresolved);
  pushSummaryFailure(failures, "canonicalCandidateCount", artifact.canonicalCandidateCount, high + medium);
  for (const reason of ["same-repo", "trusted-creator", "clear-star-leader"] as const) {
    const count = artifact.clusters.filter((cluster) => cluster.reason === reason).length;
    pushSummaryFailure(failures, `candidateCountByReason.${reason}`, artifact.candidateCountByReason[reason], count);
  }

  return failures;
}

export function buildCanonicalPolicyReport(
  skills: ShaCanonicalSkill[],
  generatedAt: string,
  options: ShaCanonicalOptions,
): CanonicalPolicyReport {
  const artifact = buildShaCanonicalArtifact(skills, generatedAt, options);
  const failures = validateShaCanonicalArtifact(artifact, skills);
  const excludedCandidates = artifact.clusters
    .filter((cluster) => cluster.confidence !== "high")
    .map((cluster) => ({
      skillMdSha: cluster.skillMdSha,
      proposedSkillId: cluster.canonicalSkillId,
      confidence: cluster.confidence as "medium" | "unresolved",
      reason: cluster.reason as "trusted-creator" | "clear-star-leader" | "ambiguous",
    }));

  return {
    generatedAt,
    mode: "read-only",
    valid: failures.length === 0,
    summary: {
      clusterCount: artifact.clusterCount,
      promotableHighCount: artifact.highConfidenceCount,
      promotableSameRepoCount: artifact.candidateCountByReason["same-repo"],
      advisoryTrustedCreatorCount: artifact.candidateCountByReason["trusted-creator"],
      advisoryStarLeaderCount: artifact.candidateCountByReason["clear-star-leader"],
      advisoryMediumCount: artifact.mediumCandidateCount,
      ambiguousCount: artifact.unresolvedClusterCount,
      failureCount: failures.length,
    },
    failures,
    excludedCandidates,
  };
}

async function main(): Promise<void> {
  const skills = JSON.parse(
    readFileSync(join(indexRoot, "shadow", "skills.cutover.shadow.json"), "utf8"),
  ) as Skill[];
  const seeds = loadTrustedSeeds();
  const report = buildCanonicalPolicyReport(
    skills,
    new Date().toISOString(),
    shaCanonicalOptionsFromSeeds(seeds),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

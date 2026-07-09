import type { Skill } from "../types.js";

export type ShaCanonicalSkill = Pick<
  Skill,
  "id" | "name" | "github_url" | "skill_md_path" | "stars" | "first_seen"
> & {
  skill_md_sha?: string | null;
};

export type ShaCanonicalReason =
  | "same-repo"
  | "trusted-creator"
  | "clear-star-leader"
  | "ambiguous";

export type ShaCanonicalConfidence = "high" | "medium" | "unresolved";

export type ShaCanonicalCluster = {
  skillMdSha: string;
  memberSkillIds: string[];
  canonicalSkillId: string | null;
  confidence: ShaCanonicalConfidence;
  reason: ShaCanonicalReason;
};

export type ShaCanonicalArtifact = {
  version: 1;
  generatedAt: string;
  clusterCount: number;
  canonicalCandidateCount: number;
  highConfidenceCount: number;
  mediumCandidateCount: number;
  unresolvedClusterCount: number;
  candidateCountByReason: Record<Exclude<ShaCanonicalReason, "ambiguous">, number>;
  clusters: ShaCanonicalCluster[];
};

export type ShaCanonicalOptions = {
  trustedCanonicalHandles?: Set<string>;
  aliasToCanonicalHandle?: Map<string, string>;
  catalogRepos?: Set<string>;
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function repoFromGithubUrl(value: string): string {
  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return "";
  return `${match[1]!.toLowerCase()}/${match[2]!.replace(/\.git$/i, "").toLowerCase()}`;
}

function pathSegmentCount(path: string | null | undefined): number {
  const normalized = (path ?? "").trim();
  if (!normalized || normalized === "__RESOLVE__") return Number.POSITIVE_INFINITY;
  return normalized.split("/").filter(Boolean).length;
}

function skillIdSuffix(skill: ShaCanonicalSkill): string {
  const separatorIndex = skill.id.indexOf(":");
  return separatorIndex === -1 ? "" : normalize(skill.id.slice(separatorIndex + 1));
}

function compareRepresentative(a: ShaCanonicalSkill, b: ShaCanonicalSkill): number {
  const aBase = skillIdSuffix(a) === normalize(a.name) ? 0 : 1;
  const bBase = skillIdSuffix(b) === normalize(b.name) ? 0 : 1;
  return (
    aBase - bBase ||
    pathSegmentCount(a.skill_md_path) - pathSegmentCount(b.skill_md_path) ||
    b.stars - a.stars ||
    a.id.localeCompare(b.id)
  );
}

function canonicalOwner(skill: ShaCanonicalSkill, aliases: Map<string, string>): string {
  const owner = repoFromGithubUrl(skill.github_url).split("/")[0] ?? "";
  return aliases.get(owner) ?? owner;
}

function resolveCluster(
  rows: ShaCanonicalSkill[],
  options: Required<ShaCanonicalOptions>,
): Pick<ShaCanonicalCluster, "canonicalSkillId" | "confidence" | "reason"> {
  const byRepo = new Set(rows.map((skill) => repoFromGithubUrl(skill.github_url)).filter(Boolean));
  if (byRepo.size === 1) {
    return {
      canonicalSkillId: [...rows].sort(compareRepresentative)[0]!.id,
      confidence: "high",
      reason: "same-repo",
    };
  }

  const nonCatalogRows = rows.filter((skill) => !options.catalogRepos.has(repoFromGithubUrl(skill.github_url)));
  const trustedOwners = new Set(
    nonCatalogRows
      .map((skill) => canonicalOwner(skill, options.aliasToCanonicalHandle))
      .filter((owner) => options.trustedCanonicalHandles.has(owner)),
  );
  if (trustedOwners.size === 1) {
    const trustedOwner = [...trustedOwners][0]!;
    const trustedRows = nonCatalogRows.filter(
      (skill) => canonicalOwner(skill, options.aliasToCanonicalHandle) === trustedOwner,
    );
    return {
      canonicalSkillId: [...trustedRows].sort(compareRepresentative)[0]!.id,
      confidence: "high",
      reason: "trusted-creator",
    };
  }
  if (trustedOwners.size > 1) {
    return { canonicalSkillId: null, confidence: "unresolved", reason: "ambiguous" };
  }

  const byStars = [...nonCatalogRows].sort(
    (a, b) => b.stars - a.stars || compareRepresentative(a, b),
  );
  const leader = byStars[0];
  const runnerUp = byStars[1];
  if (leader && leader.stars >= 50 && (!runnerUp || leader.stars >= runnerUp.stars * 10)) {
    return {
      canonicalSkillId: leader.id,
      confidence: "medium",
      reason: "clear-star-leader",
    };
  }

  return { canonicalSkillId: null, confidence: "unresolved", reason: "ambiguous" };
}

export function buildShaCanonicalArtifact(
  skills: ShaCanonicalSkill[],
  generatedAt: string,
  options: ShaCanonicalOptions = {},
): ShaCanonicalArtifact {
  const normalizedOptions: Required<ShaCanonicalOptions> = {
    trustedCanonicalHandles: new Set(
      [...(options.trustedCanonicalHandles ?? [])].map(normalize).filter(Boolean),
    ),
    aliasToCanonicalHandle: new Map(
      [...(options.aliasToCanonicalHandle ?? new Map<string, string>())].map(([alias, canonical]) => [
        normalize(alias),
        normalize(canonical),
      ]),
    ),
    catalogRepos: new Set([...(options.catalogRepos ?? [])].map(normalize).filter(Boolean)),
  };
  const bySha = new Map<string, ShaCanonicalSkill[]>();
  for (const skill of skills) {
    const sha = normalize(skill.skill_md_sha);
    if (!sha) continue;
    const rows = bySha.get(sha) ?? [];
    rows.push(skill);
    bySha.set(sha, rows);
  }

  const clusters: ShaCanonicalCluster[] = [];
  for (const [skillMdSha, rows] of bySha) {
    if (rows.length < 2) continue;
    const decision = resolveCluster(rows, normalizedOptions);
    clusters.push({
      skillMdSha,
      memberSkillIds: [...new Set(rows.map((skill) => skill.id))].sort(),
      ...decision,
    });
  }
  clusters.sort((a, b) => a.skillMdSha.localeCompare(b.skillMdSha));

  const candidateCountByReason: ShaCanonicalArtifact["candidateCountByReason"] = {
    "same-repo": 0,
    "trusted-creator": 0,
    "clear-star-leader": 0,
  };
  for (const cluster of clusters) {
    if (cluster.reason !== "ambiguous") candidateCountByReason[cluster.reason] += 1;
  }
  const highConfidenceCount = clusters.filter((cluster) => cluster.confidence === "high").length;
  const mediumCandidateCount = clusters.filter((cluster) => cluster.confidence === "medium").length;
  const canonicalCandidateCount = highConfidenceCount + mediumCandidateCount;

  return {
    version: 1,
    generatedAt,
    clusterCount: clusters.length,
    canonicalCandidateCount,
    highConfidenceCount,
    mediumCandidateCount,
    unresolvedClusterCount: clusters.length - canonicalCandidateCount,
    candidateCountByReason,
    clusters,
  };
}

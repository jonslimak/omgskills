import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import { filterDoNotCrawlSkills } from "./do-not-crawl.js";
import { loadTrustedSeeds } from "./seeds.js";
import { filterSuppressedSkills } from "./suppressed-skills.js";
import type { CatalogRepoRule, ProvenanceType, ShadowSkillRecord } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const indexRoot = join(__filename, "..", "..", "..");
const DEFAULT_SKILLS_PATH = join(indexRoot, "shadow", "skills.cutover.shadow.json");
const FALLBACK_SKILLS_PATH = join(indexRoot, "skills.json");
const SUPPRESSED_SKILLS_PATH = join(indexRoot, "seeds", "suppressed-skills.json");
const SAMPLE_LIMIT = 8;
const CLUSTER_LIMIT = 20;
const TRUSTED_CANONICAL_OWNERS = new Set([
  "anthropics",
  "browserbase",
  "cloudflare",
  "expo",
  "github",
  "google-gemini",
  "googleworkspace",
  "microsoft",
  "openai",
]);
const TRUSTED_CANONICAL_REPOS = new Set([
  "alirezarezvani/claude-code-skill-factory",
  "alirezarezvani/claude-skills",
  "benchflow-ai/skillsbench",
  "garrytan/gstack",
  "langchain-ai/langchain",
  "obra/superpowers",
  "onmax/nuxt-skills",
  "posthog/posthog",
  "ruvnet/claude-flow",
  "vercel-labs/ai-sdk-preview-python-streaming",
  "wavetermdev/waveterm",
]);

export type DuplicateAuditSkill = Pick<
  Skill,
  "id" | "name" | "github_url" | "skill_md_path" | "install_cmd" | "author_handle" | "stars"
> & {
  skill_md_sha?: string | null;
  provenance_type?: ProvenanceType;
};

export type DuplicateAuditCategory = "skill_md_sha" | "author_name" | "install_cmd" | "repo_name";

export type DuplicateAuditSkillSample = {
  id: string;
  name: string;
  github_url: string;
  author_handle: string;
  provenance_type: ProvenanceType | "unknown";
  stars: number;
};

export type DuplicateAuditCluster = {
  key: string;
  count: number;
  samples: DuplicateAuditSkillSample[];
};

export type DuplicateAuditCategoryResult = {
  category: DuplicateAuditCategory;
  clusterCount: number;
  affectedSkillCount: number;
  clusters: DuplicateAuditCluster[];
};

export type DuplicateAuditResult = {
  skillCount: number;
  categories: DuplicateAuditCategoryResult[];
};

export type SameRepoSuppressionCandidate = {
  repo: string;
  normalizedName: string;
  skillMdSha: string;
  reason: "same-repo-same-name-same-sha";
  keepId: string;
  suppressIds: string[];
  suggestedSuppressionEntries: {
    id: string;
    reason: "same-repo-same-name-same-sha";
    replacementId: string;
  }[];
};

export type SameRepoReviewOnlyCluster = {
  repo: string;
  normalizedName: string;
  reason: "same-repo-same-name-different-or-missing-sha";
  count: number;
  samples: DuplicateAuditSkillSample[];
};

export type SameRepoSuppressionPlan = {
  candidateClusterCount: number;
  suppressCandidateCount: number;
  candidates: SameRepoSuppressionCandidate[];
  reviewOnlyClusterCount: number;
  reviewOnlyAffectedSkillCount: number;
  reviewOnlyClusters: SameRepoReviewOnlyCluster[];
};

export type ExactShaCanonicalReason = "same-publisher" | "trusted-owner" | "clear-star-leader";
export type ExactShaCanonicalConfidence = "high" | "medium";
export type PartialMediumSuppressionReason = "catalog-copy" | "collection-like-copy" | "low-signal-copy";

export type ExactShaCanonicalCandidate = {
  skillMdSha: string;
  reason: ExactShaCanonicalReason;
  confidence: ExactShaCanonicalConfidence;
  keepId: string;
  suppressIds: string[];
  suggestedSuppressionEntries: {
    id: string;
    reason: ExactShaCanonicalReason;
    confidence: ExactShaCanonicalConfidence;
    replacementId: string;
  }[];
  samples: DuplicateAuditSkillSample[];
};

export type ExactShaReviewOnlyCluster = {
  skillMdSha: string;
  reason: "ambiguous-exact-sha";
  count: number;
  samples: DuplicateAuditSkillSample[];
};

export type ExactShaCanonicalPlan = {
  candidateClusterCount: number;
  suppressCandidateCount: number;
  suppressCandidateCountByReason: Record<ExactShaCanonicalReason, number>;
  suppressCandidateCountByConfidence: Record<ExactShaCanonicalConfidence, number>;
  candidates: ExactShaCanonicalCandidate[];
  reviewOnlyClusterCount: number;
  reviewOnlyAffectedSkillCount: number;
  reviewOnlyClusters: ExactShaReviewOnlyCluster[];
};

type SuppressedSkillsSeedFile = {
  skills: {
    id: string;
    reason: string;
    replacementId?: string;
    confidence?: ExactShaCanonicalConfidence | "low";
    stagedAt?: string;
    notes?: string;
  }[];
};

export type SuggestedSuppressedSkillEntry = SuppressedSkillsSeedFile["skills"][number];

const COLLECTION_LIKE_DUPLICATE_TOKENS = [
  "awesome",
  "collection",
  "collections",
  "registry",
  "template",
  "mirror",
  "hub",
  "marketplace",
  "bundled",
  "public/skills",
  "assets",
  "community",
  "skill-store",
  "skillstore",
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCommand(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function repoFromGithubUrl(value: string): string {
  const match = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return "";
  return `${match[1]!.toLowerCase()}/${match[2]!.replace(/\.git$/i, "").toLowerCase()}`;
}

function normalizedRepoNameKey(skill: DuplicateAuditSkill): { repo: string; normalizedName: string; key: string } {
  const repo = repoFromGithubUrl(skill.github_url);
  const normalizedName = normalizeText(skill.name);
  return { repo, normalizedName, key: repo && normalizedName ? `${repo}\t${normalizedName}` : "" };
}

function repoOwner(skill: DuplicateAuditSkill): string {
  const repo = repoFromGithubUrl(skill.github_url);
  return repo.split("/")[0] ?? "";
}

export function isCollectionLikeDuplicateCopy(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  return COLLECTION_LIKE_DUPLICATE_TOKENS.some((token) => normalized.includes(token));
}

function sampleSkill(skill: DuplicateAuditSkill): DuplicateAuditSkillSample {
  return {
    id: skill.id,
    name: skill.name,
    github_url: skill.github_url,
    author_handle: skill.author_handle,
    provenance_type: skill.provenance_type ?? "unknown",
    stars: skill.stars,
  };
}

function pathSegmentCount(path: string | null | undefined): number {
  const normalized = (path ?? "").trim();
  if (!normalized || normalized === "__RESOLVE__") return Number.POSITIVE_INFINITY;
  return normalized.split("/").filter(Boolean).length;
}

function skillIdSuffix(skill: DuplicateAuditSkill): string {
  const separatorIndex = skill.id.indexOf(":");
  if (separatorIndex === -1) return "";
  return normalizeText(skill.id.slice(separatorIndex + 1));
}

function baseIdScore(skill: DuplicateAuditSkill): number {
  return skillIdSuffix(skill) === normalizeText(skill.name) ? 0 : 1;
}

function compareCanonicalSkill(a: DuplicateAuditSkill, b: DuplicateAuditSkill): number {
  return (
    baseIdScore(a) - baseIdScore(b) ||
    pathSegmentCount(a.skill_md_path) - pathSegmentCount(b.skill_md_path) ||
    b.stars - a.stars ||
    a.id.localeCompare(b.id)
  );
}

function compareCanonicalExactShaSkill(a: DuplicateAuditSkill, b: DuplicateAuditSkill): number {
  return b.stars - a.stars || compareCanonicalSkill(a, b);
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    if (!key) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  }
  return grouped;
}

function buildClusters(
  category: DuplicateAuditCategory,
  skills: DuplicateAuditSkill[],
  keyForSkill: (skill: DuplicateAuditSkill) => string,
): DuplicateAuditCategoryResult {
  const grouped = new Map<string, DuplicateAuditSkill[]>();

  for (const skill of skills) {
    const key = keyForSkill(skill);
    if (!key) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(skill);
    grouped.set(key, rows);
  }

  const clusters = [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      samples: rows
        .sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id))
        .slice(0, SAMPLE_LIMIT)
        .map(sampleSkill),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    category,
    clusterCount: clusters.length,
    affectedSkillCount: clusters.reduce((sum, cluster) => sum + cluster.count, 0),
    clusters: clusters.slice(0, CLUSTER_LIMIT),
  };
}

export function buildDuplicateAudit(skills: DuplicateAuditSkill[]): DuplicateAuditResult {
  return {
    skillCount: skills.length,
    categories: [
      buildClusters("skill_md_sha", skills, (skill) => normalizeText(skill.skill_md_sha)),
      buildClusters("author_name", skills, (skill) => {
        const author = normalizeText(skill.author_handle);
        const name = normalizeText(skill.name);
        return author && name ? `${author}\t${name}` : "";
      }),
      buildClusters("install_cmd", skills, (skill) => normalizeCommand(skill.install_cmd)),
      buildClusters("repo_name", skills, (skill) => normalizedRepoNameKey(skill).key),
    ],
  };
}

export function buildSameRepoSuppressionPlan(skills: DuplicateAuditSkill[]): SameRepoSuppressionPlan {
  const byRepoName = groupBy(skills, (skill) => normalizedRepoNameKey(skill).key);

  const candidates: SameRepoSuppressionCandidate[] = [];
  const reviewOnlyClusters: SameRepoReviewOnlyCluster[] = [];

  for (const rows of byRepoName.values()) {
    if (rows.length < 2) continue;

    const { repo, normalizedName } = normalizedRepoNameKey(rows[0]!);
    const bySha = new Map<string, DuplicateAuditSkill[]>();
    let missingSha = false;

    for (const row of rows) {
      const sha = normalizeText(row.skill_md_sha);
      if (!sha) {
        missingSha = true;
        continue;
      }
      const shaRows = bySha.get(sha) ?? [];
      shaRows.push(row);
      bySha.set(sha, shaRows);
    }

    for (const [sha, shaRows] of bySha.entries()) {
      if (shaRows.length < 2) continue;
      const sorted = [...shaRows].sort(compareCanonicalSkill);
      const keep = sorted[0]!;
      const suppressIds = sorted.slice(1).map((skill) => skill.id).sort();
      candidates.push({
        repo,
        normalizedName,
        skillMdSha: sha,
        reason: "same-repo-same-name-same-sha",
        keepId: keep.id,
        suppressIds,
        suggestedSuppressionEntries: suppressIds.map((id) => ({
          id,
          reason: "same-repo-same-name-same-sha",
          replacementId: keep.id,
        })),
      });
    }

    if (missingSha || bySha.size !== 1) {
      reviewOnlyClusters.push({
        repo,
        normalizedName,
        reason: "same-repo-same-name-different-or-missing-sha",
        count: rows.length,
        samples: [...rows].sort(compareCanonicalSkill).slice(0, SAMPLE_LIMIT).map(sampleSkill),
      });
    }
  }

  candidates.sort(
    (a, b) =>
      b.suppressIds.length - a.suppressIds.length ||
      a.repo.localeCompare(b.repo) ||
      a.normalizedName.localeCompare(b.normalizedName) ||
      a.skillMdSha.localeCompare(b.skillMdSha),
  );
  reviewOnlyClusters.sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo) || a.normalizedName.localeCompare(b.normalizedName));

  return {
    candidateClusterCount: candidates.length,
    suppressCandidateCount: candidates.reduce((sum, candidate) => sum + candidate.suppressIds.length, 0),
    candidates,
    reviewOnlyClusterCount: reviewOnlyClusters.length,
    reviewOnlyAffectedSkillCount: reviewOnlyClusters.reduce((sum, cluster) => sum + cluster.count, 0),
    reviewOnlyClusters: reviewOnlyClusters.slice(0, CLUSTER_LIMIT),
  };
}

function catalogRepoSetFromRules(rules: CatalogRepoRule[] | undefined): Set<string> {
  return new Set((rules ?? []).map((rule) => rule.repo.trim().replace(/\.git$/i, "").toLowerCase()).filter(Boolean));
}

function exactShaCanonicalDecision(rows: DuplicateAuditSkill[], catalogRepos = new Set<string>()): {
  keep: DuplicateAuditSkill;
  reason: ExactShaCanonicalReason;
  confidence: ExactShaCanonicalConfidence;
} | null {
  const byPublisher = groupBy(rows, (skill) => repoFromGithubUrl(skill.github_url));
  if (byPublisher.size === 1) {
    return {
      keep: [...rows].sort(compareCanonicalSkill)[0]!,
      reason: "same-publisher",
      confidence: "high",
    };
  }

  const trusted = rows.filter((skill) => TRUSTED_CANONICAL_OWNERS.has(repoOwner(skill)));
  if (trusted.length === 1) {
    return {
      keep: trusted[0]!,
      reason: "trusted-owner",
      confidence: "high",
    };
  }

  const trustedRepo = rows.filter((skill) => TRUSTED_CANONICAL_REPOS.has(repoFromGithubUrl(skill.github_url)));
  if (trustedRepo.length === 1) {
    return {
      keep: trustedRepo[0]!,
      reason: "trusted-owner",
      confidence: "high",
    };
  }

  const sortedByStars = rows
    .filter((skill) => !catalogRepos.has(repoFromGithubUrl(skill.github_url)))
    .sort(compareCanonicalExactShaSkill);
  const leader = sortedByStars[0]!;
  const runnerUp = sortedByStars[1];
  if (!leader) return null;
  if (leader.stars >= 50 && (!runnerUp || leader.stars >= runnerUp.stars * 10)) {
    return {
      keep: leader,
      reason: "clear-star-leader",
      confidence: "medium",
    };
  }

  return null;
}

export function buildExactShaCanonicalPlan(
  skills: DuplicateAuditSkill[],
  options: { catalogRepoRules?: CatalogRepoRule[] } = {},
): ExactShaCanonicalPlan {
  const bySha = groupBy(skills, (skill) => normalizeText(skill.skill_md_sha));
  const catalogRepos = catalogRepoSetFromRules(options.catalogRepoRules);
  const candidates: ExactShaCanonicalCandidate[] = [];
  const reviewOnlyClusters: ExactShaReviewOnlyCluster[] = [];

  for (const [sha, rows] of bySha.entries()) {
    if (rows.length < 2) continue;
    const decision = exactShaCanonicalDecision(rows, catalogRepos);
    if (!decision) {
      reviewOnlyClusters.push({
        skillMdSha: sha,
        reason: "ambiguous-exact-sha",
        count: rows.length,
        samples: [...rows].sort(compareCanonicalExactShaSkill).slice(0, SAMPLE_LIMIT).map(sampleSkill),
      });
      continue;
    }

    const suppressIds = rows
      .filter((skill) => skill.id !== decision.keep.id)
      .map((skill) => skill.id)
      .sort();
    candidates.push({
      skillMdSha: sha,
      reason: decision.reason,
      confidence: decision.confidence,
      keepId: decision.keep.id,
      suppressIds,
      suggestedSuppressionEntries: suppressIds.map((id) => ({
        id,
        reason: decision.reason,
        confidence: decision.confidence,
        replacementId: decision.keep.id,
      })),
      samples: [...rows].sort(compareCanonicalExactShaSkill).slice(0, SAMPLE_LIMIT).map(sampleSkill),
    });
  }

  candidates.sort(
    (a, b) =>
      b.suppressIds.length - a.suppressIds.length ||
      a.confidence.localeCompare(b.confidence) ||
      a.reason.localeCompare(b.reason) ||
      a.keepId.localeCompare(b.keepId),
  );
  reviewOnlyClusters.sort((a, b) => b.count - a.count || a.skillMdSha.localeCompare(b.skillMdSha));
  const suppressCandidateCountByReason = {
    "same-publisher": 0,
    "trusted-owner": 0,
    "clear-star-leader": 0,
  };
  const suppressCandidateCountByConfidence = {
    high: 0,
    medium: 0,
  };
  for (const candidate of candidates) {
    suppressCandidateCountByReason[candidate.reason] += candidate.suppressIds.length;
    suppressCandidateCountByConfidence[candidate.confidence] += candidate.suppressIds.length;
  }

  return {
    candidateClusterCount: candidates.length,
    suppressCandidateCount: candidates.reduce((sum, candidate) => sum + candidate.suppressIds.length, 0),
    suppressCandidateCountByReason,
    suppressCandidateCountByConfidence,
    candidates,
    reviewOnlyClusterCount: reviewOnlyClusters.length,
    reviewOnlyAffectedSkillCount: reviewOnlyClusters.reduce((sum, cluster) => sum + cluster.count, 0),
    reviewOnlyClusters: reviewOnlyClusters.slice(0, CLUSTER_LIMIT),
  };
}

function loadSkills(): { path: string; skills: DuplicateAuditSkill[] } {
  const path = existsSync(DEFAULT_SKILLS_PATH) ? DEFAULT_SKILLS_PATH : FALLBACK_SKILLS_PATH;
  const skills = JSON.parse(readFileSync(path, "utf8")) as ShadowSkillRecord[];
  return { path, skills };
}

function readSuppressedSkillsSeedFile(): SuppressedSkillsSeedFile {
  if (!existsSync(SUPPRESSED_SKILLS_PATH)) return { skills: [] };
  return JSON.parse(readFileSync(SUPPRESSED_SKILLS_PATH, "utf8")) as SuppressedSkillsSeedFile;
}

export function buildHighConfidenceSuppressionEntries(
  plan: ExactShaCanonicalPlan,
  nowIso: string,
): SuggestedSuppressedSkillEntry[] {
  const entries: SuggestedSuppressedSkillEntry[] = [];
  for (const candidate of plan.candidates) {
    if (candidate.confidence !== "high") continue;
    for (const entry of candidate.suggestedSuppressionEntries) {
      entries.push({
        id: entry.id,
        reason: entry.reason,
        replacementId: entry.replacementId,
        confidence: entry.confidence,
        stagedAt: nowIso,
      });
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildPartialMediumSuppressionEntries(
  plan: ExactShaCanonicalPlan,
  skills: DuplicateAuditSkill[],
  nowIso: string,
  options: { catalogRepoRules?: CatalogRepoRule[] } = {},
): SuggestedSuppressedSkillEntry[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const catalogRepos = catalogRepoSetFromRules(options.catalogRepoRules);
  const entries: SuggestedSuppressedSkillEntry[] = [];

  for (const candidate of plan.candidates) {
    if (candidate.reason !== "clear-star-leader" || candidate.confidence !== "medium") continue;
    if (isCollectionLikeDuplicateCopy(candidate.keepId)) continue;
    const keepSkill = byId.get(candidate.keepId);
    if (!keepSkill) continue;

    for (const id of candidate.suppressIds) {
      const skill = byId.get(id);
      if (!skill) continue;
      const reason: PartialMediumSuppressionReason | null = catalogRepos.has(repoFromGithubUrl(skill.github_url))
        ? "catalog-copy"
        : isCollectionLikeDuplicateCopy(id)
        ? "collection-like-copy"
        : skill.stars <= 5 && keepSkill.stars >= 100
          ? "low-signal-copy"
          : null;
      if (!reason) continue;
      entries.push({
        id,
        reason,
        replacementId: candidate.keepId,
        confidence: "high",
        stagedAt: nowIso,
      });
    }
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildCatalogCopySuppressionEntries(
  plan: ExactShaCanonicalPlan,
  skills: DuplicateAuditSkill[],
  catalogRepoRules: CatalogRepoRule[],
  nowIso: string,
): SuggestedSuppressedSkillEntry[] {
  return buildPartialMediumSuppressionEntries(plan, skills, nowIso, { catalogRepoRules }).filter(
    (entry) => entry.reason === "catalog-copy",
  );
}

function writeHighConfidenceSuppressions(
  plan: ExactShaCanonicalPlan,
  skills: DuplicateAuditSkill[],
  options: { catalogRepoRules?: CatalogRepoRule[] } = {},
  nowIso = new Date().toISOString(),
): {
  added: number;
  total: number;
} {
  const existing = readSuppressedSkillsSeedFile();
  const byId = new Map(existing.skills.map((entry) => [entry.id.trim().toLowerCase(), entry]));

  for (const entry of [
    ...buildHighConfidenceSuppressionEntries(plan, nowIso),
    ...buildPartialMediumSuppressionEntries(plan, skills, nowIso, options),
  ]) {
    const key = entry.id.trim().toLowerCase();
    if (byId.has(key)) continue;
    byId.set(key, entry);
  }

  const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(SUPPRESSED_SKILLS_PATH, JSON.stringify({ skills: sorted }, null, 2) + "\n");
  return { added: sorted.length - existing.skills.length, total: sorted.length };
}

function writeCatalogCopySuppressions(
  plan: ExactShaCanonicalPlan,
  skills: DuplicateAuditSkill[],
  catalogRepoRules: CatalogRepoRule[],
  nowIso = new Date().toISOString(),
): {
  added: number;
  total: number;
} {
  const existing = readSuppressedSkillsSeedFile();
  const byId = new Map(existing.skills.map((entry) => [entry.id.trim().toLowerCase(), entry]));

  for (const entry of buildCatalogCopySuppressionEntries(plan, skills, catalogRepoRules, nowIso)) {
    const key = entry.id.trim().toLowerCase();
    if (byId.has(key)) continue;
    byId.set(key, entry);
  }

  const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(SUPPRESSED_SKILLS_PATH, JSON.stringify({ skills: sorted }, null, 2) + "\n");
  return { added: sorted.length - existing.skills.length, total: sorted.length };
}

function printAudit(sourcePath: string, audit: DuplicateAuditResult): void {
  console.log(`duplicate audit source: ${sourcePath}`);
  console.log(`skills: ${audit.skillCount}`);
  for (const category of audit.categories) {
    console.log("");
    console.log(`## ${category.category}`);
    console.log(`clusters: ${category.clusterCount}`);
    console.log(`affected skills: ${category.affectedSkillCount}`);
    for (const cluster of category.clusters) {
      console.log(`- ${cluster.key} (${cluster.count})`);
      for (const sample of cluster.samples) {
        console.log(
          `  - ${sample.id} | @${sample.author_handle || "?"} | ${sample.provenance_type} | stars=${sample.stars} | ${sample.github_url}`,
        );
      }
    }
  }
}

function printSameRepoSuppressionPlan(plan: SameRepoSuppressionPlan): void {
  console.log("");
  console.log("## same_repo_suppression_plan");
  console.log(`candidate clusters: ${plan.candidateClusterCount}`);
  console.log(`suppress candidates: ${plan.suppressCandidateCount}`);
  for (const candidate of plan.candidates.slice(0, CLUSTER_LIMIT)) {
    console.log(`- ${candidate.repo}\t${candidate.normalizedName}\t${candidate.skillMdSha}`);
    console.log(`  keep: ${candidate.keepId}`);
    console.log(`  suppress: ${candidate.suppressIds.join(", ")}`);
    console.log(`  reason: ${candidate.reason}`);
    console.log("  suggested suppressed-skills entries:");
    for (const entry of candidate.suggestedSuppressionEntries) {
      console.log(`    - ${entry.id} -> ${entry.replacementId} (${entry.reason})`);
    }
  }

  console.log("");
  console.log("## same_repo_review_only");
  console.log(`clusters: ${plan.reviewOnlyClusterCount}`);
  console.log(`affected skills: ${plan.reviewOnlyAffectedSkillCount}`);
  for (const cluster of plan.reviewOnlyClusters) {
    console.log(`- ${cluster.repo}\t${cluster.normalizedName} (${cluster.count})`);
    for (const sample of cluster.samples) {
      console.log(
        `  - ${sample.id} | @${sample.author_handle || "?"} | ${sample.provenance_type} | stars=${sample.stars} | ${sample.github_url}`,
      );
    }
  }
}

function printExactShaCanonicalPlan(plan: ExactShaCanonicalPlan): void {
  console.log("");
  console.log("## exact_sha_canonical_plan");
  console.log(`candidate clusters: ${plan.candidateClusterCount}`);
  console.log(`suppress candidates: ${plan.suppressCandidateCount}`);
  console.log(`by reason: ${Object.entries(plan.suppressCandidateCountByReason).map(([reason, count]) => `${reason}=${count}`).join(", ")}`);
  console.log(`by confidence: ${Object.entries(plan.suppressCandidateCountByConfidence).map(([confidence, count]) => `${confidence}=${count}`).join(", ")}`);
  for (const candidate of plan.candidates) {
    console.log(`- ${candidate.skillMdSha}`);
    console.log(`  keep: ${candidate.keepId}`);
    console.log(`  suppress: ${candidate.suppressIds.join(", ")}`);
    console.log(`  reason: ${candidate.reason}`);
    console.log(`  confidence: ${candidate.confidence}`);
    console.log("  suggested suppressed-skills entries:");
    for (const entry of candidate.suggestedSuppressionEntries) {
      console.log(`    - ${entry.id} -> ${entry.replacementId} (${entry.reason}, ${entry.confidence})`);
    }
  }

  console.log("");
  console.log("## exact_sha_review_only");
  console.log(`clusters: ${plan.reviewOnlyClusterCount}`);
  console.log(`affected skills: ${plan.reviewOnlyAffectedSkillCount}`);
  for (const cluster of plan.reviewOnlyClusters) {
    console.log(`- ${cluster.skillMdSha} (${cluster.count})`);
    for (const sample of cluster.samples) {
      console.log(
        `  - ${sample.id} | @${sample.author_handle || "?"} | ${sample.provenance_type} | stars=${sample.stars} | ${sample.github_url}`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { path, skills } = loadSkills();
  printAudit(path, buildDuplicateAudit(skills));
  if (process.argv.includes("--same-repo-plan")) {
    printSameRepoSuppressionPlan(buildSameRepoSuppressionPlan(skills));
  }
  if (process.argv.includes("--exact-sha-plan")) {
    const seeds = loadTrustedSeeds();
    const plan = buildExactShaCanonicalPlan(filterSuppressedSkills(filterDoNotCrawlSkills(skills, seeds), seeds), {
      catalogRepoRules: seeds.catalogRepoRules,
    });
    printExactShaCanonicalPlan(plan);
    if (process.argv.includes("--write-high-confidence-suppressions")) {
      const result = writeHighConfidenceSuppressions(plan, skills, { catalogRepoRules: seeds.catalogRepoRules });
      console.log("");
      console.log(`wrote high-confidence suppressions: ${result.added} added, ${result.total} total`);
    }
    if (process.argv.includes("--write-catalog-copy-suppressions")) {
      const result = writeCatalogCopySuppressions(plan, skills, seeds.catalogRepoRules);
      console.log("");
      console.log(`wrote catalog-copy suppressions: ${result.added} added, ${result.total} total`);
    }
  }
}

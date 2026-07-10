import { resolveCreatorHandle } from "./seeds.js";
import type { QualityTier, ShadowRepoIndex, ShadowRepoIndexEntry, ShadowSkillRecord, TrustedSeeds } from "./types.js";

export const QUALITY_TIERS = ["curated", "creator", "validated"] as const;

type ClassifyQualityTierInput = {
  skill: ShadowSkillRecord;
  repo: ShadowRepoIndexEntry | null;
  seeds: TrustedSeeds;
  goldBasketSkillIds: Set<string>;
};

export function classifySkillQualityTier({
  skill,
  repo,
  seeds,
  goldBasketSkillIds,
}: ClassifyQualityTierInput): QualityTier {
  const repoName = repo?.repo ?? skill.publisher_repo;
  const isKnownCatalogRepo = seeds.catalogRepoRules.some((rule) => rule.repo === repoName.toLowerCase());
  if (isKnownCatalogRepo) return "validated";

  const author = resolveCreatorHandle(seeds, skill.author_handle);
  const isOriginal = skill.provenance_type === "original";
  const isGoldBasketSkill = goldBasketSkillIds.has(skill.id) || goldBasketSkillIds.has(skill.id.toLowerCase());
  const isManuallyCurated = repo?.discoveredSources.includes("manual-curation") ?? false;
  const isFeaturedCreator = seeds.featuredCreatorHandles?.has(author) ?? false;

  if (isGoldBasketSkill || isManuallyCurated || (isOriginal && isFeaturedCreator)) {
    return "curated";
  }

  const isOfficialRepo = repo
    ? seeds.officialTier1Repos.has(repo.repo) || seeds.officialTier2Repos.has(repo.repo)
    : false;
  const isWatchedCreator = seeds.watchedCreatorHandles?.has(author) ?? false;
  const isTrustedVendor = seeds.trustedVendorHandles.has(author);

  if (isOriginal && (isOfficialRepo || isWatchedCreator || isTrustedVendor)) {
    return "creator";
  }

  return "validated";
}

export function stripQualityTiers(skills: ShadowSkillRecord[]): ShadowSkillRecord[] {
  return skills.map((skill) => {
    const { quality_tier: _qualityTier, ...untiered } = skill;
    return untiered;
  });
}

export function applyQualityTiers(
  skills: ShadowSkillRecord[],
  repoIndex: ShadowRepoIndex,
  seeds: TrustedSeeds,
  goldBasketSkillIds: Set<string>,
  enabled: boolean,
): ShadowSkillRecord[] {
  const untieredSkills = stripQualityTiers(skills);
  if (!enabled) return untieredSkills;

  const repoBySkillId = new Map<string, ShadowRepoIndexEntry>();
  for (const repo of repoIndex.repos) {
    for (const skillId of repo.skillIds) repoBySkillId.set(skillId, repo);
  }

  return untieredSkills.map((skill) => ({
    ...skill,
    quality_tier: classifySkillQualityTier({
      skill,
      repo: repoBySkillId.get(skill.id) ?? null,
      seeds,
      goldBasketSkillIds,
    }),
  }));
}

export function summarizeQualityTiers(skills: ShadowSkillRecord[]): {
  counts: Record<QualityTier, number>;
  samples: Record<QualityTier, string[]>;
} {
  const counts: Record<QualityTier, number> = { curated: 0, creator: 0, validated: 0 };
  const samples: Record<QualityTier, string[]> = { curated: [], creator: [], validated: [] };
  const sampledRepos: Record<QualityTier, Set<string>> = {
    curated: new Set(),
    creator: new Set(),
    validated: new Set(),
  };

  for (const skill of skills) {
    if (!skill.quality_tier) continue;
    counts[skill.quality_tier] += 1;
    const sampleRepo = skill.publisher_repo || skill.github_url;
    if (samples[skill.quality_tier].length < 10 && !sampledRepos[skill.quality_tier].has(sampleRepo)) {
      samples[skill.quality_tier].push(skill.id);
      sampledRepos[skill.quality_tier].add(sampleRepo);
    }
  }

  return { counts, samples };
}

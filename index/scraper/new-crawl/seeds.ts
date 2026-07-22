import {
  buildCreatorRegistry,
  normalizeCreatorHandle,
  type CreatorRegistrySource,
} from "../creator-registry.js";
import {
  normalizePolicyRepo,
  normalizePolicySkillId,
} from "../../../scripts/policy-identifiers.mjs";
import { loadPolicySources, typedPolicySources } from "../policy/loader.js";
import { assertPolicyValid, validatePolicy } from "../policy/validator.js";
import type { PolicyValidationProfile } from "../policy/types.js";
import type {
  CatalogRepoRule,
  DoNotCrawlRule,
  ProvenanceOverride,
  RepoOverride,
  SuppressedSkillRule,
  TrustedSeeds,
} from "./types.js";

type OfficialRepoSeeds = { tier1?: string[]; tier2?: string[] };
type ManualIncludeRepoSeeds = { include?: string[] };
type DoNotCrawlSeeds = { repos?: DoNotCrawlRule[]; owners?: DoNotCrawlRule[] };
type RootSkillInvalidSeeds = { repos?: Array<{ repo: string }> };
type SuppressedSkillSeeds = { skills?: SuppressedSkillRule[] };

function normalizeHandle(value: string): string {
  return normalizeCreatorHandle(value);
}

function normalizeRepo(value: string): string {
  return normalizePolicyRepo(value);
}

function normalizeSkillId(value: string): string {
  return normalizePolicySkillId(value);
}

function normalizeRepoSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeRepo).filter(Boolean));
}

export function resolveCreatorHandle(seeds: TrustedSeeds, handle: string): string {
  const normalized = normalizeHandle(handle);
  return seeds.creatorAliasToCanonicalHandle?.get(normalized) ?? normalized;
}

export function buildTrustedSeeds(input: {
  creatorRegistryJson: CreatorRegistrySource;
  officialJson: OfficialRepoSeeds;
  manualIncludeJson: ManualIncludeRepoSeeds;
  doNotCrawlJson: DoNotCrawlSeeds;
  rootSkillInvalidJson?: RootSkillInvalidSeeds;
  suppressedSkillsJson?: SuppressedSkillSeeds;
  overridesJson: RepoOverride[];
  catalogJson: CatalogRepoRule[];
  provenanceJson: ProvenanceOverride[];
}): TrustedSeeds {
  const doNotCrawlRules = [
    ...(input.doNotCrawlJson.repos ?? []).map((rule) => ({
      ...rule,
      repo: rule.repo ? normalizeRepo(rule.repo) : undefined,
    })),
    ...(input.doNotCrawlJson.owners ?? []).map((rule) => ({
      ...rule,
      owner: rule.owner ? normalizeHandle(rule.owner) : undefined,
    })),
  ].filter((rule) => rule.repo || rule.owner);
  const suppressedSkillRules: SuppressedSkillRule[] = [];
  for (const rule of input.suppressedSkillsJson?.skills ?? []) {
    const id = rule.id?.trim();
    if (!id) continue;
    suppressedSkillRules.push({
      ...rule,
      id,
      replacementId: rule.replacementId?.trim(),
    });
  }

  const creatorRegistry = buildCreatorRegistry(input.creatorRegistryJson);

  return {
    trustedVendorHandles: new Set(creatorRegistry.vendorHandles),
    trustedCreatorHandles: new Set(creatorRegistry.creatorHandles),
    watchedCreatorHandles: creatorRegistry.watchedHandles,
    featuredCreatorHandles: creatorRegistry.featuredHandles,
    creatorAliasToCanonicalHandle: creatorRegistry.aliasToCanonical,
    officialTier1Repos: normalizeRepoSet(input.officialJson.tier1),
    officialTier2Repos: normalizeRepoSet(input.officialJson.tier2),
    manualIncludeRepos: normalizeRepoSet(input.manualIncludeJson.include),
    doNotCrawlRepos: new Set(doNotCrawlRules.map((rule) => rule.repo).filter((repo): repo is string => Boolean(repo))),
    doNotCrawlOwners: new Set(
      doNotCrawlRules.map((rule) => rule.owner).filter((owner): owner is string => Boolean(owner)),
    ),
    doNotCrawlRules,
    rootSkillInvalidRepos: normalizeRepoSet(input.rootSkillInvalidJson?.repos?.map((rule) => rule.repo)),
    suppressedSkillIds: new Set(suppressedSkillRules.map((rule) => normalizeSkillId(rule.id))),
    suppressedSkillRules,
    repoOverrides: input.overridesJson
      .map((override) => ({
        ...override,
        repo: normalizeRepo(override.repo),
      }))
      .filter((override) => override.repo),
    catalogRepoRules: input.catalogJson
      .map((rule) => ({
        ...rule,
        repo: normalizeRepo(rule.repo),
        publisherHandle: rule.publisherHandle ? normalizeHandle(rule.publisherHandle) : undefined,
      }))
      .filter((rule) => rule.repo),
    provenanceOverrides: input.provenanceJson
      .map((override) => ({
        ...override,
        id: override.id?.trim(),
        repo: override.repo ? normalizeRepo(override.repo) : undefined,
        authorHandle: override.authorHandle ? normalizeHandle(override.authorHandle) : undefined,
        publisherHandle: override.publisherHandle ? normalizeHandle(override.publisherHandle) : undefined,
        upstreamRepo: override.upstreamRepo ? normalizeRepo(override.upstreamRepo) : undefined,
      }))
      .filter((override) => override.id || override.repo),
  };
}

export function loadTrustedSeeds(profile: PolicyValidationProfile = "scheduled-data"): TrustedSeeds {
  const loaded = loadPolicySources();
  const issues = validatePolicy(loaded);
  assertPolicyValid(issues, profile);
  const sources = typedPolicySources(loaded);

  return buildTrustedSeeds({
    creatorRegistryJson: sources.creators,
    officialJson: sources.officialRepos,
    manualIncludeJson: sources.manualIncludeRepos,
    doNotCrawlJson: sources.doNotCrawl,
    rootSkillInvalidJson: sources.rootSkillInvalid,
    suppressedSkillsJson: sources.suppressedSkills,
    overridesJson: sources.repoOverrides,
    catalogJson: sources.catalogRepos,
    provenanceJson: sources.provenanceOverrides,
  });
}

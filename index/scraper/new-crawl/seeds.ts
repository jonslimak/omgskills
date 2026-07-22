import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCreatorRegistry,
  normalizeCreatorHandle,
  type CreatorRegistrySource,
} from "../creator-registry.js";
import { indexRoot } from "./shadow-path-guard.js";
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
type SuppressedSkillSeeds = { skills?: SuppressedSkillRule[] };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeHandle(value: string): string {
  return normalizeCreatorHandle(value);
}

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase();
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

export function loadTrustedSeeds(): TrustedSeeds {
  const seedsRoot = join(indexRoot, "seeds");
  const creatorRegistryJson = readJson<CreatorRegistrySource>(join(seedsRoot, "creators.json"));
  const officialJson = readJson<OfficialRepoSeeds>(join(seedsRoot, "official-repos.json"));
  const manualIncludeJson = readJson<ManualIncludeRepoSeeds>(join(seedsRoot, "manual-include-repos.json"));
  const doNotCrawlJson = readJson<DoNotCrawlSeeds>(join(seedsRoot, "do-not-crawl.json"));
  const suppressedSkillsJson = readJson<SuppressedSkillSeeds>(join(seedsRoot, "suppressed-skills.json"));
  const overridesJson = readJson<RepoOverride[]>(join(seedsRoot, "repo-overrides.json"));
  const catalogJson = readJson<CatalogRepoRule[]>(join(seedsRoot, "catalog-repos.json"));
  const provenanceJson = readJson<ProvenanceOverride[]>(join(seedsRoot, "provenance-overrides.json"));

  return buildTrustedSeeds({
    creatorRegistryJson,
    officialJson,
    manualIncludeJson,
    doNotCrawlJson,
    suppressedSkillsJson,
    overridesJson,
    catalogJson,
    provenanceJson,
  });
}

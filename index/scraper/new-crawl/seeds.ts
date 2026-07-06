import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { indexRoot } from "./shadow-path-guard.js";
import type {
  CatalogRepoRule,
  CreatorRegistryEntry,
  DoNotCrawlRule,
  ProvenanceOverride,
  RepoOverride,
  SuppressedSkillRule,
  TrustedSeeds,
} from "./types.js";

type HandleList = { handles: string[] };
type OfficialRepoSeeds = { tier1?: string[]; tier2?: string[] };
type ManualIncludeRepoSeeds = { include?: string[] };
type DoNotCrawlSeeds = { repos?: DoNotCrawlRule[]; owners?: DoNotCrawlRule[] };
type SuppressedSkillSeeds = { skills?: SuppressedSkillRule[] };
type CreatorRegistrySeeds = { creators?: CreatorRegistryEntry[] } | CreatorRegistryEntry[];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
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

function creatorRegistryEntries(input: CreatorRegistrySeeds | undefined): CreatorRegistryEntry[] {
  if (!input) return [];
  return Array.isArray(input) ? input : (input.creators ?? []);
}

function buildCreatorRegistry(input: CreatorRegistrySeeds | undefined) {
  const vendorHandles = new Set<string>();
  const creatorHandles = new Set<string>();
  const watchedHandles = new Set<string>();
  const featuredHandles = new Set<string>();
  const aliasToCanonical = new Map<string, string>();

  for (const entry of creatorRegistryEntries(input)) {
    const canonical = normalizeHandle(entry.handle);
    if (!canonical) continue;
    const roles = new Set(entry.roles ?? []);

    if (entry.featured && !entry.watch) {
      throw new Error(`Invalid creators.json entry for ${canonical}: featured creators must be watched.`);
    }

    if (roles.has("vendor")) vendorHandles.add(canonical);
    if (roles.has("creator")) creatorHandles.add(canonical);
    if (entry.watch) watchedHandles.add(canonical);
    if (entry.featured) featuredHandles.add(canonical);

    for (const rawAlias of entry.aliases ?? []) {
      const alias = normalizeHandle(rawAlias);
      if (!alias || alias === canonical) continue;
      const existing = aliasToCanonical.get(alias);
      if (existing && existing !== canonical) {
        throw new Error(`Invalid creators.json: alias ${alias} maps to both ${existing} and ${canonical}.`);
      }
      aliasToCanonical.set(alias, canonical);
    }
  }

  return { vendorHandles, creatorHandles, watchedHandles, featuredHandles, aliasToCanonical };
}

export function resolveCreatorHandle(seeds: TrustedSeeds, handle: string): string {
  const normalized = normalizeHandle(handle);
  return seeds.creatorAliasToCanonicalHandle?.get(normalized) ?? normalized;
}

export function buildTrustedSeeds(input: {
  vendorJson: HandleList;
  creatorJson: HandleList;
  creatorRegistryJson?: CreatorRegistrySeeds;
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
  const trustedVendorHandles = new Set([
    ...input.vendorJson.handles.map(normalizeHandle).filter(Boolean),
    ...creatorRegistry.vendorHandles,
  ]);
  const trustedCreatorHandles = new Set([
    ...input.creatorJson.handles.map(normalizeHandle).filter(Boolean),
    ...creatorRegistry.creatorHandles,
  ]);

  return {
    trustedVendorHandles,
    trustedCreatorHandles,
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
  const vendorJson = readJson<HandleList>(join(seedsRoot, "trusted-vendors.json"));
  const creatorJson = readJson<HandleList>(join(seedsRoot, "trusted-creators.json"));
  const creatorRegistryPath = join(seedsRoot, "creators.json");
  const creatorRegistryJson = existsSync(creatorRegistryPath)
    ? readJson<CreatorRegistrySeeds>(creatorRegistryPath)
    : { creators: [] };
  const officialJson = readJson<OfficialRepoSeeds>(join(seedsRoot, "official-repos.json"));
  const manualIncludeJson = readJson<ManualIncludeRepoSeeds>(join(seedsRoot, "manual-include-repos.json"));
  const doNotCrawlJson = readJson<DoNotCrawlSeeds>(join(seedsRoot, "do-not-crawl.json"));
  const suppressedSkillsJson = readJson<SuppressedSkillSeeds>(join(seedsRoot, "suppressed-skills.json"));
  const overridesJson = readJson<RepoOverride[]>(join(seedsRoot, "repo-overrides.json"));
  const catalogJson = readJson<CatalogRepoRule[]>(join(seedsRoot, "catalog-repos.json"));
  const provenanceJson = readJson<ProvenanceOverride[]>(join(seedsRoot, "provenance-overrides.json"));

  return buildTrustedSeeds({
    vendorJson,
    creatorJson,
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

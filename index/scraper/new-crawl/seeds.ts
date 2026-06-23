import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indexRoot } from "./shadow-path-guard.js";
import type { CatalogRepoRule, ProvenanceOverride, RepoOverride, TrustedSeeds } from "./types.js";

type HandleList = { handles: string[] };
type OfficialRepoSeeds = { tier1?: string[]; tier2?: string[] };
type ManualIncludeRepoSeeds = { include?: string[] };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

function normalizeRepoSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeRepo).filter(Boolean));
}

export function buildTrustedSeeds(input: {
  vendorJson: HandleList;
  creatorJson: HandleList;
  officialJson: OfficialRepoSeeds;
  manualIncludeJson: ManualIncludeRepoSeeds;
  overridesJson: RepoOverride[];
  catalogJson: CatalogRepoRule[];
  provenanceJson: ProvenanceOverride[];
}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(input.vendorJson.handles.map(normalizeHandle).filter(Boolean)),
    trustedCreatorHandles: new Set(input.creatorJson.handles.map(normalizeHandle).filter(Boolean)),
    officialTier1Repos: normalizeRepoSet(input.officialJson.tier1),
    officialTier2Repos: normalizeRepoSet(input.officialJson.tier2),
    manualIncludeRepos: normalizeRepoSet(input.manualIncludeJson.include),
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
  const officialJson = readJson<OfficialRepoSeeds>(join(seedsRoot, "official-repos.json"));
  const manualIncludeJson = readJson<ManualIncludeRepoSeeds>(join(seedsRoot, "manual-include-repos.json"));
  const overridesJson = readJson<RepoOverride[]>(join(seedsRoot, "repo-overrides.json"));
  const catalogJson = readJson<CatalogRepoRule[]>(join(seedsRoot, "catalog-repos.json"));
  const provenanceJson = readJson<ProvenanceOverride[]>(join(seedsRoot, "provenance-overrides.json"));

  return buildTrustedSeeds({
    vendorJson,
    creatorJson,
    officialJson,
    manualIncludeJson,
    overridesJson,
    catalogJson,
    provenanceJson,
  });
}

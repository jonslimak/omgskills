import type { RepoBootstrapCandidate, ShadowRepoIndexEntry, TrustedSeeds } from "./types.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import { isDoNotCrawlRepo } from "./do-not-crawl.js";

export const LIBRARY_ADMISSION_MIN_STARS = 500;

export type AdmissionDiscoveredRepo = {
  repo: string;
  repoUrl: string;
  sources: Set<string>;
  stars: number;
  bootstrapCandidate?: RepoBootstrapCandidate;
};

type AdmissionTrustSignals = {
  isTrustedVendor: boolean;
  isTrustedCreator: boolean;
  isGoldBasketRepo: boolean;
};

export function passesLibraryAdmissionValueGate(
  repo: string,
  stars: number,
  seeds: TrustedSeeds,
  trust: Pick<AdmissionTrustSignals, "isTrustedVendor" | "isGoldBasketRepo">,
  sources: Set<string>,
): boolean {
  if (isDoNotCrawlRepo(repo, seeds)) return false;
  const knownCatalogRepo = isKnownCatalogRepo(repo, seeds.catalogRepoRules);
  const passesStars = stars >= LIBRARY_ADMISSION_MIN_STARS && !knownCatalogRepo;
  const passesCreatorWatch = sources.has("creator-watch") && !knownCatalogRepo;
  return (
    seeds.manualIncludeRepos.has(repo) ||
    seeds.officialTier1Repos.has(repo) ||
    seeds.officialTier2Repos.has(repo) ||
    sources.has("official") ||
    trust.isTrustedVendor ||
    trust.isGoldBasketRepo ||
    passesCreatorWatch ||
    passesStars
  );
}

export function passesLibraryAdmissionCleanMappingGate(discoveredRepo: AdmissionDiscoveredRepo): boolean {
  return Boolean(discoveredRepo.bootstrapCandidate);
}

export function isDiscoveredRepoAdmissionEligible(
  discoveredRepo: AdmissionDiscoveredRepo,
  seeds: TrustedSeeds,
  trust: Pick<AdmissionTrustSignals, "isTrustedVendor" | "isGoldBasketRepo">,
): boolean {
  return (
    passesLibraryAdmissionCleanMappingGate(discoveredRepo) &&
    passesLibraryAdmissionValueGate(discoveredRepo.repo, discoveredRepo.stars, seeds, trust, discoveredRepo.sources)
  );
}

export function createAdmittedLibraryRepoEntry(
  discoveredRepo: AdmissionDiscoveredRepo,
  checkedAt: string,
  trust: AdmissionTrustSignals,
): ShadowRepoIndexEntry {
  return {
    repo: discoveredRepo.repo,
    repoUrl: discoveredRepo.repoUrl,
    state: "library",
    discoveredSources: [...new Set(discoveredRepo.sources)].sort(),
    skillIds: [],
    skillCount: 0,
    stars: discoveredRepo.stars,
    lastSeenAt: checkedAt,
    lastRefreshedAt: checkedAt,
    lastCheapCheckedAt: null,
    lastObservedRepoUpdatedAt: null,
    trustSignals: [
      trust.isTrustedVendor ? "trusted-vendor" : "",
      trust.isTrustedCreator ? "trusted-creator" : "",
      trust.isGoldBasketRepo ? "gold-basket" : "",
    ].filter(Boolean),
    promotionReasons: ["new-discovery", "library-admission"],
    staleOrInvalidState: null,
    isTrustedVendor: trust.isTrustedVendor,
    isTrustedCreator: trust.isTrustedCreator,
    isGoldBasketRepo: trust.isGoldBasketRepo,
    topSkillId: null,
    topSkillStars: 0,
  };
}

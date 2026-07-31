import type { PolicyReasonCode } from "../policy/types.js";
import { sortBootstrapCandidates } from "./bootstrap.js";
import type { RepoBootstrapCandidate, ShadowRepoIndexEntry, TrustedSeeds } from "./types.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import { isDoNotCrawlRepo } from "./do-not-crawl.js";
import { isSuppressedSkillId } from "./suppressed-skills.js";

export const LIBRARY_ADMISSION_MIN_STARS = 500;
export const X_SOCIAL_ADMISSION_MIN_STARS = 50;
export const INSTALL_ADMISSION_MAX_ALL_TIME_RANK = 1000;
export const INSTALL_ADMISSION_MIN_INSTALLS = 4000;

export type AdmissionDiscoveredRepo = {
  repo: string;
  repoUrl: string;
  sources: Set<string>;
  stars: number;
  bootstrapCandidate?: RepoBootstrapCandidate;
  bootstrapCandidates?: RepoBootstrapCandidate[];
};

export type AdmissionTrustSignals = {
  isTrustedVendor: boolean;
  isTrustedCreator: boolean;
  isGoldBasketRepo: boolean;
};

type AdmissionOptions = {
  installAdmissionEnabled?: boolean;
  policyPrecedenceMode?: PolicyPrecedenceMode;
};

export type PolicyPrecedenceMode = "observe" | "admission" | "enforce";

export type AdmissionDecision = {
  eligible: boolean;
  reasonCode: PolicyReasonCode;
  matchedSource: string;
  candidate: RepoBootstrapCandidate | null;
};

export type AdmissionEvaluation = {
  legacy: AdmissionDecision;
  proposed: AdmissionDecision;
  effective: AdmissionDecision;
  skippedSuppressedCandidateIds: string[];
};

export function parsePolicyPrecedenceMode(value = process.env.CRAWL4_POLICY_PRECEDENCE): PolicyPrecedenceMode {
  const normalized = value?.trim().toLowerCase() || "observe";
  if (normalized === "observe" || normalized === "admission" || normalized === "enforce") return normalized;
  throw new Error(`Invalid CRAWL4_POLICY_PRECEDENCE: ${value}. Expected observe, admission, or enforce.`);
}

export function passesInstallAdmissionArm(
  discoveredRepo: AdmissionDiscoveredRepo,
  options: AdmissionOptions = {},
): boolean {
  if (!options.installAdmissionEnabled) return false;
  const candidate = discoveredRepo.bootstrapCandidate;
  if (!candidate || candidate.source !== "skillssh") return false;
  if (!discoveredRepo.sources.has("skillssh")) return false;

  const passesRank =
    candidate.skillsshBoard === "all-time" &&
    typeof candidate.skillsshRank === "number" &&
    candidate.skillsshRank <= INSTALL_ADMISSION_MAX_ALL_TIME_RANK;
  const passesInstalls =
    typeof candidate.skillsshInstalls === "number" &&
    candidate.skillsshInstalls >= INSTALL_ADMISSION_MIN_INSTALLS;

  return passesRank || passesInstalls;
}

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
  const passesXSocial = sources.has("x-social") && stars >= X_SOCIAL_ADMISSION_MIN_STARS && !knownCatalogRepo;
  return (
    seeds.manualIncludeRepos.has(repo) ||
    seeds.officialTier1Repos.has(repo) ||
    seeds.officialTier2Repos.has(repo) ||
    sources.has("official") ||
    trust.isTrustedVendor ||
    trust.isGoldBasketRepo ||
    passesCreatorWatch ||
    passesXSocial ||
    passesStars
  );
}

export function passesLibraryAdmissionCleanMappingGate(discoveredRepo: AdmissionDiscoveredRepo): boolean {
  return Boolean(discoveredRepo.bootstrapCandidate);
}

function acceptedDecision(
  reasonCode: PolicyReasonCode,
  matchedSource: string,
  candidate: RepoBootstrapCandidate,
): AdmissionDecision {
  return { eligible: true, reasonCode, matchedSource, candidate };
}

function rejectedDecision(
  reasonCode: PolicyReasonCode,
  matchedSource: string,
  candidate: RepoBootstrapCandidate | null,
): AdmissionDecision {
  return { eligible: false, reasonCode, matchedSource, candidate };
}

function valueDecision(
  discoveredRepo: AdmissionDiscoveredRepo,
  seeds: TrustedSeeds,
  trust: AdmissionTrustSignals,
  candidate: RepoBootstrapCandidate,
  options: AdmissionOptions,
): AdmissionDecision {
  const repo = discoveredRepo.repo;
  if (seeds.manualIncludeRepos.has(repo)) return acceptedDecision("manual-include", "manualIncludeRepos", candidate);
  if (seeds.officialTier1Repos.has(repo) || seeds.officialTier2Repos.has(repo) || discoveredRepo.sources.has("official")) {
    return acceptedDecision("official", "officialRepos", candidate);
  }
  if (trust.isTrustedVendor) return acceptedDecision("trusted-vendor", "creators", candidate);
  if (trust.isTrustedCreator) return acceptedDecision("trusted-creator", "creators", candidate);
  if (trust.isGoldBasketRepo) return acceptedDecision("gold-basket", "goldBasket", candidate);
  if (discoveredRepo.sources.has("creator-watch")) return acceptedDecision("creator-watch", "creators", candidate);
  if (discoveredRepo.sources.has("x-social") && discoveredRepo.stars >= X_SOCIAL_ADMISSION_MIN_STARS) {
    return acceptedDecision("x-social", "xSocial", candidate);
  }
  if (discoveredRepo.stars >= LIBRARY_ADMISSION_MIN_STARS) return acceptedDecision("stars", "githubStars", candidate);
  if (passesInstallAdmissionArm({ ...discoveredRepo, bootstrapCandidate: candidate }, options)) {
    return acceptedDecision("install-signal", "skillsSh", candidate);
  }
  return rejectedDecision("below-value-threshold", "admissionThresholds", candidate);
}

function legacyAdmissionDecision(
  discoveredRepo: AdmissionDiscoveredRepo,
  seeds: TrustedSeeds,
  trust: AdmissionTrustSignals,
  options: AdmissionOptions,
): AdmissionDecision {
  const candidate = discoveredRepo.bootstrapCandidate ?? null;
  if (!candidate) return rejectedDecision("invalid-mapping", "bootstrapCandidate", null);
  if (isDoNotCrawlRepo(discoveredRepo.repo, seeds)) return rejectedDecision("do-not-crawl", "doNotCrawl", candidate);
  if (passesLibraryAdmissionValueGate(discoveredRepo.repo, discoveredRepo.stars, seeds, trust, discoveredRepo.sources)) {
    return valueDecision(discoveredRepo, seeds, trust, candidate, options);
  }
  if (isKnownCatalogRepo(discoveredRepo.repo, seeds.catalogRepoRules)) {
    return rejectedDecision("catalog-repo", "catalogRepos", candidate);
  }
  if (passesInstallAdmissionArm(discoveredRepo, options)) {
    return acceptedDecision("install-signal", "skillsSh", candidate);
  }
  return rejectedDecision("below-value-threshold", "admissionThresholds", candidate);
}

function candidatePool(discoveredRepo: AdmissionDiscoveredRepo): RepoBootstrapCandidate[] {
  return sortBootstrapCandidates([
    ...(discoveredRepo.bootstrapCandidates ?? []),
    ...(discoveredRepo.bootstrapCandidate ? [discoveredRepo.bootstrapCandidate] : []),
  ]);
}

function unsafeProvenanceSource(
  repo: string,
  candidate: RepoBootstrapCandidate,
  seeds: TrustedSeeds,
): string | null {
  const normalizedId = candidate.id.toLowerCase();
  const override = seeds.provenanceOverrides.find((entry) =>
    entry.id?.toLowerCase() === normalizedId || entry.repo === repo
  );
  return override?.provenanceType && override.provenanceType !== "original"
    ? "provenanceOverrides"
    : null;
}

export function bootstrapCandidatePolicyRejectionReason(
  repo: string,
  candidate: RepoBootstrapCandidate,
  seeds: TrustedSeeds,
): PolicyReasonCode | null {
  if (isDoNotCrawlRepo(repo, seeds)) return "do-not-crawl";
  if (seeds.repoOverrides.some((entry) => entry.repo === repo && entry.exclude === true)) {
    return "repo-override-exclude";
  }
  if (isKnownCatalogRepo(repo, seeds.catalogRepoRules)) return "catalog-repo";
  if (isSuppressedSkillId(candidate.id, seeds)) return "suppressed-skill";
  if (unsafeProvenanceSource(repo, candidate, seeds)) return "non-original-provenance";
  return null;
}

function proposedAdmissionDecision(
  discoveredRepo: AdmissionDiscoveredRepo,
  seeds: TrustedSeeds,
  trust: AdmissionTrustSignals,
  options: AdmissionOptions,
): { decision: AdmissionDecision; skippedSuppressedCandidateIds: string[] } {
  const candidates = candidatePool(discoveredRepo);
  const skippedSuppressedCandidateIds = candidates
    .filter((candidate) => isSuppressedSkillId(candidate.id, seeds))
    .map((candidate) => candidate.id);
  const candidate = candidates.find((row) => !isSuppressedSkillId(row.id, seeds)) ?? null;
  if (!candidate) {
    const reason = candidates.length > 0 ? "suppressed-skill" : "invalid-mapping";
    const source = candidates.length > 0 ? "suppressedSkills" : "bootstrapCandidate";
    return { decision: rejectedDecision(reason, source, null), skippedSuppressedCandidateIds };
  }
  if (isDoNotCrawlRepo(discoveredRepo.repo, seeds)) {
    return { decision: rejectedDecision("do-not-crawl", "doNotCrawl", candidate), skippedSuppressedCandidateIds };
  }
  if (seeds.repoOverrides.some((entry) => entry.repo === discoveredRepo.repo && entry.exclude === true)) {
    return { decision: rejectedDecision("repo-override-exclude", "repoOverrides", candidate), skippedSuppressedCandidateIds };
  }
  if (isKnownCatalogRepo(discoveredRepo.repo, seeds.catalogRepoRules)) {
    return { decision: rejectedDecision("catalog-repo", "catalogRepos", candidate), skippedSuppressedCandidateIds };
  }
  const provenanceSource = unsafeProvenanceSource(discoveredRepo.repo, candidate, seeds);
  if (provenanceSource) {
    return {
      decision: rejectedDecision("non-original-provenance", provenanceSource, candidate),
      skippedSuppressedCandidateIds,
    };
  }
  return {
    decision: valueDecision({ ...discoveredRepo, bootstrapCandidate: candidate }, seeds, trust, candidate, options),
    skippedSuppressedCandidateIds,
  };
}

export function evaluateDiscoveredRepoAdmission(
  discoveredRepo: AdmissionDiscoveredRepo,
  seeds: TrustedSeeds,
  trust: AdmissionTrustSignals,
  options: AdmissionOptions = {},
): AdmissionEvaluation {
  const legacy = legacyAdmissionDecision(discoveredRepo, seeds, trust, options);
  const proposed = proposedAdmissionDecision(discoveredRepo, seeds, trust, options);
  const mode = options.policyPrecedenceMode ?? "observe";
  return {
    legacy,
    proposed: proposed.decision,
    effective: mode === "observe" ? legacy : proposed.decision,
    skippedSuppressedCandidateIds: proposed.skippedSuppressedCandidateIds,
  };
}

export function isDiscoveredRepoAdmissionEligible(
  discoveredRepo: AdmissionDiscoveredRepo,
  seeds: TrustedSeeds,
  trust: Pick<AdmissionTrustSignals, "isTrustedVendor" | "isGoldBasketRepo">,
  options: AdmissionOptions = {},
): boolean {
  return evaluateDiscoveredRepoAdmission(
    discoveredRepo,
    seeds,
    { ...trust, isTrustedCreator: false },
    options,
  ).effective.eligible;
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

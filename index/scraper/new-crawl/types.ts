export type RepoState = "library" | "rising" | "core";
export type DiscoveryLane = "fast" | "periodic" | "background";
export type ShadowCadence = DiscoveryLane | "combined";

export type RepoOverride = {
  repo: string;
  state?: RepoState;
  exclude?: boolean;
  notes?: string;
};

export type AuthorConfidence = "high" | "low";

export type ProvenanceType = "original" | "catalog" | "repackaged" | "mirrored" | "unknown";

export type CatalogRepoRule = {
  repo: string;
  publisherHandle?: string;
  defaultProvenanceType?: ProvenanceType;
  notes?: string;
};

export type ProvenanceOverride = {
  id?: string;
  repo?: string;
  authorHandle?: string;
  publisherHandle?: string;
  upstreamRepo?: string;
  provenanceType?: ProvenanceType;
  authorConfidence?: AuthorConfidence;
  notes?: string;
};

export type TrustedSeeds = {
  trustedVendorHandles: Set<string>;
  trustedCreatorHandles: Set<string>;
  repoOverrides: RepoOverride[];
  catalogRepoRules: CatalogRepoRule[];
  provenanceOverrides: ProvenanceOverride[];
};

export type ShadowSkillProvenance = {
  authorHandle: string;
  publisherHandle: string;
  publisherRepo: string;
  upstreamRepo: string | null;
  provenanceType: ProvenanceType;
  authorConfidence: AuthorConfidence;
};

export type ShadowSkillRecord = Omit<import("../types.js").Skill, "author_handle"> & {
  author_handle: string;
  publisher_handle: string;
  publisher_repo: string;
  upstream_repo: string | null;
  provenance_type: ProvenanceType;
  author_confidence: AuthorConfidence;
};

export type ShadowRepoIndexEntry = {
  repo: string;
  repoUrl: string;
  state: RepoState;
  discoveredSources: string[];
  skillIds: string[];
  skillCount: number;
  stars: number;
  lastSeenAt: string;
  lastRefreshedAt: string;
  trustSignals: string[];
  promotionReasons: string[];
  staleOrInvalidState: null;
  isTrustedVendor: boolean;
  isTrustedCreator: boolean;
  isGoldBasketRepo: boolean;
  topSkillId: string | null;
  topSkillStars: number;
};

export type ShadowRepoIndex = {
  generatedAt: string;
  repoCount: number;
  repos: ShadowRepoIndexEntry[];
};

export type ShadowSkillSignals = {
  generatedAt: string;
  signals: Record<string, never>;
};

export type ShadowEnrichmentCounts = {
  libraryReposChecked: number;
  coreReposDeepRefreshed: number;
  risingReposDeepRefreshed: number;
  skillsDeepRefreshed: number;
  carriedForwardCount: number;
  correctedCount: number;
  staleInvalidCandidateCount: number;
};

export type ShadowStaleInvalidCandidate = {
  id: string;
  repo: string;
  reason: "repoMissing" | "skillFileMissing" | "validationFailed";
};

export type StageTimings = Record<string, number>;
export type SourceRunSummary = {
  source: string;
  lane: DiscoveryLane;
  hitCount: number;
  durationMs: number;
};

export type DiscoveryBudgetSummary = {
  topics: {
    maxQueries: number;
    maxPagesPerQuery: number;
  };
  code: {
    includeBroadQuery: boolean;
    maxFingerprintQueries: number;
    maxPagesPerQuery: number;
  };
  social: {
    maxPagesPerQuery: number;
  };
  aggregators: {
    maxRepos: number;
  };
};

export type TopRepoSummary = {
  repo: string;
  stars: number;
  topSkillId: string | null;
};

export type ShadowAuthorDiffExample = {
  id: string;
  currentAuthorHandle: string;
  shadowAuthorHandle: string;
  publisherHandle: string;
  publisherRepo: string;
  upstreamRepo: string | null;
  provenanceType: ProvenanceType;
  authorConfidence: AuthorConfidence;
};

export type ShadowRunReport = {
  checkedAt: string;
  status: "ok";
  cadence: ShadowCadence;
  baselineSkillCount: number;
  shadowSkillCount: number;
  carriedForwardCount: number;
  correctedCount: number;
  newlyDiscoveredCount: number;
  staleInvalidCandidateCount: number;
  repoCount: number;
  repoCountsByState: Record<RepoState, number>;
  trustedVendorRepoCount: number;
  trustedCreatorRepoCount: number;
  goldBasketRepoCount: number;
  unresolvedBaselineSkillCount: number;
  authorPublisherMismatchCount: number;
  provenanceCounts: Record<ProvenanceType, number>;
  unknownAuthorSkillCount: number;
  catalogRepoSkillCount: number;
  authorDiffExamples: ShadowAuthorDiffExample[];
  catalogRepoExamples: ShadowAuthorDiffExample[];
  topCoreRepos: TopRepoSummary[];
  topRisingRepos: TopRepoSummary[];
  sourceRuns: SourceRunSummary[];
  discoveryBudgetApplied: boolean;
  discoveryBudgetSummary: DiscoveryBudgetSummary | null;
  partialDiscoveryWarnings: string[];
  enrichmentCounts: ShadowEnrichmentCounts;
  lowStarValidSkillCount: number;
  lowStarValidSkillSample: string[];
  trustedLowStarSkillCount: number;
  officialLowStarSkillCount: number;
  staleInvalidCandidatesSample: ShadowStaleInvalidCandidate[];
  enrichmentWarnings: string[];
  discoveredRepoCount: number;
  discoveredRepoCountByLane: Record<DiscoveryLane, number>;
  discoveredRepoCountBySource: Record<string, number>;
  baselineRepoCountMatchedByDiscovery: number;
  newDiscoveryRepoCount: number;
  newDiscoveryReposSample: string[];
  periodicOnlyReposSample: string[];
  backgroundOnlyReposSample: string[];
  bootstrapValueRepoCount: number;
  bootstrapValueReposSample: string[];
  fastOnlyRepoCount: number;
  fastOnlyReposSample: string[];
  stageTimings: StageTimings;
  productionWriteGuardPassed: true;
};

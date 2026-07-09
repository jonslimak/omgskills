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

export type DoNotCrawlReason = "catalog" | "spam" | "unsafe" | "duplicate" | "low-quality" | "other";

export type DoNotCrawlRule = {
  repo?: string;
  owner?: string;
  reason: DoNotCrawlReason;
  notes?: string;
};

export type SuppressedSkillRule = {
  id: string;
  reason: string;
  replacementId?: string;
  confidence?: "high" | "medium" | "low";
  stagedAt?: string;
  notes?: string;
};

export type CreatorRegistryRole = "vendor" | "creator";

export type CreatorRegistryEntry = {
  handle: string;
  roles?: CreatorRegistryRole[];
  watch?: boolean;
  featured?: boolean;
  aliases?: string[];
  notes?: string;
};

export type TrustedSeeds = {
  trustedVendorHandles: Set<string>;
  trustedCreatorHandles: Set<string>;
  watchedCreatorHandles?: Set<string>;
  featuredCreatorHandles?: Set<string>;
  creatorAliasToCanonicalHandle?: Map<string, string>;
  officialTier1Repos: Set<string>;
  officialTier2Repos: Set<string>;
  manualIncludeRepos: Set<string>;
  doNotCrawlRepos?: Set<string>;
  doNotCrawlOwners?: Set<string>;
  doNotCrawlRules?: DoNotCrawlRule[];
  suppressedSkillIds?: Set<string>;
  suppressedSkillRules?: SuppressedSkillRule[];
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
  lastCheapCheckedAt?: string | null;
  lastObservedRepoUpdatedAt?: string | null;
  trustSignals: string[];
  promotionReasons: string[];
  staleOrInvalidState: {
    reason: "repoMissing" | "skillFileMissing";
    observedRepoUpdatedAt: string;
  } | null;
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

export type ShadowRepoOverlay = {
  generatedAt: string;
  repoCount: number;
  repos: ShadowRepoIndexEntry[];
};

export type ShadowSkillOverlay = {
  generatedAt: string;
  skillCount: number;
  skills: ShadowSkillRecord[];
};

export type ShadowSkillSignals = {
  generatedAt: string;
  signals: Record<string, never>;
};

export type ShadowCutoverSkillSignal = {
  id: string;
  isRising?: boolean;
  isCore?: boolean;
};

export type ShadowStaleReasonCounts = {
  repoMissing: number;
  skillFileMissing: number;
  validationFailed: number;
};

export type CutoverValidationFailureKind =
  | "repoSkillIdMissing"
  | "duplicateCutoverSkillId"
  | "cutoverSignalMissingSkill"
  | "originalAuthorHandleMismatch";

export type CutoverValidationFailure = {
  kind: CutoverValidationFailureKind;
  repo?: string;
  id?: string;
  details?: string;
};

export type ShadowEnrichmentCounts = {
  cheapReposChecked: number;
  dailyPriorityRepoCount: number;
  skillsDeepRefreshed: number;
  monitoredDeepRefreshed: number;
  cheapTriggeredRefreshCandidateCount: number;
  cheapTriggeredRefreshDeferredCount: number;
  cheapTriggeredDeepRefreshed: number;
  carriedForwardCount: number;
  correctedCount: number;
  staleInvalidCandidateCount: number;
};

export type PriorityReason = "official" | "trustedVendor" | "goldBasket" | "creatorWatch" | "momentum" | "stars";

export type PriorityReasonCounts = Record<PriorityReason, number>;

export type DailyPriorityRepoSample = {
  repo: string;
  reason: PriorityReason;
};

export type NextPromotionCandidateReason = "trustedVendor" | "goldBasket" | "momentum" | "periodic" | "background";

export type BootstrapSource = "official" | "skillssh" | "awesome" | "registry" | "code" | "creator-watch" | "x-social";

export type RepoBootstrapCandidate = {
  source: BootstrapSource;
  id: string;
  skill_md_path: string;
  skill_name_hint?: string;
  ref?: string;
  github_url: string;
  stars?: number;
  last_updated?: string;
  tags?: string[];
  skillsshBoard?: "all-time" | "trending" | "hot";
  skillsshRank?: number;
  skillsshInstalls?: number;
};

export type NextPromotionCandidateSample = {
  repo: string;
  stars: number;
  reason: NextPromotionCandidateReason;
};

export type PromotedRepoSample = {
  repo: string;
  priorState: RepoState;
  newState: RepoState;
  reason: NextPromotionCandidateReason;
  stars: number;
  promotionKind: "existing-library" | "new-discovery";
};

export type BootstrapRepoSample = {
  repo: string;
  source: BootstrapSource;
  candidateId: string;
  outcome: "bootstrapped" | "failed" | "skipped";
  failureReason?: string;
};

export type CatalogAdmissionSample = {
  id: string;
  repo: string;
  provenanceType: Extract<ProvenanceType, "catalog" | "repackaged">;
  stars: number;
  authorHandle: string;
};

export type InstallArmAdmissionSample = {
  repo: string;
  board?: "all-time" | "trending" | "hot";
  rank?: number;
  installs?: number;
};

export type RebootstrapEligibleRepoSample = {
  repo: string;
  missingSkillIds: string[];
};

export type ShadowStaleInvalidCandidate = {
  id: string;
  repo: string;
  reason: "repoMissing" | "skillFileMissing" | "validationFailed";
};

export type SkillFileMissingSample = {
  repo: string;
  failedSkillId: string;
  skillCount: number;
  topSkillId: string | null;
  lastObservedRepoUpdatedAt: string | null;
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
  highStarSkillMd: {
    minStars: number;
    maxSampledRepos: number;
    maxPagesPerQuery: number;
    requestDelayMs: number;
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

export type ShadowCutoverAuthorDiffSample = {
  id: string;
  baselineAuthorHandle: string;
  cutoverAuthorHandle: string;
};

export type ShadowCutoverCompare = {
  checkedAt: string;
  counts: {
    baselineSkillCount: number;
    cutoverSkillCount: number;
    countDelta: number;
    addedSkillCount: number;
    missingSkillCount: number;
  };
  addedSkillIdsSample: string[];
  missingSkillIdsSample: string[];
  authorDiffSample: ShadowCutoverAuthorDiffSample[];
  unresolvedAttributionSummary: {
    baselineUnknownAuthorSkillCount: number;
    cutoverUnknownAuthorSkillCount: number;
    cutoverUnresolvedCatalogSkillCount: number;
  };
  signalSummary: {
    cutoverSignalCount: number;
    cutoverRisingSignalCount: number;
    cutoverCoreSignalCount: number;
  };
  validationSummary: {
    cutoverValidationPassed: boolean;
    cutoverValidationFailureCount: number;
  };
};

export type Crawl4Preview = {
  tierCounts: {
    tier1: number;
    tier2: number;
    longtail: number;
  };
  missingTier1Repos: string[];
  missingTier2Repos: string[];
  unresolvedCatalogRepos: string[];
  momentumCounts: {
    skillssh: number;
    validatedX: number;
    both: number;
  };
  momentumRepoSample: string[];
  currentDailyPriorityRepos: string[];
  proposedDailyPriorityRepos: string[];
  proposedDailyPriorityScoreSample: Array<{
    repo: string;
    score: number;
    reasons: string[];
  }>;
  dailyPriorityAdded: string[];
  dailyPriorityRemoved: string[];
  currentShortlistRepos: string[];
  proposedShortlistRepos: string[];
  shortlistAdded: string[];
  shortlistRemoved: string[];
};

export type ShadowRunReport = {
  checkedAt: string;
  status: "ok";
  cadence: ShadowCadence;
  baselineSkillCount: number;
  shadowSkillCount: number;
  inspectableShadowSkillCount: number;
  excludedInspectableCatalogSkillCount: number;
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
  unresolvedCatalogSkillCount: number;
  unresolvedCatalogPublishers: {
    publisherRepo: string;
    count: number;
  }[];
  authorDiffExamples: ShadowAuthorDiffExample[];
  catalogRepoExamples: ShadowAuthorDiffExample[];
  topCoreRepos: TopRepoSummary[];
  topRisingRepos: TopRepoSummary[];
  sourceRuns: SourceRunSummary[];
  discoveryBudgetApplied: boolean;
  discoveryBudgetSummary: DiscoveryBudgetSummary | null;
  partialDiscoveryWarnings: string[];
  highStarPathQualitySkippedCount: number;
  highStarPathQualitySkippedSample: {
    repo: string;
    path: string;
    stars: number | null;
  }[];
  creatorWatchCheckedOwnerCount?: number;
  creatorWatchDiscoveredRepoCount?: number;
  creatorWatchNewRepoSample?: string[];
  creatorWatchAdmissionCount?: number;
  creatorWatchAdmissionSample?: string[];
  installArmAdmissionCount?: number;
  installArmAdmissionSample?: InstallArmAdmissionSample[];
  xDiscoveryCandidateCount?: number;
  xDiscoveryCandidateSample?: string[];
  enrichmentCounts: ShadowEnrichmentCounts;
  lowStarValidSkillCount: number;
  lowStarValidSkillSample: string[];
  trustedLowStarSkillCount: number;
  officialLowStarSkillCount: number;
  staleInvalidCandidatesSample: ShadowStaleInvalidCandidate[];
  skillFileMissingSample: SkillFileMissingSample[];
  staleReasonCounts: ShadowStaleReasonCounts;
  priorityReasonCounts: PriorityReasonCounts;
  dailyPriorityRepoSample: DailyPriorityRepoSample[];
  dailyPriorityStarsFillSample: DailyPriorityRepoSample[];
  skippedMonitoredRepoCount: number;
  nextPromotionCandidateCount: number;
  nextPromotionCandidatesSample: NextPromotionCandidateSample[];
  nextPromotionShortlistCount: number;
  nextPromotionShortlistSample: NextPromotionCandidateSample[];
  promotedRepoCount: number;
  promotedToRisingCount: number;
  newDiscoveredRepoPromotedCount: number;
  promotedRepoSample: PromotedRepoSample[];
  bootstrappedRepoCount: number;
  bootstrappedRepoSample: BootstrapRepoSample[];
  catalogAdmissionCount: number;
  catalogAdmissionSample: CatalogAdmissionSample[];
  bootstrapFailedRepoCount: number;
  bootstrapFailedRepoSample: BootstrapRepoSample[];
  bootstrapSkippedRepoCount: number;
  bootstrapSkippedRepoSample: BootstrapRepoSample[];
  rebootstrapEligibleRepoCount: number;
  rebootstrapEligibleRepoSample: RebootstrapEligibleRepoSample[];
  shadowRepoOverlayLoaded: boolean;
  shadowRepoOverlayEntryCount: number;
  shadowRepoOverlayWrittenCount: number;
  shadowSkillOverlayLoaded: boolean;
  shadowSkillOverlayEntryCount: number;
  shadowSkillOverlayWrittenCount: number;
  shaCanonicalClusterCount?: number;
  shaCanonicalCandidateCount?: number;
  shaCanonicalHighConfidenceCount?: number;
  shaCanonicalMediumCandidateCount?: number;
  shaCanonicalUnresolvedCount?: number;
  shaCanonicalCandidateCountByReason?: Record<
    "same-repo" | "trusted-creator" | "clear-star-leader",
    number
  >;
  shaCanonicalSample?: Array<{
    skillMdSha: string;
    memberCount: number;
    canonicalSkillId: string | null;
    reason: "same-repo" | "trusted-creator" | "clear-star-leader" | "ambiguous";
  }>;
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
  crawl4Preview: Crawl4Preview;
  cutoverValidationPassed: boolean;
  cutoverValidationFailureCount: number;
  cutoverValidationFailuresSample: CutoverValidationFailure[];
  stageTimings: StageTimings;
  productionWriteGuardPassed: true;
};

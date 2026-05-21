export type RepoState = "library" | "rising" | "core";

export type RepoOverride = {
  repo: string;
  state?: RepoState;
  exclude?: boolean;
  notes?: string;
};

export type TrustedSeeds = {
  trustedVendorHandles: Set<string>;
  trustedCreatorHandles: Set<string>;
  repoOverrides: RepoOverride[];
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

export type StageTimings = Record<string, number>;

export type TopRepoSummary = {
  repo: string;
  stars: number;
  topSkillId: string | null;
};

export type ShadowRunReport = {
  checkedAt: string;
  status: "ok";
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
  topCoreRepos: TopRepoSummary[];
  topRisingRepos: TopRepoSummary[];
  stageTimings: StageTimings;
  productionWriteGuardPassed: true;
};

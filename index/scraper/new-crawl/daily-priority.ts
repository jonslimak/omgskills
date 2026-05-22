import type {
  DiscoveryLane,
  NextPromotionCandidateReason,
  PriorityReason,
  ShadowRepoIndex,
  ShadowRepoIndexEntry,
} from "./types.js";

export const DAILY_PRIORITY_REPO_LIMIT = 40;
export const DAILY_PRIORITY_BUCKET_CAPS: Array<{ reason: Exclude<PriorityReason, "stars">; cap: number }> = [
  { reason: "official", cap: 12 },
  { reason: "goldBasket", cap: 10 },
  { reason: "trustedVendor", cap: 8 },
];
export const NEXT_PROMOTION_SHORTLIST_LIMIT = 20;
export const NEXT_PROMOTION_SHORTLIST_BUCKET_CAPS: Array<{ reason: NextPromotionCandidateReason; cap: number }> = [
  { reason: "trustedVendor", cap: 5 },
  { reason: "goldBasket", cap: 3 },
  { reason: "periodic", cap: 8 },
  { reason: "background", cap: 4 },
];

export type DailyPriorityDiscoveredRepo = {
  repo: string;
  sources: Set<string>;
  lanes: Set<DiscoveryLane>;
};

export type DailyPrioritySelection = {
  repos: ShadowRepoIndexEntry[];
  reasonByRepo: Map<string, PriorityReason>;
  skippedMonitoredRepoCount: number;
};

export type NextPromotionCandidate = {
  repo: string;
  stars: number;
  reason: NextPromotionCandidateReason;
};

export function buildDailyPriorityRepos(
  repoIndex: ShadowRepoIndex,
  discovered: Map<string, DailyPriorityDiscoveredRepo>,
): DailyPrioritySelection {
  const monitoredRepos = repoIndex.repos.filter((repo) => repo.state === "core" || repo.state === "rising");
  const monitoredByName = new Map(monitoredRepos.map((repo) => [repo.repo, repo]));
  const reasonByRepo = new Map<string, PriorityReason>();
  const selected: ShadowRepoIndexEntry[] = [];
  const selectedNames = new Set<string>();

  const pushRepos = (repos: ShadowRepoIndexEntry[], reason: PriorityReason) => {
    for (const repo of repos) {
      if (selected.length >= DAILY_PRIORITY_REPO_LIMIT) break;
      if (selectedNames.has(repo.repo)) continue;
      selected.push(repo);
      selectedNames.add(repo.repo);
      reasonByRepo.set(repo.repo, reason);
    }
  };

  const officialRepos = [...discovered.values()]
    .filter((repo) => repo.sources.has("official"))
    .map((repo) => monitoredByName.get(repo.repo))
    .filter((repo): repo is ShadowRepoIndexEntry => Boolean(repo))
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));

  const goldBasketRepos = monitoredRepos
    .filter((repo) => repo.isGoldBasketRepo)
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));

  const trustedVendorRepos = monitoredRepos
    .filter((repo) => repo.isTrustedVendor)
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));

  for (const bucket of DAILY_PRIORITY_BUCKET_CAPS) {
    const reposByReason: Record<Exclude<PriorityReason, "stars">, ShadowRepoIndexEntry[]> = {
      official: officialRepos,
      goldBasket: goldBasketRepos,
      trustedVendor: trustedVendorRepos,
    };
    pushRepos(reposByReason[bucket.reason].slice(0, bucket.cap), bucket.reason);
  }

  const remainingMonitoredRepos = monitoredRepos
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
  pushRepos(remainingMonitoredRepos, "stars");

  return {
    repos: selected,
    reasonByRepo,
    skippedMonitoredRepoCount: Math.max(monitoredRepos.length - selected.length, 0),
  };
}

function nextPromotionReason(
  repo: ShadowRepoIndexEntry | null,
  discoveredRepo: DailyPriorityDiscoveredRepo,
): NextPromotionCandidateReason {
  if (repo?.isTrustedVendor) return "trustedVendor";
  if (repo?.isGoldBasketRepo) return "goldBasket";
  if (discoveredRepo.lanes.has("periodic")) return "periodic";
  return "background";
}

function nextPromotionRank(reason: NextPromotionCandidateReason): number {
  switch (reason) {
    case "trustedVendor":
      return 0;
    case "goldBasket":
      return 1;
    case "periodic":
      return 2;
    case "background":
      return 3;
  }
}

export function buildNextPromotionCandidates(
  repoIndex: ShadowRepoIndex,
  discovered: Map<string, DailyPriorityDiscoveredRepo>,
  dailyPriorityRepos: ShadowRepoIndexEntry[],
): NextPromotionCandidate[] {
  const dailyPrioritySet = new Set(dailyPriorityRepos.map((repo) => repo.repo));
  const repoByName = new Map(repoIndex.repos.map((repo) => [repo.repo, repo]));

  return [...discovered.values()]
    .filter((repo) => !dailyPrioritySet.has(repo.repo))
    .filter((repo) => repo.lanes.has("periodic") || repo.lanes.has("background"))
    .map((discoveredRepo) => {
      const repo = repoByName.get(discoveredRepo.repo) ?? null;
      return {
        repo: discoveredRepo.repo,
        stars: repo?.stars ?? 0,
        reason: nextPromotionReason(repo, discoveredRepo),
      };
    })
    .sort((a, b) => {
      const reasonDelta = nextPromotionRank(a.reason) - nextPromotionRank(b.reason);
      if (reasonDelta !== 0) return reasonDelta;
      return b.stars - a.stars || a.repo.localeCompare(b.repo);
    });
}

export function buildNextPromotionShortlist(candidates: NextPromotionCandidate[]): NextPromotionCandidate[] {
  const shortlist: NextPromotionCandidate[] = [];
  const byReason = new Map<NextPromotionCandidateReason, NextPromotionCandidate[]>();

  for (const candidate of candidates) {
    const existing = byReason.get(candidate.reason) ?? [];
    existing.push(candidate);
    byReason.set(candidate.reason, existing);
  }

  for (const bucket of NEXT_PROMOTION_SHORTLIST_BUCKET_CAPS) {
    const rows = byReason.get(bucket.reason) ?? [];
    for (const candidate of rows.slice(0, bucket.cap)) {
      if (shortlist.length >= NEXT_PROMOTION_SHORTLIST_LIMIT) break;
      shortlist.push(candidate);
    }
    if (shortlist.length >= NEXT_PROMOTION_SHORTLIST_LIMIT) break;
  }

  return shortlist;
}

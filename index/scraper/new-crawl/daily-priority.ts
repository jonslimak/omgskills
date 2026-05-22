import type { PriorityReason, ShadowRepoIndex, ShadowRepoIndexEntry } from "./types.js";

export const DAILY_PRIORITY_REPO_LIMIT = 40;
export const DAILY_PRIORITY_BUCKET_CAPS: Array<{ reason: Exclude<PriorityReason, "stars">; cap: number }> = [
  { reason: "official", cap: 12 },
  { reason: "goldBasket", cap: 10 },
  { reason: "trustedVendor", cap: 8 },
];

export type DailyPriorityDiscoveredRepo = {
  repo: string;
  sources: Set<string>;
};

export type DailyPrioritySelection = {
  repos: ShadowRepoIndexEntry[];
  reasonByRepo: Map<string, PriorityReason>;
  skippedMonitoredRepoCount: number;
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

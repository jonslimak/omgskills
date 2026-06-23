import type { ShadowCadence, ShadowRepoIndex, ShadowRepoIndexEntry } from "./types.js";

export const WEEKLY_CHEAP_CHECK_DAYS = 7;
export const CHEAP_TRIGGERED_REFRESH_LIMIT = 150;

const STATE_PRIORITY: Record<ShadowRepoIndexEntry["state"], number> = {
  core: 0,
  rising: 1,
  library: 2,
};

function refreshableSkillId(repo: ShadowRepoIndexEntry): string | null {
  return repo.topSkillId ?? repo.skillIds[0] ?? null;
}

export function isRepoMissingQuarantined(repo: ShadowRepoIndexEntry): boolean {
  return repo.staleOrInvalidState?.reason === "repoMissing";
}

export function markRepoMissingCheapCheck(repo: ShadowRepoIndexEntry, checkedAt: string) {
  repo.lastCheapCheckedAt = checkedAt;
  repo.staleOrInvalidState = {
    reason: "repoMissing",
    observedRepoUpdatedAt: "",
  };
}

function compareCheapCheckRepos(a: ShadowRepoIndexEntry, b: ShadowRepoIndexEntry): number {
  const aCheckedAt = a.lastCheapCheckedAt ? Date.parse(a.lastCheapCheckedAt) : Number.NEGATIVE_INFINITY;
  const bCheckedAt = b.lastCheapCheckedAt ? Date.parse(b.lastCheapCheckedAt) : Number.NEGATIVE_INFINITY;
  return (
    aCheckedAt - bCheckedAt ||
    STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
    b.stars - a.stars ||
    a.repo.localeCompare(b.repo)
  );
}

export function mergePriorShadowRepoTimestamps(
  repoIndex: ShadowRepoIndex,
  priorRepoIndex: ShadowRepoIndex | null,
  checkedAt: string,
) {
  if (!priorRepoIndex) return;
  const priorByRepo = new Map(priorRepoIndex.repos.map((repo) => [repo.repo, repo] as const));
  for (const repo of repoIndex.repos) {
    const prior = priorByRepo.get(repo.repo);
    if (!prior) continue;
    if (repo.lastSeenAt === checkedAt) repo.lastSeenAt = prior.lastSeenAt;
    if (repo.lastRefreshedAt === checkedAt) repo.lastRefreshedAt = prior.lastRefreshedAt;
    if (repo.lastCheapCheckedAt == null) repo.lastCheapCheckedAt = prior.lastCheapCheckedAt ?? null;
    if (repo.lastObservedRepoUpdatedAt == null) repo.lastObservedRepoUpdatedAt = prior.lastObservedRepoUpdatedAt ?? null;
  }
}

export function buildWeeklyCheapCheckRepos(
  cadence: ShadowCadence,
  repoIndex: ShadowRepoIndex,
  dailyPriorityRepos: ShadowRepoIndexEntry[],
): ShadowRepoIndexEntry[] {
  if (cadence !== "combined") return [];

  const dailyPrioritySet = new Set(dailyPriorityRepos.map((repo) => repo.repo));
  const eligible = repoIndex.repos
    .filter((repo) => !dailyPrioritySet.has(repo.repo))
    .filter((repo) => Boolean(refreshableSkillId(repo)))
    .filter((repo) => !isRepoMissingQuarantined(repo))
    .sort(compareCheapCheckRepos);

  const target = Math.ceil(eligible.length / WEEKLY_CHEAP_CHECK_DAYS);
  return eligible.slice(0, target);
}

export function repoMetaLooksChanged(repoLastUpdated: string, baselineLastUpdated: string): boolean {
  const repoUpdatedAtMs = Date.parse(repoLastUpdated);
  const baselineUpdatedAtMs = Date.parse(baselineLastUpdated);
  if (Number.isNaN(repoUpdatedAtMs) || Number.isNaN(baselineUpdatedAtMs)) return false;
  return repoUpdatedAtMs > baselineUpdatedAtMs;
}

function compareChangedReposForRefresh(a: ShadowRepoIndexEntry, b: ShadowRepoIndexEntry): number {
  const aRefreshedAt = a.lastRefreshedAt ? Date.parse(a.lastRefreshedAt) : Number.NEGATIVE_INFINITY;
  const bRefreshedAt = b.lastRefreshedAt ? Date.parse(b.lastRefreshedAt) : Number.NEGATIVE_INFINITY;
  return (
    STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
    b.stars - a.stars ||
    aRefreshedAt - bRefreshedAt ||
    a.repo.localeCompare(b.repo)
  );
}

export function buildCheapTriggeredRefreshSelection(
  changedRepos: ShadowRepoIndexEntry[],
  limit = CHEAP_TRIGGERED_REFRESH_LIMIT,
): {
  selected: ShadowRepoIndexEntry[];
  deferred: ShadowRepoIndexEntry[];
} {
  const sorted = [...changedRepos].sort(compareChangedReposForRefresh);
  return {
    selected: sorted.slice(0, limit),
    deferred: sorted.slice(limit),
  };
}

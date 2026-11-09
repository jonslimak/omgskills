export interface SourceTrendingEntry {
  source: string;
  skillId: string;
  name: string;
  rank: number;
  installs24h: number;
  sourceUrl: string;
  catalogId?: string;
}
export interface SourceTrendingFeed {
  version: 1;
  source: "skills.sh";
  board: "trending";
  fetchedAt: string;
  entries: SourceTrendingEntry[];
}
export interface SourceTrendingPolicy {
  blockedRepos: string[];
  blockedOwners: string[];
  catalogRepos: string[];
  suppressedIds: string[];
}
export const SOURCE_TRENDING_MAX_ENTRIES: number;
export const SOURCE_TRENDING_STALE_MS: number;
export function sourceTrendingUrl(source: string, skillId: string): string;
export function validateSourceTrending(value: unknown): SourceTrendingFeed;
export function filterSourceTrending(feed: SourceTrendingFeed, policy: SourceTrendingPolicy,
  skills: Array<{ id: string; repo_slug?: string; github_url?: string }>): SourceTrendingFeed;

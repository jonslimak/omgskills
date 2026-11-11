export interface SourceTrendingEntry {
  source: string;
  skillId: string;
  name: string;
  rank: number;
  installs24h: number;
  sourceUrl: string;
  catalogId?: string;
  /** New on skills.sh: nearly all its lifetime installs came in the last few weeks. */
  fresh?: true;
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
  /** Source IDs ("owner/repo:skill") the Trending intake blocked. */
  reviewBlockedIds?: string[];
  /** Source repos the intake found publishing copies; their unreviewed entries are hidden. */
  copyRepos?: string[];
}
export function intakeHiddenPolicy(state: unknown): { reviewBlockedIds: string[]; copyRepos: string[] };
export const SOURCE_TRENDING_MAX_ENTRIES: number;
export const SOURCE_TRENDING_STALE_MS: number;
export const SOURCE_TRENDING_RISING_PER_REPO: number;
export function risingSourceTrending(entries: SourceTrendingEntry[]): SourceTrendingEntry[];
export function isFreshSkill(weeklyInstalls: unknown): boolean;
export function sourceTrendingUrl(source: string, skillId: string): string;
export function validateSourceTrending(value: unknown): SourceTrendingFeed;
export function filterSourceTrending(feed: SourceTrendingFeed, policy: SourceTrendingPolicy,
  skills: Array<{ id: string; repo_slug?: string; github_url?: string; skill_md_path?: string }>): SourceTrendingFeed;

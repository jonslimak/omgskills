export interface SourceTrendingEntry {
  source: string;
  skillId: string;
  name: string;
  rank: number;
  installs24h: number;
  sourceUrl: string;
  catalogId?: string;
  /** Hot list only: installs the day before. */
  installsYesterday?: number;
}
export interface SourceTrendingFeed {
  version: 1;
  source: "skills.sh";
  board: "trending";
  fetchedAt: string;
  entries: SourceTrendingEntry[];
  /** skills.sh "hot" board, curated: new and rising skills. Absent in older feeds. */
  hot?: SourceTrendingEntry[];
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
export const SOURCE_TRENDING_HOT_MIN_INSTALLS: number;
export const SOURCE_TRENDING_HOT_PER_REPO: number;
export const SOURCE_TRENDING_HOT_MIN_GROWTH: number;
export function sourceTrendingUrl(source: string, skillId: string): string;
export function validateSourceTrending(value: unknown): SourceTrendingFeed;
export function filterSourceTrending(feed: SourceTrendingFeed, policy: SourceTrendingPolicy,
  skills: Array<{ id: string; repo_slug?: string; github_url?: string; skill_md_path?: string }>): SourceTrendingFeed;

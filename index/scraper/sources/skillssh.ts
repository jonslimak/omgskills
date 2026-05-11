import { octokit } from "../client.js";

export interface SkillsShHit {
  id: string;
  path: string;
  skill_name_hint: string;
  github_url: string;
  author_handle: string;
  installs: number;
  trending_rank: number;
  trending_source: string;
  stars?: number;
  last_updated?: string;
  tags?: string[];
}

interface SkillsShEntry {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  installsYesterday?: number;
  change?: number;
}

interface SkillsShResponse {
  skills?: SkillsShEntry[];
  total?: number;
  hasMore?: boolean;
  page?: number;
}

interface RepoMeta {
  stars: number;
  lastUpdated: string;
  tags: string[];
}

interface SkillsShOptions {
  board?: "all-time" | "trending" | "hot";
  topLimit?: number;
  crawlAll?: boolean;
  minRepoStars?: number;
  pageConcurrency?: number;
  repoConcurrency?: number;
}

const ROOT_URL = "https://skills.sh";
const PAGE_SIZE = 200;
const DEFAULT_TOP_LIMIT = 500;
const DEFAULT_PAGE_CONCURRENCY = 3;
const DEFAULT_REPO_CONCURRENCY = 10;
const RESOLVE_PATH = "__RESOLVE__";
const PAGE_RETRY_ATTEMPTS = 4;

const repoMetaCache = new Map<string, RepoMeta | null>();

function isValidRepo(repo: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

function deriveId(repo: string, skillId: string): string {
  return `${repo}:${skillId}`;
}

function apiURL(board: SkillsShOptions["board"], page: number): string {
  return `${ROOT_URL}/api/skills/${board ?? "all-time"}/${page}`;
}

async function fetchPage(board: NonNullable<SkillsShOptions["board"]>, page: number): Promise<SkillsShResponse> {
  for (let attempt = 1; attempt <= PAGE_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(apiURL(board, page));
    if (res.ok) {
      return await res.json() as SkillsShResponse;
    }
    if (res.status === 429 && attempt < PAGE_RETRY_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
      console.warn(`  skills.sh ${board} page ${page}: 429, retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    throw new Error(`skills.sh page ${page} failed (${res.status})`);
  }
  throw new Error(`skills.sh page ${page} failed after retries`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchBoardEntries(
  board: NonNullable<SkillsShOptions["board"]>,
  topLimit: number | undefined,
  crawlAll: boolean,
  pageConcurrency: number,
): Promise<{ entries: SkillsShEntry[]; total: number }> {
  const first = await fetchPage(board, 1);
  const total = first.total ?? first.skills?.length ?? 0;
  const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const targetPages = crawlAll
    ? maxPages
    : Math.max(1, Math.ceil((topLimit ?? DEFAULT_TOP_LIMIT) / PAGE_SIZE));

  const pages = Array.from({ length: Math.min(targetPages, maxPages) - 1 }, (_, i) => i + 2);
  const rest = await mapWithConcurrency(pages, pageConcurrency, (page) => fetchPage(board, page));

  const merged = [first, ...rest].flatMap((page) => page.skills ?? []);
  return {
    entries: topLimit && !crawlAll ? merged.slice(0, topLimit) : merged,
    total,
  };
}

async function getRepoMeta(repoFullName: string): Promise<RepoMeta | null> {
  if (repoMetaCache.has(repoFullName)) return repoMetaCache.get(repoFullName)!;

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) return null;

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    const meta: RepoMeta = {
      stars: data.stargazers_count ?? 0,
      lastUpdated: data.pushed_at ?? data.updated_at ?? new Date().toISOString(),
      tags: data.topics ?? [],
    };
    repoMetaCache.set(repoFullName, meta);
    return meta;
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    console.warn(`  skills.sh repo meta miss ${repoFullName}: ${e.status ?? "?"} ${e.message ?? String(err)}`);
    repoMetaCache.set(repoFullName, null);
    return null;
  }
}

export async function searchSkillsSh(options: SkillsShOptions = {}): Promise<SkillsShHit[]> {
  const board = options.board ?? "all-time";
  const topLimit = options.topLimit ?? DEFAULT_TOP_LIMIT;
  const crawlAll = options.crawlAll ?? false;
  const minRepoStars = options.minRepoStars ?? 0;
  const pageConcurrency = options.pageConcurrency ?? DEFAULT_PAGE_CONCURRENCY;
  const repoConcurrency = options.repoConcurrency ?? DEFAULT_REPO_CONCURRENCY;

  const { entries, total } = await fetchBoardEntries(board, topLimit, crawlAll, pageConcurrency);
  const deduped = new Map<string, SkillsShEntry>();
  for (const entry of entries) {
    if (!isValidRepo(entry.source) || !entry.skillId) continue;
    const key = `${entry.source}::${entry.skillId}`;
    const existing = deduped.get(key);
    if (!existing || entry.installs > existing.installs) {
      deduped.set(key, entry);
    }
  }

  const uniqueEntries = [...deduped.values()];
  const uniqueRepos = [...new Set(uniqueEntries.map((entry) => entry.source))];
  const repoMetaPairs = await mapWithConcurrency(uniqueRepos, repoConcurrency, async (repo) => {
    return [repo, await getRepoMeta(repo)] as const;
  });
  const repoMeta = new Map(repoMetaPairs);

  const filtered = uniqueEntries.filter((entry) => {
    const meta = repoMeta.get(entry.source);
    return Boolean(meta && meta.stars >= minRepoStars);
  });

  const results = filtered.map((entry, index) => {
    const [owner] = entry.source.split("/");
    const meta = repoMeta.get(entry.source)!;
    return {
      id: deriveId(entry.source, entry.skillId),
      path: RESOLVE_PATH,
      skill_name_hint: entry.skillId,
      github_url: `https://github.com/${entry.source}`,
      author_handle: owner,
      installs: entry.installs,
      trending_rank: index + 1,
      trending_source: "skills.sh",
      stars: meta.stars,
      last_updated: meta.lastUpdated,
      tags: meta.tags,
    } satisfies SkillsShHit;
  });

  const skippedForStars = uniqueEntries.length - filtered.length;
  console.log(
    `  skills.sh ${board}: kept ${results.length} from ${uniqueEntries.length} entries ` +
    `(${uniqueRepos.length} repos, ${skippedForStars} below ${minRepoStars} stars, total listed ${total})`,
  );
  return results;
}

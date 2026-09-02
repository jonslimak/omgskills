import { octokit } from "../client.js";
import { isGitHubRateLimitError } from "../runtime-guard.js";

export interface CodeHit {
  id: string;
  path: string;
  github_url: string;
  author_handle: string;
}

export interface CodeSearchOptions {
  includeBroadQuery?: boolean;
  maxFingerprintQueries?: number;
  maxPagesPerQuery?: number;
}

export interface HighStarSkillMdHit {
  repo: string;
  query: string;
  path: string;
  url: string;
  stars: number | null;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  error?: string;
}

export interface HighStarSkillMdSearchOptions {
  minStars?: number;
  maxSampledRepos?: number;
  maxPagesPerQuery?: number;
  requestDelayMs?: number;
  queries?: string[];
  cachedRepoMetaByRepo?: ReadonlyMap<string, HighStarSkillMdRepoMeta>;
  searchCodeFn?: (query: string, page: number) => Promise<HighStarSkillMdSearchItem[]>;
  getRepoMetaFn?: (repo: string) => Promise<HighStarSkillMdRepoMeta>;
  sleepFn?: (ms: number) => Promise<void>;
  onMetaProgress?: (completed: number, total: number) => void;
}

export interface HighStarSkillMdSettings {
  minStars: number;
  maxSampledRepos: number;
  maxPagesPerQuery: number;
  requestDelayMs: number;
  queries: string[];
}

interface HighStarSkillMdSearchItem {
  repo: string;
  path: string;
  url: string;
}

export interface HighStarSkillMdRepoMeta {
  stars: number;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
}

export const HIGH_STAR_SKILL_MD_QUERIES = [
  "filename:SKILL.md",
  "filename:SKILL.md path:.claude/skills",
  "filename:SKILL.md path:.agents/skills",
  "filename:SKILL.md path:skills",
];

export const DEFAULT_HIGH_STAR_SKILL_MD_SETTINGS: HighStarSkillMdSettings = {
  minStars: 500,
  maxSampledRepos: 150,
  maxPagesPerQuery: 1,
  requestDelayMs: 500,
  queries: HIGH_STAR_SKILL_MD_QUERIES,
};

function isValidSkillPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

export function isHighStarBackfillPathAllowed(path: string): boolean {
  return (
    path === "SKILL.md" ||
    /^\.claude\/skills\/.+\/SKILL\.md$/.test(path) ||
    /^\.agents\/skills\/.+\/SKILL\.md$/.test(path) ||
    /^skills\/.+\/SKILL\.md$/.test(path)
  );
}

function deriveId(repoFullName: string, path: string): string {
  if (path === "SKILL.md") return repoFullName;
  const parts = path.split("/");
  const skillName = parts[parts.length - 2];
  return `${repoFullName}:${skillName}`;
}

async function collectCodeHits(
  q: string,
  seen: Set<string>,
  results: CodeHit[],
  maxPagesPerQuery?: number,
) {
  const iter = octokit.paginate.iterator(octokit.rest.search.code, {
    q,
    per_page: 100,
  });
  let pageCount = 0;
  try {
    for await (const { data } of iter) {
      pageCount += 1;
      for (const hit of data) {
        if (!isValidSkillPath(hit.path)) continue;
        const id = deriveId(hit.repository.full_name, hit.path);
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({
          id,
          path: hit.path,
          github_url: hit.repository.html_url,
          author_handle: hit.repository.owner?.login ?? "",
        });
      }
      if (maxPagesPerQuery && pageCount >= maxPagesPerQuery) break;
    }
  } catch (err: any) {
    // GitHub caps code search at 1000 results — 404 on page 11+ is expected
    if (err?.status === 404) return;
    if (isGitHubRateLimitError(err)) {
      console.warn(`  code search rate limited for ${q}; keeping ${results.length} collected hits`);
      return;
    }
    throw err;
  }
}

// Fingerprint queries — each targets Claude Code-specific SKILL.md content.
// Size buckets split the ~/.claude/skills query to maximise results under the 1000-result cap.
// Over-cap buckets still yield 1000 results; nightly accumulation covers the remainder.
const FINGERPRINT_QUERIES = [
  // preamble-tier is exclusive to Claude Code SKILL.md format — 784 results, all genuine
  "preamble-tier filename:SKILL.md",

  // ~/.claude/skills in SKILL.md content = install path reference, very high precision
  "~/.claude/skills filename:SKILL.md size:<1000",
  "~/.claude/skills filename:SKILL.md size:1000..2000",
  "~/.claude/skills filename:SKILL.md size:2001..3500",
  "~/.claude/skills filename:SKILL.md size:3501..5000",
  "~/.claude/skills filename:SKILL.md size:5001..8000",
  "~/.claude/skills filename:SKILL.md size:8001..15000",
  "~/.claude/skills filename:SKILL.md size:15001..30000",
  "~/.claude/skills filename:SKILL.md size:>30000",
];

export async function searchBySkillMdFilename(options: CodeSearchOptions = {}): Promise<CodeHit[]> {
  const seen = new Set<string>();
  const results: CodeHit[] = [];
  const includeBroadQuery = options.includeBroadQuery ?? true;
  const fingerprintQueries = options.maxFingerprintQueries
    ? FINGERPRINT_QUERIES.slice(0, options.maxFingerprintQueries)
    : FINGERPRINT_QUERIES;

  // Broad search — catches skills in subdirectories (e.g. .claude/skills/*)
  if (includeBroadQuery) {
    await collectCodeHits("filename:SKILL.md", seen, results, options.maxPagesPerQuery);
  }

  // Fingerprint queries — high-precision, cover root-level and content-identified skills
  for (const q of fingerprintQueries) {
    await collectCodeHits(q, seen, results, options.maxPagesPerQuery);
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function highStarSettings(options: HighStarSkillMdSearchOptions): HighStarSkillMdSettings {
  return {
    minStars: options.minStars ?? DEFAULT_HIGH_STAR_SKILL_MD_SETTINGS.minStars,
    maxSampledRepos: options.maxSampledRepos ?? DEFAULT_HIGH_STAR_SKILL_MD_SETTINGS.maxSampledRepos,
    maxPagesPerQuery: options.maxPagesPerQuery ?? DEFAULT_HIGH_STAR_SKILL_MD_SETTINGS.maxPagesPerQuery,
    requestDelayMs: options.requestDelayMs ?? DEFAULT_HIGH_STAR_SKILL_MD_SETTINGS.requestDelayMs,
    queries: options.queries ?? DEFAULT_HIGH_STAR_SKILL_MD_SETTINGS.queries,
  };
}

function isSearchThrottleError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (status === 403 || status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|secondary rate|abuse/i.test(message);
}

async function defaultSearchCode(query: string, page: number): Promise<HighStarSkillMdSearchItem[]> {
  const response = await octokit.rest.search.code({
    q: query,
    per_page: 100,
    page,
  });

  return response.data.items.map((item) => ({
    repo: item.repository.full_name.toLowerCase(),
    path: item.path,
    url: item.html_url,
  }));
}

async function defaultGetRepoMeta(repoKey: string): Promise<HighStarSkillMdRepoMeta> {
  const [owner, repo] = repoKey.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo key: ${repoKey}`);
  const meta = await octokit.rest.repos.get({ owner, repo });
  return {
    stars: meta.data.stargazers_count ?? 0,
    archived: Boolean(meta.data.archived),
    disabled: Boolean(meta.data.disabled),
    fork: Boolean(meta.data.fork),
  };
}

export async function searchHighStarSkillMdRepos(
  options: HighStarSkillMdSearchOptions = {},
): Promise<{ settings: HighStarSkillMdSettings; hits: HighStarSkillMdHit[] }> {
  const settings = highStarSettings(options);
  const searchCodeFn = options.searchCodeFn ?? defaultSearchCode;
  const getRepoMetaFn = options.getRepoMetaFn ?? defaultGetRepoMeta;
  const sleepFn = options.sleepFn ?? sleep;
  const byRepo = new Map<string, Omit<HighStarSkillMdHit, "stars" | "archived" | "disabled" | "fork" | "error">>();

  for (const query of settings.queries) {
    for (let page = 1; page <= settings.maxPagesPerQuery; page += 1) {
      let items: HighStarSkillMdSearchItem[];
      try {
        items = await searchCodeFn(query, page);
      } catch (error) {
        if (isSearchThrottleError(error)) break;
        throw error;
      }
      for (const item of items) {
        if (!isValidSkillPath(item.path)) continue;
        const repo = item.repo.toLowerCase();
        if (byRepo.has(repo)) continue;
        byRepo.set(repo, {
          repo,
          query,
          path: item.path,
          url: item.url,
        });
      }
      await sleepFn(settings.requestDelayMs);
    }
  }

  const sampled = [...byRepo.values()].slice(0, settings.maxSampledRepos);
  const hits: HighStarSkillMdHit[] = [];

  for (const [index, hit] of sampled.entries()) {
    try {
      const meta = options.cachedRepoMetaByRepo?.get(hit.repo) ?? (await getRepoMetaFn(hit.repo));
      hits.push({
        ...hit,
        stars: meta.stars,
        archived: Boolean(meta.archived),
        disabled: Boolean(meta.disabled),
        fork: Boolean(meta.fork),
      });
    } catch (error) {
      hits.push({
        ...hit,
        stars: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    options.onMetaProgress?.(index + 1, sampled.length);
    await sleepFn(settings.requestDelayMs);
  }

  return { settings, hits };
}

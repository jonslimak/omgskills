import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { compareOptional, compareText, dateKey, nameKey, pageInfo, PagingError, preparePage, validCount,
  validatePageOptions, type CatalogSort, type PageOptions, type PagedSearchOptions, type SkillPage } from "./paging.js";
import { collectionLikeIds } from "./search-ranking-policy.mjs";
import { rankedRequest, rankingIdentity, SearchRankingIndex, type RankedSearchOptions } from "./search-ranking.js";

export type Skill = {
  id: string;
  name: string;
  description: string;
  github_url: string;
  install_cmd: string;
  author_handle: string;
  tags?: string[];
  stars?: number;
  last_updated?: string;
  first_seen?: string;
  skill_md_sha?: string;
  skill_md_path?: string;
  repo_slug?: string;
  install_target_name?: string;
  repo_commit_sha?: string;
  skill_tree_sha?: string;
  publisher_repo?: string;
  provenance_type?: string;
};

export type TrendingEntry = {
  id: string;
  installs?: number | null;
  trending_rank?: number | null;
  trending_source?: string;
};

export type GoldBasketEntry = Skill & {
  niche?: string | null;
  niche_label?: string | null;
  score?: number | null;
  installs?: number | null;
  trending_rank?: number | null;
  externally_validated?: boolean;
  external_source_count?: number;
  official_vendor?: boolean;
};

export type LibraryPaths = {
  skillsPath?: string;
  trendingPath?: string;
  goldBasketPath?: string;
  manifestUrl?: string;
  goldBasketUrl?: string;
  fetcher?: typeof fetch;
  allowMissingTrending?: boolean;
  allowMissingGoldBasket?: boolean;
  ranking?: boolean;
};

export type SearchOptions = {
  query: string;
  limit?: number;
  author?: string;
  tag?: string;
  minStars?: number;
};

export type SkillResult = Skill & {
  score: number;
  installs?: number;
  trending_rank?: number;
  gold_score?: number;
  niche?: string;
  niche_label?: string;
};

export type LoadedLibrary = {
  skills: Skill[];
  trending: TrendingEntry[];
  goldBasket: GoldBasketEntry[];
};

// Fields needed by MCP and exact install-record consumers. Published catalogs
// carry more (README snippets, tweets); dropping those keeps memory and GC low.
const skillFields = [
  "id", "name", "description", "github_url", "install_cmd", "author_handle", "tags", "stars",
  "last_updated", "first_seen", "skill_md_sha", "skill_md_path", "repo_commit_sha", "skill_tree_sha",
  "repo_slug", "install_target_name"
] as const satisfies readonly (keyof Skill)[];

// Precomputed per-skill search data so a query never re-normalizes or copies records.
type SearchEntry = {
  skill: Skill;
  fields: string[];
  author: string;
  tags: string[];
  stars: number;
  signal: number;
};

const searchFieldWeights = [12, 10, 8, 6, 4, 2];

export class OmgskillsLibrary {
  private readonly data: LoadedLibrary;
  private readonly skillsById = new Map<string, Skill>();
  private readonly trendingById = new Map<string, TrendingEntry>();
  private readonly goldById = new Map<string, GoldBasketEntry>();
  private readonly entries: SearchEntry[];
  private readonly entriesByAuthor = new Map<string, SearchEntry[]>();
  private readonly ranking?: SearchRankingIndex;

  private constructor(data: LoadedLibrary, readonly version?: string, options: { ranking?: boolean; collectionLikeIds?: ReadonlySet<string> } = {}) {
    this.data = { ...data, skills: data.skills.map(slimSkill) };
    for (const skill of this.data.skills) this.skillsById.set(skill.id, skill);
    for (const entry of data.trending) this.trendingById.set(entry.id, entry);
    for (const entry of data.goldBasket) this.goldById.set(entry.id, entry);

    this.entries = this.data.skills.map((skill) => ({
      skill,
      fields: [skill.name, skill.id, skill.author_handle, (skill.tags ?? []).join(" "), skill.description, skill.github_url].map(normalize),
      author: normalize(skill.author_handle),
      tags: (skill.tags ?? []).map(normalize),
      stars: skill.stars ?? 0,
      signal: this.signalScore(skill)
    }));
    for (const entry of this.entries) {
      const list = this.entriesByAuthor.get(entry.author);
      if (list) list.push(entry);
      else this.entriesByAuthor.set(entry.author, [entry]);
    }
    if (options.ranking) this.ranking = new SearchRankingIndex(this.entries, options.collectionLikeIds ?? new Set(collectionLikeIds(data.skills)));
  }

  static async load(paths = defaultLibraryPaths()): Promise<OmgskillsLibrary> {
    const manifestUrl = paths.manifestUrl ?? defaultManifestUrl;
    const fetcher = paths.fetcher ?? fetch;
    const manifest = paths.skillsPath && paths.trendingPath ? undefined : await readJson<Manifest>(manifestUrl, fetcher);
    const baseUrl = new URL(".", manifestUrl).toString();
    const skillsSource = paths.skillsPath ?? manifestAssetUrl(manifest?.skills, baseUrl, "skills");
    const trendingSource = paths.trendingPath ?? optionalManifestAssetUrl(manifest?.trending, baseUrl);
    const goldBasketSource = paths.goldBasketPath ?? paths.goldBasketUrl ?? defaultGoldBasketUrl;

    const [skills, trending, goldBasket] = await Promise.all([
      readJsonArray<Skill>(skillsSource, fetcher),
      readOptionalJsonArray<TrendingEntry>(trendingSource, fetcher, paths.allowMissingTrending, "trending"),
      readOptionalJsonArray<GoldBasketEntry>(goldBasketSource, fetcher, paths.allowMissingGoldBasket)
    ]);

    // Failed optional reads are usable for discovery, but must be retried rather
    // than cached as a complete snapshot. Local overrides are not manifest-versioned.
    const version = trending.complete && goldBasket.complete &&
      !paths.skillsPath && !paths.trendingPath && !paths.goldBasketPath
      ? manifestVersion(manifest, goldBasket.data) : undefined;
    return new OmgskillsLibrary({ skills, trending: trending.data, goldBasket: goldBasket.data }, version, { ranking: paths.ranking });
  }

  /** Check hashed catalog paths and the independently published curated data. */
  static async readVersion(
    manifestUrl: string,
    fetcher: typeof fetch = fetch,
    goldBasketUrl = defaultGoldBasketUrl
  ): Promise<string | undefined> {
    const [manifest, goldBasket] = await Promise.all([
      readJson<Manifest>(manifestUrl, fetcher),
      readJsonArray<GoldBasketEntry>(goldBasketUrl, fetcher)
    ]);
    return manifestVersion(manifest, goldBasket);
  }

  static fromData(data: LoadedLibrary, version?: string, options: { ranking?: boolean; collectionLikeIds?: ReadonlySet<string> } = {}): OmgskillsLibrary {
    return new OmgskillsLibrary(data, version, options);
  }

  getStats() {
    return {
      skills: this.data.skills.length,
      trending: this.data.trending.length,
      goldBasket: this.data.goldBasket.length
    };
  }

  getSkill(id: string): SkillResult | undefined {
    const skill = this.skillsById.get(id) ?? this.goldById.get(id);
    return skill ? this.enrich(skill, 0) : undefined;
  }

  searchSkills(options: SearchOptions): SkillResult[] {
    return this.matches(options)
      .sort(compareRelevance)
      .slice(0, clampLimit(options.limit))
      .map(({ entry, score }) => this.enrich(entry.skill, score));
  }

  private matches(options: SearchOptions): { entry: SearchEntry; score: number }[] {
    const query = normalize(options.query);
    const terms = query.split(" ").filter(Boolean);
    const author = options.author ? normalize(options.author) : undefined;
    const tag = options.tag ? normalize(options.tag) : undefined;
    const minStars = options.minStars ?? 0;

    if (terms.length === 0 && !author && !tag && minStars === 0) {
      return [];
    }

    const candidates = author ? this.entriesByAuthor.get(author) ?? [] : this.entries;
    const matches: { entry: SearchEntry; score: number }[] = [];
    for (const entry of candidates) {
      if (tag && !entry.tags.includes(tag)) continue;
      if (entry.stars < minStars) continue;
      const score = terms.length === 0 ? entry.signal : textScore(entry, terms);
      if (terms.length > 0 && score <= 0) continue;
      matches.push({ entry, score });
    }

    return matches;
  }

  searchPage(options: PagedSearchOptions): SkillPage {
    return this.matchPage(options, "search_skills");
  }

  searchRankedPage(options: RankedSearchOptions): SkillPage {
    validatePageOptions("search_skills", options);
    if (options.ranking !== "web-v1") throw new PagingError("invalid_cursor");
    const request = rankedRequest(options);
    const context = preparePage(this.version, "search_skills", { ...options, query: request.tokens.join(" "), author: request.author },
      { policy: rankingIdentity, terms: request.tokens, exactQuery: this.skillsById.has(request.query) ? request.query : "" });
    if (!this.ranking) throw new PagingError("ranking_not_supported");
    if (!request.tokens.length) {
      const matches = this.matches({ ...options, query: "", author: request.author });
      const page = pageInfo(context, matches.length);
      return { page, skills: this.sortMatches(matches, context.sort).slice(context.offset, context.offset + context.limit).map(({ entry, score }) => this.enrich(entry.skill, score)) };
    }
    if (context.sort === "relevance") {
      const selected = this.ranking.select(options, request, context.offset, context.limit,
        id => assertRank(this.trendingById.get(id)?.trending_rank ?? this.goldById.get(id)?.trending_rank));
      return { page: pageInfo(context, selected.total), skills: selected.matches.map(({ skill, score }) => this.enrich(skill, score)) };
    }
    const matches = this.ranking.matches(options, request);
    for (const match of matches) assertRank(this.trendingById.get(match.skill.id)?.trending_rank ?? this.goldById.get(match.skill.id)?.trending_rank);
    const page = pageInfo(context, matches.length);
    const selected = this.sortMatches(matches.map(match => ({ entry: { skill: match.skill, stars: match.stars }, score: match.score })), context.sort).slice(context.offset, context.offset + context.limit).map(({ entry, score }) => ({ skill: entry.skill, score }));
    return { page, skills: selected.map(({ skill, score }) => this.enrich(skill, score)) };
  }

  listByAuthorPage(author: string, options: PageOptions): SkillPage {
    return this.matchPage({ ...options, query: "", author }, "list_by_author");
  }

  private matchPage(options: PagedSearchOptions, tool: string): SkillPage {
    const context = preparePage(this.version, tool, options), matches = this.matches(options);
    for (const { entry } of matches) assertRank(this.trendingById.get(entry.skill.id)?.trending_rank ?? this.goldById.get(entry.skill.id)?.trending_rank);
    const page = pageInfo(context, matches.length);
    const sorted = this.sortMatches(matches, context.sort);
    return { page, skills: sorted.slice(context.offset, context.offset + context.limit).map(({ entry, score }) => this.enrich(entry.skill, score)) };
  }

  private sortMatches<T extends { entry: Pick<SearchEntry, "skill" | "stars">; score: number }>(matches: T[], sort: CatalogSort) {
    if (sort === "relevance") return matches.sort(compareRelevance);
    const keyed = matches.map(match => {
      const skill = match.entry.skill, trending = this.trendingById.get(skill.id), gold = this.goldById.get(skill.id);
      const rank = trending?.trending_rank ?? gold?.trending_rank;
      if (sort === "trending") assertRank(rank);
      return { match, name: nameKey(skill.name), stars: validCount(skill.stars),
        rank: validCount(rank), installs: validCount(trending?.installs ?? gold?.installs),
        date: sort === "updated" ? dateKey(skill.last_updated) : sort === "added" ? dateKey(skill.first_seen) : undefined };
    });
    keyed.sort((a, b) => {
      const primary = sort === "trending" ? compareOptional(a.rank, b.rank, false) || compareOptional(a.installs, b.installs) || compareOptional(a.stars, b.stars)
        : sort === "stars" ? compareOptional(a.stars, b.stars)
        : sort === "updated" || sort === "added" ? compareOptional(a.date, b.date) : 0;
      return primary || compareText(a.name, b.name) || compareText(a.match.entry.skill.id, b.match.entry.skill.id);
    });
    return keyed.map(row => row.match);
  }

  listTrendingPage(options: Omit<PageOptions, "sort">): SkillPage {
    const context = preparePage(this.version, "list_trending", options);
    const ids = new Set<string>();
    for (const row of this.data.trending) {
      if (ids.has(row.id) || !this.skillsById.has(row.id)) throw new PagingError("catalog_unavailable");
      ids.add(row.id); assertRank(row.trending_rank);
    }
    const page = pageInfo(context, ids.size);
    const rows = this.data.trending.slice().sort((a, b) => (a.trending_rank ?? Number.MAX_SAFE_INTEGER) - (b.trending_rank ?? Number.MAX_SAFE_INTEGER));
    return { page, skills: rows.slice(context.offset, context.offset + context.limit)
      .map(row => this.enrich(this.skillsById.get(row.id)!, this.signalScoreById(row.id))) };
  }

  listTrending(limit?: number): SkillResult[] {
    return this.data.trending
      .slice()
      .sort((a, b) => (a.trending_rank ?? Number.MAX_SAFE_INTEGER) - (b.trending_rank ?? Number.MAX_SAFE_INTEGER))
      .slice(0, clampLimit(limit))
      .map((entry) => this.enrich(this.skillsById.get(entry.id) ?? ({ id: entry.id } as Skill), this.signalScoreById(entry.id)));
  }

  listGoldBasket(limit?: number): SkillResult[] {
    return this.data.goldBasket
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, clampLimit(limit))
      .map((entry) => this.enrich(entry, this.signalScoreById(entry.id)));
  }

  listByAuthor(author: string, limit?: number): SkillResult[] {
    return this.searchSkills({ query: "", author, limit });
  }

  private enrich(skill: Skill, score: number): SkillResult {
    const trending = this.trendingById.get(skill.id);
    const gold = this.goldById.get(skill.id);

    return {
      ...skill,
      score,
      installs: trending?.installs ?? gold?.installs ?? undefined,
      trending_rank: trending?.trending_rank ?? gold?.trending_rank ?? undefined,
      gold_score: gold?.score ?? undefined,
      niche: gold?.niche ?? undefined,
      niche_label: gold?.niche_label ?? undefined
    };
  }

  private signalScore(skill: Skill): number {
    return this.signalScoreById(skill.id) + Math.log10((skill.stars ?? 0) + 1);
  }

  private signalScoreById(id: string): number {
    const trending = this.trendingById.get(id);
    const gold = this.goldById.get(id);
    const trendingBoost = trending?.trending_rank ? Math.max(0, 10 - trending.trending_rank / 50) : 0;
    const goldBoost = gold?.score ? gold.score / 10 : 0;
    return trendingBoost + goldBoost;
  }
}

export function defaultLibraryPaths(): LibraryPaths {
  return {
    skillsPath: process.env.OMGSKILLS_SKILLS_PATH ? resolve(process.env.OMGSKILLS_SKILLS_PATH) : undefined,
    trendingPath: process.env.OMGSKILLS_TRENDING_PATH ? resolve(process.env.OMGSKILLS_TRENDING_PATH) : undefined,
    goldBasketPath: process.env.OMGSKILLS_GOLD_BASKET_PATH ? resolve(process.env.OMGSKILLS_GOLD_BASKET_PATH) : undefined,
    manifestUrl: process.env.OMGSKILLS_MANIFEST_URL ?? defaultManifestUrl,
    goldBasketUrl: process.env.OMGSKILLS_GOLD_BASKET_URL ?? defaultGoldBasketUrl
  };
}

async function readJsonArray<T>(pathOrUrl: string, fetcher: typeof fetch): Promise<T[]> {
  const parsed = await readJson<unknown>(pathOrUrl, fetcher);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array at ${pathOrUrl}`);
  }
  return parsed as T[];
}

async function readOptionalJsonArray<T>(
  pathOrUrl: string | undefined,
  fetcher: typeof fetch,
  optional = false,
  label = "optional data"
): Promise<{ data: T[]; complete: boolean }> {
  if (!pathOrUrl) {
    if (optional) return { data: [], complete: true };
    throw new Error(`Missing ${label} source`);
  }
  try {
    return { data: await readJsonArray<T>(pathOrUrl, fetcher), complete: true };
  } catch (error) {
    if (optional) return { data: [], complete: false };
    throw error;
  }
}

async function readJson<T>(pathOrUrl: string, fetcher: typeof fetch): Promise<T> {
  if (isUrl(pathOrUrl)) {
    const response = await fetcher(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathOrUrl}: ${response.status} ${response.statusText}`);
    }
    return await response.json() as T;
  }

  const raw = await readFile(pathOrUrl, "utf8");
  return JSON.parse(raw) as T;
}

type ManifestAsset = {
  path?: string;
};

type Manifest = {
  skills?: ManifestAsset;
  trending?: ManifestAsset;
};

const defaultManifestUrl = "https://omgskills.com/data/manifest.json";
const defaultGoldBasketUrl = "https://raw.githubusercontent.com/jonslimak/omgskills/main/index/gold-basket.json";

function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function manifestAssetUrl(asset: ManifestAsset | undefined, baseUrl: string, label: string): string {
  if (!asset?.path) {
    throw new Error(`Manifest missing ${label}.path`);
  }
  return new URL(asset.path, baseUrl).toString();
}

function optionalManifestAssetUrl(asset: ManifestAsset | undefined, baseUrl: string): string | undefined {
  return asset?.path ? new URL(asset.path, baseUrl).toString() : undefined;
}

function textScore(entry: SearchEntry, terms: string[]): number {
  let score = entry.signal;
  for (const term of terms) {
    let matched = false;
    for (let index = 0; index < entry.fields.length; index++) {
      const text = entry.fields[index];
      const weight = searchFieldWeights[index];
      if (text === term) {
        score += weight * 3;
        matched = true;
      } else if (text.includes(term)) {
        score += weight;
        matched = true;
      }
    }
    if (!matched) return 0;
  }
  return score;
}

export function slimSkill(skill: Skill): Skill {
  const slim: Record<string, unknown> = {};
  for (const field of skillFields) {
    if (skill[field] !== undefined) slim[field] = skill[field];
  }
  return slim as Skill;
}

function manifestVersion(manifest: Manifest | undefined, goldBasket: GoldBasketEntry[]): string | undefined {
  if (!manifest?.skills?.path) return undefined;
  const goldHash = createHash("sha256").update(JSON.stringify(goldBasket)).digest("hex");
  return [manifest.skills.path, manifest.trending?.path ?? "", goldHash].join("|");
}

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0) || limit === undefined) return 20;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function compareRelevance(a: { entry: { stars: number }; score: number }, b: { entry: { stars: number }; score: number }) {
  // Stable sorting retains catalog order for exact legacy ties.
  return b.score !== a.score ? b.score - a.score : b.entry.stars - a.entry.stars;
}
function assertRank(value: unknown) {
  if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)) throw new PagingError("catalog_unavailable");
}

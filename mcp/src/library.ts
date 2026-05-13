import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
};

export type TrendingEntry = {
  id: string;
  installs?: number;
  trending_rank?: number;
  trending_source?: string;
};

export type GoldBasketEntry = Skill & {
  niche?: string;
  niche_label?: string;
  score?: number;
  installs?: number;
  trending_rank?: number;
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

type LoadedLibrary = {
  skills: Skill[];
  trending: TrendingEntry[];
  goldBasket: GoldBasketEntry[];
};

export class OmgskillsLibrary {
  private readonly skillsById = new Map<string, Skill>();
  private readonly trendingById = new Map<string, TrendingEntry>();
  private readonly goldById = new Map<string, GoldBasketEntry>();

  private constructor(private readonly data: LoadedLibrary) {
    for (const skill of data.skills) this.skillsById.set(skill.id, skill);
    for (const entry of data.trending) this.trendingById.set(entry.id, entry);
    for (const entry of data.goldBasket) this.goldById.set(entry.id, entry);
  }

  static async load(paths = defaultLibraryPaths()): Promise<OmgskillsLibrary> {
    const manifestUrl = paths.manifestUrl ?? defaultManifestUrl;
    const manifest = paths.skillsPath && paths.trendingPath ? undefined : await readJson<Manifest>(manifestUrl);
    const baseUrl = new URL(".", manifestUrl).toString();

    const [skills, trending, goldBasket] = await Promise.all([
      readJsonArray<Skill>(paths.skillsPath ?? new URL(manifest?.skills.path ?? "", baseUrl).toString()),
      readJsonArray<TrendingEntry>(paths.trendingPath ?? new URL(manifest?.trending.path ?? "", baseUrl).toString()),
      readJsonArray<GoldBasketEntry>(paths.goldBasketPath ?? paths.goldBasketUrl ?? defaultGoldBasketUrl)
    ]);

    return new OmgskillsLibrary({ skills, trending, goldBasket });
  }

  getSkill(id: string): SkillResult | undefined {
    const skill = this.skillsById.get(id) ?? this.goldById.get(id);
    return skill ? this.enrich(skill, 0) : undefined;
  }

  searchSkills(options: SearchOptions): SkillResult[] {
    const query = normalize(options.query);
    const terms = query.split(" ").filter(Boolean);
    const limit = clampLimit(options.limit);
    const author = options.author ? normalize(options.author) : undefined;
    const tag = options.tag ? normalize(options.tag) : undefined;
    const minStars = options.minStars ?? 0;

    if (terms.length === 0 && !author && !tag && minStars === 0) {
      return [];
    }

    return this.data.skills
      .filter((skill) => {
        if (author && normalize(skill.author_handle) !== author) return false;
        if (tag && !(skill.tags ?? []).some((value) => normalize(value) === tag)) return false;
        if ((skill.stars ?? 0) < minStars) return false;
        return true;
      })
      .map((skill) => {
        const score = terms.length === 0 ? this.signalScore(skill) : this.textScore(skill, terms);
        return this.enrich(skill, score);
      })
      .filter((skill) => terms.length === 0 || skill.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.stars ?? 0) - (a.stars ?? 0);
      })
      .slice(0, limit);
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
      installs: trending?.installs ?? gold?.installs,
      trending_rank: trending?.trending_rank ?? gold?.trending_rank,
      gold_score: gold?.score,
      niche: gold?.niche,
      niche_label: gold?.niche_label
    };
  }

  private textScore(skill: Skill, terms: string[]): number {
    const fields = [
      { text: skill.name, weight: 12 },
      { text: skill.id, weight: 10 },
      { text: skill.author_handle, weight: 8 },
      { text: (skill.tags ?? []).join(" "), weight: 6 },
      { text: skill.description, weight: 4 },
      { text: skill.github_url, weight: 2 }
    ];

    let score = this.signalScore(skill);
    for (const term of terms) {
      let matched = false;
      for (const field of fields) {
        const text = normalize(field.text);
        if (text === term) {
          score += field.weight * 3;
          matched = true;
        } else if (text.includes(term)) {
          score += field.weight;
          matched = true;
        }
      }
      if (!matched) return 0;
    }
    return score;
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

async function readJsonArray<T>(pathOrUrl: string): Promise<T[]> {
  const parsed = await readJson<unknown>(pathOrUrl);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array at ${pathOrUrl}`);
  }
  return parsed as T[];
}

async function readJson<T>(pathOrUrl: string): Promise<T> {
  if (isUrl(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathOrUrl}: ${response.status} ${response.statusText}`);
    }
    return await response.json() as T;
  }

  const raw = await readFile(pathOrUrl, "utf8");
  return JSON.parse(raw) as T;
}

type Manifest = {
  skills: { path: string };
  trending: { path: string };
};

const defaultManifestUrl = "https://omgskills.com/data/manifest.json";
const defaultGoldBasketUrl = "https://raw.githubusercontent.com/jonslimak/omgskills/main/index/gold-basket.json";

function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0) || limit === undefined) return 20;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

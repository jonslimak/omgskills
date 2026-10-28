import type { SearchOptions, SkillResult } from "./library.js";
import type { PageOptions, PagedSearchOptions, SearchNote, SkillPage } from "./paging.js";
import type { RankedSearchOptions } from "./search-ranking.js";

type Read<T> = T | Promise<T>;
export interface CatalogReader {
  getSkill(id: string): Read<SkillResult | undefined>;
  searchSkills(options: SearchOptions): Read<SkillResult[]>;
  /** Search results plus how the query was interpreted; readers without it fall back to searchSkills. */
  searchWithNote?(options: SearchOptions): Read<{ skills: SkillResult[]; note?: SearchNote }>;
  relatedSkills?(id: string, limit?: number, installable?: boolean): Read<SkillResult[] | undefined>;
  listTrending(limit?: number): Read<SkillResult[]>;
  listGoldBasket(limit?: number): Read<SkillResult[]>;
  listByAuthor(author: string, limit?: number): Read<SkillResult[]>;
  searchPage?(options: PagedSearchOptions): Read<SkillPage>;
  searchRankedPage?(options: RankedSearchOptions): Read<SkillPage>;
  listByAuthorPage?(author: string, options: PageOptions): Read<SkillPage>;
  listTrendingPage?(options: Omit<PageOptions, "sort">): Read<SkillPage>;
  listGoldBasketPage?(options: Omit<PageOptions, "sort">): Read<SkillPage>;
  getStats(): { skills: number; trending: number; goldBasket: number };
  diagnostics?(): Record<string, number | string>;
  /** Same reads without per-result detail loading; results carry list fields only. */
  summaryReader?(): CatalogReader;
}

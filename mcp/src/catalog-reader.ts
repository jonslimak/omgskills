import type { SearchOptions, SkillResult } from "./library.js";
import type { PageOptions, PagedSearchOptions, SkillPage } from "./paging.js";

type Read<T> = T | Promise<T>;
export interface CatalogReader {
  getSkill(id: string): Read<SkillResult | undefined>;
  searchSkills(options: SearchOptions): Read<SkillResult[]>;
  listTrending(limit?: number): Read<SkillResult[]>;
  listGoldBasket(limit?: number): Read<SkillResult[]>;
  listByAuthor(author: string, limit?: number): Read<SkillResult[]>;
  searchPage?(options: PagedSearchOptions): Read<SkillPage>;
  listByAuthorPage?(author: string, options: PageOptions): Read<SkillPage>;
  listTrendingPage?(options: Omit<PageOptions, "sort">): Read<SkillPage>;
  getStats(): { skills: number; trending: number; goldBasket: number };
  diagnostics?(): Record<string, number | string>;
}

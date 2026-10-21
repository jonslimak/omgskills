import type { CatalogSummary, Navigation } from "./model";
import { discoveryCategories } from "./discovery-categories";

export const publicSorts = ["relevance", "trending", "stars", "updated", "added", "name"] as const;
export type PublicSort = typeof publicSorts[number];
export type PublicListTool = "search_skills" | "list_by_author" | "list_trending";
export type PublicPageInfo = { total: number; hasMore: boolean; nextCursor: string | null; snapshot: string; sort: PublicSort };
export type PublicPage = { skills: CatalogSummary[]; page: PublicPageInfo };
export type PublicPageRequest = { name: PublicListTool; args: Record<string, unknown>; sort: PublicSort };
export class PublicCatalogError extends Error {
  constructor(readonly code: string, message = "The catalog could not complete this request. Try again.") { super(message); }
}
export function validPublicSort(value: unknown): value is PublicSort {
  return typeof value === "string" && publicSorts.includes(value as PublicSort);
}
export function publicPageRequest(nav: Navigation): PublicPageRequest | null {
  if (!["discover", "data", "top", "creators", "collections", "creator", "collection", "category"].includes(nav.view)) return null;
  const category = nav.view === "category" && discoveryCategories.some(group => group.items.includes(nav.id)) ? nav.id : "";
  const query = nav.query.trim() || category;
  const sort = validPublicSort(nav.sort) ? nav.sort : "relevance";
  if (query) return { name: "search_skills", args: { query, ranking: "web-v1", sort, limit: 30 }, sort };
  if (nav.view === "creator") return { name: "list_by_author", args: { author: nav.id, sort, limit: 30 }, sort };
  if (nav.view === "top") return { name: "list_trending", args: { limit: 30 }, sort: "trending" };
  return null;
}
export function parsePageInfo(value: unknown, count: unknown, length: number, request: PublicPageRequest, cursor?: string): PublicPageInfo {
  const bad = () => { throw new Error("The catalog returned an invalid page."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const page = value as Record<string, unknown>;
  if (count !== length || length > 30 || !Number.isSafeInteger(page.total) || (page.total as number) < length
    || typeof page.hasMore !== "boolean" || page.sort !== request.sort
    || typeof page.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(page.snapshot)
    || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(page.nextCursor)))
    || page.hasMore !== (page.nextCursor !== null) || (page.hasMore && length === 0)
    || (cursor !== undefined && page.nextCursor === cursor)
    || (cursor === undefined && (page.hasMore ? (page.total as number) <= length : page.total !== length))) return bad();
  return page as PublicPageInfo;
}
export function appendPublicPage(previous: PublicPage, next: PublicPage, seenCursors: ReadonlySet<string>): PublicPage {
  if (next.page.snapshot !== previous.page.snapshot) throw new PublicCatalogError("catalog_snapshot_changed", "The catalog changed. Refresh these results.");
  const ids = new Set(previous.skills.map(skill => skill.id));
  const length = previous.skills.length + next.skills.length;
  if (!previous.page.hasMore || next.page.sort !== previous.page.sort || next.page.total !== previous.page.total
    || next.skills.some(skill => ids.has(skill.id)) || length > next.page.total
    || (next.page.hasMore ? length >= next.page.total : length !== next.page.total)
    || (next.page.nextCursor !== null && seenCursors.has(next.page.nextCursor))) {
    throw new PublicCatalogError("invalid_cursor", "The catalog page could not be confirmed. Refresh these results.");
  }
  return { skills: [...previous.skills, ...next.skills], page: next.page };
}
export function requiresPageRestart(error: unknown) {
  return error instanceof PublicCatalogError && ["catalog_snapshot_changed", "invalid_cursor", "ranking_not_supported", "paging_not_supported"].includes(error.code);
}

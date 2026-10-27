import { createHash } from "node:crypto";
import type { SearchOptions, SkillResult } from "./library.js";

export const catalogSorts = ["relevance", "trending", "stars", "updated", "added", "name"] as const;
export type CatalogSort = typeof catalogSorts[number];
export type PageRequest = { cursor?: string };
export type PageOptions = { limit?: number; sort?: CatalogSort; page: PageRequest };
export type PagedSearchOptions = SearchOptions & PageOptions;
export type PageInfo = { total: number; hasMore: boolean; nextCursor: string | null; snapshot: string; sort: CatalogSort };
/** How a search was interpreted when it did not simply match every word. */
export type SearchNote = { did_you_mean?: string; partial_match?: boolean; showing_trending?: boolean };
export type SkillPage = { skills: SkillResult[]; page: PageInfo; search?: SearchNote };
/** Default page and list size: small enough to keep agent context lean. */
export const defaultLimit = 10;
export type PagingErrorCode = "invalid_cursor" | "catalog_snapshot_changed" | "paging_not_supported" | "ranking_not_supported" | "catalog_unavailable";
const messages: Record<PagingErrorCode, string> = {
  invalid_cursor: "Invalid paging request or cursor.",
  catalog_snapshot_changed: "The catalog changed. Restart from the first page.",
  paging_not_supported: "Paging is not available on this reader.",
  ranking_not_supported: "Ranking is not available on this reader.",
  catalog_unavailable: "A complete catalog snapshot is temporarily unavailable.",
};
export class PagingError extends Error {
  constructor(readonly code: PagingErrorCode, detail?: string) { super(detail ?? messages[code]); }
}
type Cursor = { v: 1; snapshot: string; request: string; offset: number };
export type PageContext = Omit<Cursor, "v"> & { limit: number; sort: CatalogSort };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value?: string) => String(value ?? "").toLowerCase().trim();
const fail = (detail?: string): never => { throw new PagingError("invalid_cursor", detail); };
const badCursor = "page.cursor is not a cursor from this server. Start again with page: {}.";

export function validatePageOptions(tool: string, options: PageOptions & Partial<SearchOptions>) {
  const { page } = options, limit = options.limit ?? defaultLimit, sort = options.sort ?? (tool === "list_trending" ? "trending" : "relevance");
  if (!page || typeof page !== "object" || Array.isArray(page) || Object.keys(page).some(key => key !== "cursor")
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !catalogSorts.includes(sort)
    || (tool === "list_trending" && sort !== "trending")
    || (options.query !== undefined && (typeof options.query !== "string" || Buffer.byteLength(options.query) > 1024))
    || [options.author, options.tag].some(value => value !== undefined && (typeof value !== "string" || value.length > 100))
    || (options.minStars !== undefined && (!Number.isSafeInteger(options.minStars) || options.minStars < 0)))
    fail(options.query !== undefined && typeof options.query === "string" && Buffer.byteLength(options.query) > 1024
      ? "query is too long (over 1,024 bytes); use a few keywords or a short task description."
      : `Invalid paging arguments: limit must be 1-100, sort one of ${catalogSorts.join(", ")}${tool === "list_trending" ? " (list_trending sorts by trending only)" : ""}, and page either {} or {cursor}.`);
}

export function preparePage(version: string | undefined, tool: string, options: PageOptions & Partial<SearchOptions>, ranking?: { policy: string; terms: string[]; exactQuery: string }): PageContext {
  validatePageOptions(tool, options);
  const { page } = options, limit = options.limit ?? defaultLimit, sort = options.sort ?? (tool === "list_trending" ? "trending" : "relevance");
  let cursor: Cursor | undefined;
  if (page.cursor !== undefined) {
    if (typeof page.cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(page.cursor) || Buffer.byteLength(page.cursor) > 1024) fail(badCursor);
    try {
      const bytes = Buffer.from(page.cursor, "base64url");
      if (bytes.toString("base64url") !== page.cursor) fail(badCursor);
      cursor = JSON.parse(bytes.toString("utf8"));
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)
        || Object.keys(cursor).sort().join(",") !== "offset,request,snapshot,v" || cursor.v !== 1
        || typeof cursor.snapshot !== "string" || typeof cursor.request !== "string"
        || !/^[a-f0-9]{64}$/.test(cursor.snapshot) || !/^[a-f0-9]{64}$/.test(cursor.request)
        || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) fail(badCursor);
    } catch (error) { if (error instanceof PagingError) throw error; fail(badCursor); }
  }
  if (!version) throw new PagingError("catalog_unavailable");
  const snapshot = digest(version);
  const request = digest({ ordering: 1, tool,
    terms: normalized(options.query).split(" ").filter(Boolean), author: normalized(options.author),
    tag: normalized(options.tag), minStars: options.minStars ?? 0, limit, sort,
    ...(ranking ? { ranking: ranking.policy, terms: ranking.terms, exactQuery: ranking.exactQuery } : {}) });
  if (cursor && cursor.request !== request) fail("This cursor belongs to a request with different arguments. Repeat the original query, filters, limit and sort with page.cursor, or start again with page: {}.");
  if (cursor && cursor.snapshot !== snapshot) throw new PagingError("catalog_snapshot_changed");
  return { snapshot, request, offset: cursor?.offset ?? 0, limit, sort };
}

export function pageInfo(context: PageContext, total: number): PageInfo {
  if (context.offset > total) fail("This cursor points past the end of the results. Start again with page: {}.");
  const next = Math.min(total, context.offset + context.limit), hasMore = next < total;
  return { total, hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ v: 1, snapshot: context.snapshot,
    request: context.request, offset: next })).toString("base64url") : null, snapshot: context.snapshot, sort: context.sort };
}

// Code-point ordering is explicit: neither host locale nor UTF-16 surrogate order changes pages.
export function compareText(a: string, b: string) {
  const left = a[Symbol.iterator](), right = b[Symbol.iterator]();
  while (true) {
    const x = left.next(), y = right.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const delta = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (delta) return delta;
  }
}
export function nameKey(value: string) { return String(value ?? "").normalize("NFKC").toLowerCase(); }
export function validCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function dateKey(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(value.slice(0, 10) + "T00:00:00Z");
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : undefined;
}
export function compareOptional(a: number | undefined, b: number | undefined, descending = true) {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return descending ? b - a : a - b;
}

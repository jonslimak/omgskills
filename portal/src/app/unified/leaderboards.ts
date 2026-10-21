export const leaderboardCategoryIds = ["influential", "most-used", "peak", "consistent", "prolific", "efficient"] as const;
export type LeaderboardCategoryId = typeof leaderboardCategoryIds[number];
export type LeaderboardCreator = { authorHandle: string; isVendor: boolean; value: string; detail: string };
export type LeaderboardSkill = { rank: number; id: string; name: string; authorHandle: string; stars: number; installs: number; githubUrl: string };
export type LeaderboardCategory = { id: LeaderboardCategoryId; title: string; subtitle: string; rows: LeaderboardCreator[] };
export type AllRounder = { authorHandle: string; isVendor: boolean; skillCount: number; totalStars: number; totalInstalls: number; trophies: string[] };
export type Leaderboards = { generatedAt: string; topSkills: LeaderboardSkill[]; creatorCategories: LeaderboardCategory[]; allRounders: AllRounder[] };

const invalid = () => new Error("Leaderboard data is unavailable. Please try again.");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw invalid();
  return value;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}
function handle(value: unknown) {
  const authorHandle = text(value, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(authorHandle)) throw invalid();
  return authorHandle;
}
function author(source: Record<string, unknown>) {
  const authorHandle = handle(source.authorHandle);
  if (typeof source.isVendor !== "boolean") throw invalid();
  return { authorHandle, isVendor: source.isVendor };
}
function unique<T>(items: T[], key: (item: T) => string) {
  if (new Set(items.map(key)).size !== items.length) throw invalid();
  return items;
}
export function parseLeaderboards(value: unknown): Leaderboards {
  const source = object(value);
  const generatedAt = text(source.generatedAt, 100);
  if (source.version !== 1 || !Number.isFinite(Date.parse(generatedAt))) throw invalid();
  const topSkills = unique(array(source.topSkills, 100).map(value => {
    const row = object(value);
    const authorHandle = handle(row.authorHandle);
    const rank = count(row.rank), id = text(row.id), name = text(row.name, 300);
    const url = new URL(text(row.githubUrl));
    if (!rank || /[\x00-\x1f\x7f]/.test(id) || url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) throw invalid();
    return { rank, id, name, authorHandle, stars: count(row.stars), installs: count(row.installs), githubUrl: url.href };
  }), row => row.id);
  const creatorCategories = unique(array(source.creatorCategories, 6).map(value => {
    const row = object(value);
    if (!leaderboardCategoryIds.includes(row.id as LeaderboardCategoryId)) throw invalid();
    return { id: row.id as LeaderboardCategoryId, title: text(row.title, 100), subtitle: text(row.subtitle, 300),
      rows: unique(array(row.rows, 100).map(value => {
        const creator = object(value);
        return { ...author(creator), value: text(creator.value, 300), detail: text(creator.detail) };
      }), row => row.authorHandle.toLowerCase()),
    };
  }), row => row.id);
  if (creatorCategories.length !== leaderboardCategoryIds.length) throw invalid();
  const allRounders = unique(array(source.allRounders, 2500).map(value => {
    const row = object(value);
    return { ...author(row), skillCount: count(row.skillCount), totalStars: count(row.totalStars), totalInstalls: count(row.totalInstalls),
      trophies: array(row.trophies, 6).map(value => text(value, 100)),
    };
  }), row => row.authorHandle.toLowerCase());
  return { generatedAt, topSkills, creatorCategories, allRounders };
}
export function leaderboardAssetPath(manifest: unknown) {
  const path = text(object(object(manifest).leaderboardViewData).path, 150);
  if (!/^leaderboard-view-data(?:-[a-f0-9]{12,64})?\.json$/.test(path)) throw invalid();
  return `/data/v2/${path}`;
}
export function leaderboardRows<T extends { isVendor: boolean }>(rows: T[], includeCompanies: boolean) {
  return rows.filter(row => includeCompanies || !row.isVendor);
}
export function createLeaderboardLoader(fetcher: typeof fetch = (input, init) => fetch(input, init), now = Date.now) {
  let cached: { at: number; promise: Promise<Leaderboards> } | undefined;
  async function json(path: string, max: number) {
    const response = await fetcher(path, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      cache: "no-cache", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw invalid();
    const reader = response.body?.getReader();
    if (!reader) throw invalid();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); throw invalid(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return function load(): Promise<Leaderboards> {
    if (cached && now() >= cached.at && now() - cached.at < 600_000) return cached.promise;
    const promise = (async () => parseLeaderboards(await json(leaderboardAssetPath(await json("/data/v2/manifest.json", 100_000)), 1_000_000)))();
    const entry = { at: now(), promise };
    cached = entry;
    void promise.catch(() => { if (cached === entry) cached = undefined; });
    return promise;
  };
}
export const loadLeaderboards = createLeaderboardLoader();

import { createHash } from "node:crypto";
import { OmgskillsLibrary, slimSkill, type GoldBasketEntry, type SearchOptions, type Skill, type SkillResult, type TrendingEntry } from "./library.js";
import type { CatalogReader } from "./catalog-reader.js";
import type { PageOptions, PagedSearchOptions, SkillPage } from "./paging.js";
import type { RankedSearchOptions } from "./search-ranking.js";
import {
  assetReference, descriptor, detailBucket, detailIndex, object, searchCatalogLimits,
  searchPayload, rankingPayload, validateShard, verifyBytes,
  type AssetReference, type DetailIndex, type RawSkill, type SearchDescriptor,
} from "./search-catalog-format.mjs";

export const defaultGoldBasketUrl = "https://raw.githubusercontent.com/jonslimak/omgskills/main/index/gold-basket.json";
export type CatalogReadOptions = { fetcher?: typeof fetch; goldBasketUrl?: string; cacheBytes?: number; ranking?: boolean };
type Manifest = { skills: AssetReference; searchCatalog?: AssetReference; trending?: AssetReference };

function assetUrl(manifestUrl: string, ref: AssetReference) {
  assetReference(ref);
  const url = new URL(ref.path, manifestUrl);
  if (url.origin !== new URL(manifestUrl).origin) throw new Error("Catalog asset must stay on its origin");
  return url.href;
}
async function json(url: string, fetcher: typeof fetch, limit: number, ref?: AssetReference): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Unsafe catalog URL");
  const response = await fetcher(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new Error("Catalog fetch failed");
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Catalog response exceeds byte limit"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty catalog response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Catalog response exceeds byte limit"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  if (ref) verifyBytes(bytes, ref);
  return JSON.parse(bytes.toString("utf8"));
}
async function manifestAt(url: string, fetcher: typeof fetch): Promise<Manifest> {
  return object(await json(url, fetcher, searchCatalogLimits.metadata)) as Manifest;
}
async function signals(manifestUrl: string, manifest: Manifest, options: CatalogReadOptions) {
  const fetcher = options.fetcher ?? fetch;
  let complete = true;
  const optional = async <T>(load: () => Promise<unknown>): Promise<T[]> => {
    try { const result = await load(); if (!Array.isArray(result)) throw new Error("Catalog signal must be an array"); return result; }
    catch { complete = false; return []; }
  };
  const [trending, goldBasket] = await Promise.all([
    manifest.trending ? optional<TrendingEntry>(() => json(assetUrl(manifestUrl, manifest.trending!), fetcher, 16 * 1024 * 1024, manifest.trending)) : Promise.resolve([]),
    optional<GoldBasketEntry>(() => json(options.goldBasketUrl ?? defaultGoldBasketUrl, fetcher, 16 * 1024 * 1024)),
  ]);
  return { trending, goldBasket, complete };
}
function version(manifest: Manifest, gold: GoldBasketEntry[]) {
  return [JSON.stringify(assetReference(manifest.skills)), JSON.stringify(manifest.searchCatalog ?? null), JSON.stringify(manifest.trending ?? null),
    createHash("sha256").update(JSON.stringify(gold)).digest("hex")].join("|");
}

export class SearchCatalogReader implements CatalogReader {
  private readonly expected = new Map<string, Map<string, RawSkill>>();
  private readonly cache = new Map<string, { records: Map<string, RawSkill>; bytes: number }>();
  private readonly recordCache = new Map<string, { record: RawSkill; bytes: number }>();
  private readonly recordBudget: number;
  private readonly pending = new Map<string, Promise<Map<string, RawSkill>>>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;
  private cachedBytes = 0;
  private recordCacheBytes = 0;
  private recordCacheHits = 0;
  private fetchedShards = 0;
  private fetchedBytes = 0;
  private cacheHits = 0;
  readonly version: string | undefined;
  private readonly index: OmgskillsLibrary;
  private constructor(private readonly manifestUrl: string, private readonly desc: SearchDescriptor,
    private readonly details: DetailIndex, rows: RawSkill[], signalData: Awaited<ReturnType<typeof signals>>,
    private readonly options: CatalogReadOptions, manifest: Manifest, collectionIds?: ReadonlySet<string>) {
    this.version = signalData.complete ? version(manifest, signalData.goldBasket) : undefined;
    this.recordBudget = collectionIds === undefined ? 0 : Math.min(1024 * 1024, Math.floor((options.cacheBytes ?? 32 * 1024 * 1024) / 8));
    this.index = OmgskillsLibrary.fromData({ skills: rows as Skill[], trending: signalData.trending, goldBasket: signalData.goldBasket }, this.version,
      { ranking: collectionIds !== undefined, collectionLikeIds: collectionIds });
    for (const row of rows) {
      const bucket = detailBucket(row.id);
      if (!this.expected.has(bucket)) this.expected.set(bucket, new Map());
      this.expected.get(bucket)!.set(row.id, row);
    }
    if (this.expected.size !== Object.keys(details.shards).length || [...this.expected.keys()].some(key => !details.shards[key])) throw new Error("Detail index membership mismatch");
  }
  static async load(manifestUrl: string, manifest: Manifest, options: CatalogReadOptions = {}) {
    if (options.cacheBytes !== undefined && (!Number.isSafeInteger(options.cacheBytes) || options.cacheBytes < 0 || options.cacheBytes > 32 * 1024 * 1024)) throw new Error("Invalid detail cache budget");
    const fetcher = options.fetcher ?? fetch;
    const ref = assetReference(manifest.searchCatalog, searchCatalogLimits.metadata);
    const desc = descriptor(await json(assetUrl(manifestUrl, ref), fetcher, ref.bytes, ref), manifest.skills);
    const [rawSearch, rawIndex, signalData] = await Promise.all([
      json(assetUrl(manifestUrl, desc.search), fetcher, desc.search.bytes, desc.search),
      json(assetUrl(manifestUrl, desc.details), fetcher, desc.details.bytes, desc.details),
      signals(manifestUrl, manifest, options),
    ]);
    const rows = searchPayload(rawSearch, desc).skills;
    const collectionIds = options.ranking && desc.ranking ? new Set(rankingPayload(
      await json(assetUrl(manifestUrl, desc.ranking), fetcher, desc.ranking.bytes, desc.ranking), desc, new Set(rows.map(row => row.id))).collectionLikeIds) : undefined;
    return new SearchCatalogReader(manifestUrl, desc, detailIndex(rawIndex, desc), rows, signalData, options, manifest, collectionIds);
  }
  getStats() { return this.index.getStats(); }
  diagnostics() {
    return { mode: "compact", snapshot: this.desc.sourceSkills.sha256, indexBytes: this.desc.search.bytes + this.desc.details.bytes,
      detailFetches: this.fetchedShards, detailBytes: this.fetchedBytes, detailCacheBytes: this.cachedBytes + this.recordCacheBytes,
      detailCacheHits: this.cacheHits, shardCacheBytes: this.cachedBytes, recordCacheBytes: this.recordCacheBytes, recordCacheHits: this.recordCacheHits,
      rankingBytes: this.options.ranking ? this.desc.ranking?.bytes ?? 0 : 0 };
  }
  private async gated<T>(work: () => Promise<T>) {
    if (this.active >= 4) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await work(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
  private shard(bucket: string) {
    const ref = this.details.shards[bucket];
    if (!ref) return Promise.resolve(new Map<string, RawSkill>());
    const hit = this.cache.get(ref.sha256);
    if (hit) {
      this.cache.delete(ref.sha256); this.cache.set(ref.sha256, hit); this.cacheHits++;
      return Promise.resolve(hit.records);
    }
    const inflight = this.pending.get(ref.sha256);
    if (inflight) return inflight;
    const work = this.gated(async () => {
      this.fetchedShards++; this.fetchedBytes += ref.bytes;
      const rows = await json(assetUrl(this.manifestUrl, ref), this.options.fetcher ?? fetch, ref.bytes, ref);
      const records = validateShard(rows, bucket, this.expected.get(bucket)!);
      const budget = (this.options.cacheBytes ?? 32 * 1024 * 1024) - this.recordBudget;
      if (ref.bytes <= budget) {
        while (this.cachedBytes + ref.bytes > budget && this.cache.size) {
          const key = this.cache.keys().next().value!;
          this.cachedBytes -= this.cache.get(key)!.bytes; this.cache.delete(key);
        }
        this.cache.set(ref.sha256, { records, bytes: ref.bytes }); this.cachedBytes += ref.bytes;
      }
      return records;
    });
    const settled = work.then(records => { this.pending.delete(ref.sha256); return records; }, error => { this.pending.delete(ref.sha256); throw error; });
    this.pending.set(ref.sha256, settled);
    return settled;
  }
  private rememberRecord(id: string, record: RawSkill | undefined) {
    if (!record || !this.recordBudget) return record;
    const hit = this.recordCache.get(id);
    if (hit) { this.recordCache.delete(id); this.recordCache.set(id, hit); return hit.record; }
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (bytes > this.recordBudget) return record;
    while (this.recordCacheBytes + bytes > this.recordBudget && this.recordCache.size) {
      const key = this.recordCache.keys().next().value!;
      this.recordCacheBytes -= this.recordCache.get(key)!.bytes; this.recordCache.delete(key);
    }
    this.recordCache.set(id, { record, bytes }); this.recordCacheBytes += bytes;
    return record;
  }
  async getRawRecord(id: string, signal?: AbortSignal): Promise<RawSkill | undefined> {
    signal?.throwIfAborted();
    const bucket = detailBucket(id);
    if (!this.expected.get(bucket)?.has(id)) return undefined;
    const hit = this.recordCache.get(id);
    if (hit) {
      this.recordCache.delete(id); this.recordCache.set(id, hit); this.recordCacheHits++;
      return hit.record;
    }
    // Individual cancellation never aborts a shared fetch needed by another consumer.
    const result = this.shard(bucket).then(rows => this.rememberRecord(id, rows.get(id)));
    if (!signal) return result;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      result.then(value => { signal.removeEventListener("abort", abort); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    });
  }
  private async hydrate(rows: SkillResult[]) {
    return Promise.all(rows.map(async row => {
      const raw = await this.getRawRecord(row.id);
      return raw ? { ...row, ...slimSkill(raw as Skill) } : row;
    }));
  }
  async getSkill(id: string) {
    const row = this.index.getSkill(id);
    return row ? (await this.hydrate([row]))[0] : undefined;
  }
  searchSkills(options: SearchOptions) { return this.hydrate(this.index.searchSkills(options)); }
  async searchWithNote(options: SearchOptions) {
    const result = this.index.searchWithNote(options);
    return { ...result, skills: await this.hydrate(result.skills) };
  }
  relatedSkills(id: string, limit?: number) { return this.index.relatedSkills(id, limit); }
  listTrending(limit?: number) { return this.hydrate(this.index.listTrending(limit)); }
  // Curated rows retain the curated record, even when their ID also exists in the catalog.
  listGoldBasket(limit?: number) { return this.index.listGoldBasket(limit); }
  listByAuthor(author: string, limit?: number) { return this.hydrate(this.index.listByAuthor(author, limit)); }
  private async hydratePage(result: SkillPage): Promise<SkillPage> {
    return { ...result, skills: await this.hydrate(result.skills) };
  }
  searchPage(options: PagedSearchOptions) { return this.hydratePage(this.index.searchPage(options)); }
  searchRankedPage(options: RankedSearchOptions) { return this.hydratePage(this.index.searchRankedPage(options)); }
  listByAuthorPage(author: string, options: PageOptions) { return this.hydratePage(this.index.listByAuthorPage(author, options)); }
  listTrendingPage(options: Omit<PageOptions, "sort">) { return this.hydratePage(this.index.listTrendingPage(options)); }
  // The search projection already holds every list field, so summary reads skip detail shards entirely.
  // A cold 30-result search otherwise fetches and parses up to ~30 shards (~290 KB each).
  summaryReader(): CatalogReader {
    const index = this.index;
    return {
      getSkill: id => index.getSkill(id),
      searchSkills: options => index.searchSkills(options),
      searchWithNote: options => index.searchWithNote(options),
      relatedSkills: (id, limit) => index.relatedSkills(id, limit),
      listTrending: limit => index.listTrending(limit),
      listGoldBasket: limit => index.listGoldBasket(limit),
      listByAuthor: (author, limit) => index.listByAuthor(author, limit),
      searchPage: options => index.searchPage(options),
      searchRankedPage: options => index.searchRankedPage(options),
      listByAuthorPage: (author, options) => index.listByAuthorPage(author, options),
      listTrendingPage: options => index.listTrendingPage(options),
      getStats: () => this.getStats(),
      diagnostics: () => this.diagnostics(),
    };
  }
}

export async function loadCatalogReader(manifestUrl: string, options: CatalogReadOptions = {}): Promise<SearchCatalogReader | OmgskillsLibrary> {
  const fetcher = options.fetcher ?? fetch;
  const manifest = await manifestAt(manifestUrl, fetcher);
  if (manifest.searchCatalog) return SearchCatalogReader.load(manifestUrl, manifest, options);
  return OmgskillsLibrary.load({ manifestUrl, goldBasketUrl: options.goldBasketUrl,
    fetcher: (input, init) => String(input) === manifestUrl ? Promise.resolve(Response.json(manifest)) : fetcher(input, init),
    allowMissingTrending: true, allowMissingGoldBasket: true, ranking: options.ranking });
}
export async function readCatalogVersion(manifestUrl: string, options: CatalogReadOptions = {}) {
  const manifest = await manifestAt(manifestUrl, options.fetcher ?? fetch);
  if (!manifest.searchCatalog) return OmgskillsLibrary.readVersion(manifestUrl, options.fetcher ?? fetch, options.goldBasketUrl);
  const gold = await json(options.goldBasketUrl ?? defaultGoldBasketUrl, options.fetcher ?? fetch, 16 * 1024 * 1024);
  if (!Array.isArray(gold)) throw new Error("Invalid curated catalog");
  assetReference(manifest.searchCatalog, searchCatalogLimits.metadata);
  return version(manifest, gold);
}

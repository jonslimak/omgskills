import type { CatalogDisplay, CatalogSummary, Navigation } from "./model";
import { discoveryCategories } from "./discovery-categories";

export const LIST_LIMIT = 30;
export const emptyCatalog = (): CatalogDisplay => ({
  skills: [], collections: [], creators: [], categories: discoveryCategories, trendingIds: [], resultIds: [],
});
type RecordValue = Record<string, unknown>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Pending = { controller: AbortController; promise: Promise<unknown>; users: number };

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The catalog returned an invalid response.");
  return value as RecordValue;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("The catalog returned an invalid response.");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("The catalog returned an invalid list.");
  return value;
}
function optionalText(value: unknown) { return typeof value === "string" ? value : ""; }
function handle(value: string) { return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(value); }
function avatar(author: string) { return `https://github.com/${encodeURIComponent(author)}.png?size=80`; }
function safeGithub(value: unknown): string {
  const url = new URL(text(value));
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) throw new Error("The catalog returned an invalid source link.");
  return url.href;
}
function parseSkill(value: unknown): CatalogSummary {
  const skill = record(value);
  const id = text(skill.id), name = text(skill.name), author = text(skill.author_handle);
  if (!id || !name || !handle(author)) throw new Error("The catalog returned an invalid skill.");
  if (skill.stars !== undefined && (typeof skill.stars !== "number" || !Number.isFinite(skill.stars) || skill.stars < 0)) throw new Error("The catalog returned invalid skill statistics.");
  return {
    id, name, author, description: text(skill.description), githubUrl: safeGithub(skill.github_url),
    stars: skill.stars as number | undefined, tags: strings(skill.tags ?? []), avatar: avatar(author),
  };
}
export function parseCollections(value: unknown): CatalogDisplay {
  const source = record(value);
  if (!Array.isArray(source.collections) || source.collections.length > 500) throw new Error("The catalog returned invalid collections.");
  const catalog = emptyCatalog();
  for (const value of source.collections) {
    const item = record(value);
    const id = text(item.id), name = text(item.title);
    if (!id || !name) throw new Error("The catalog returned an unnamed collection.");
    if (item.type === "author") {
      const author = text(item.authorHandle);
      if (!handle(author)) throw new Error("The catalog returned an invalid creator.");
      catalog.creators.push({ handle: author, name, tagline: optionalText(item.subtitle) || optionalText(item.description), avatar: avatar(author) });
    } else if (item.type === "topic") {
      const skillIds = [...new Set(strings(item.skillIds ?? item.featuredSkillIds ?? []))];
      if (skillIds.length > 1000) throw new Error("This collection is too large to display.");
      catalog.collections.push({ id, name, description: optionalText(item.subtitle) || optionalText(item.description), skillIds,
        authors: [...new Set(skillIds.map((id) => id.split("/")[0]).filter(handle))].slice(0, 3).map((handle) => ({ handle, avatar: avatar(handle) })),
      });
    }
  }
  return catalog;
}
export function collectionAssetPath(manifest: unknown, track: "crawl4" | "v2") {
  const path = text(record(record(manifest).collections).path);
  if (!/^collections(?:-[a-f0-9]+)?\.json$/.test(path)) throw new Error("The catalog manifest has an invalid collection path.");
  return `/data/${track}/${path}`;
}

export class PublicCatalogClient {
  private cache = new Map<string, { at: number; value: unknown }>();
  private pending = new Map<string, Pending>();
  private requestId = 0;
  constructor(private fetcher: Fetcher = (input, init) => fetch(input, init), private timeoutMs = 15_000) {}

  // Share in-flight public reads, but cancel upstream when the last consumer leaves.
  private cached<T>(key: string, load: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 120_000) return Promise.resolve(hit.value as T);
    let entry = this.pending.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const fresh: Pending = { controller, users: 0, promise: Promise.resolve() };
      fresh.promise = load(controller.signal).then((value) => {
        if (!controller.signal.aborted && value !== null) {
          this.cache.delete(key);
          this.cache.set(key, { at: Date.now(), value });
          while (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value!);
        }
        if (this.pending.get(key) === fresh) this.pending.delete(key);
        return value;
      }, (error) => {
        if (this.pending.get(key) === fresh) this.pending.delete(key);
        throw error;
      });
      this.pending.set(key, fresh);
      entry = fresh;
    }
    const active = entry;
    active.users++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const done = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener("abort", abort);
        if (--active.users === 0 && this.pending.get(key) === active) active.controller.abort();
        return true;
      };
      const abort = () => { if (done()) reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      active.promise.then((value) => { if (done()) resolve(value as T); }, (error) => { if (done()) reject(error); });
    });
  }

  private async json(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const response = await this.fetcher(path, {
        method: body ? "POST" : "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        headers: body ? { "Content-Type": "application/json", Accept: "application/json, text/event-stream" } : { Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 429 ? "The catalog is busy. Please try again shortly." : `The catalog is unavailable (${response.status}). Try again.`);
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The catalog route did not return JSON. Check the local public-data proxy.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The catalog returned an empty response.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); throw new Error("The catalog response is too large."); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new Error("The catalog returned invalid JSON."); }
    } catch (error) {
      if (timedOut) throw new Error("The catalog took too long to respond. Try again.");
      if (signal.aborted) throw signal.reason;
      if (error instanceof TypeError) throw new Error("Could not reach the catalog. Check your connection and try again.");
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }

  private async tool(name: string, args: RecordValue, signal: AbortSignal): Promise<unknown> {
    const id = ++this.requestId;
    const envelope = record(await this.json("/mcp", signal, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }));
    if (envelope.id !== id || envelope.error) throw new Error("The catalog request failed. Try again.");
    const result = record(envelope.result);
    if (result.isError) throw new Error("The catalog could not complete this request. Try again.");
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = result.content;
    if (!Array.isArray(content)) throw new Error("The catalog returned an invalid tool result.");
    const block = content.find((item) => item?.type === "text");
    try {
      const parsed: unknown = JSON.parse(text(block?.text));
      if (name === "get_skill") return record(parsed).error ? { found: false, skill: null } : { found: true, skill: parsed };
      return { skills: parsed };
    } catch { throw new Error("The catalog returned an invalid tool result."); }
  }

  metadata(signal: AbortSignal) {
    return this.cached("metadata", async (signal) => {
      for (const track of ["crawl4", "v2"] as const) {
        try {
          const manifest = await this.json(`/data/${track}/manifest.json`, signal);
          return parseCollections(await this.json(collectionAssetPath(manifest, track), signal));
        } catch (error) { if (signal.aborted || track === "v2") throw error; }
      }
      throw new Error("Collections are unavailable.");
    }, signal);
  }
  list(name: "search_skills" | "list_trending" | "list_by_author", args: RecordValue, signal: AbortSignal) {
    const input = { ...args, limit: Math.min(LIST_LIMIT, Math.max(1, Number(args.limit) || LIST_LIMIT)) };
    return this.cached(`list:${name}:${JSON.stringify(input)}`, async (signal) => {
      const payload = record(await this.tool(name, input, signal));
      if (!Array.isArray(payload.skills) || payload.skills.length > input.limit) throw new Error("The catalog returned an invalid result list.");
      const skills = payload.skills.map(parseSkill);
      return [...new Map(skills.map((skill) => [skill.id, skill])).values()];
    }, signal);
  }
  skill(id: string, signal: AbortSignal) {
    return this.cached(`skill:${id}`, async (signal) => {
      const payload = record(await this.tool("get_skill", { id }, signal));
      if (payload.found === false) return null;
      if (payload.found !== true) throw new Error("The catalog returned an invalid skill result.");
      const skill = parseSkill(payload.skill);
      if (skill.id !== id) throw new Error("The catalog returned a different skill.");
      return skill;
    }, signal);
  }
  async publicUrl(id: string, signal: AbortSignal) {
    const links = await this.cached("links", async (signal) => record(record(await this.json("/catalog-skill-urls.json", signal)).skills), signal);
    const path = links[id];
    if (typeof path !== "string" || !/^\/(skills|library)\/[^?#\\]+\/$/.test(path) || path.includes("..") || /%2[ef]/i.test(path)) return undefined;
    return `https://omgskills.com${path}`;
  }
  async collection(ids: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const requested = ids.slice(0, LIST_LIMIT);
    const results: (CatalogSummary | null)[] = new Array(requested.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < requested.length) {
        controller.signal.throwIfAborted();
        const index = cursor++;
        results[index] = await this.skill(requested[index], controller.signal);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, requested.length) }, worker));
      return { skills: results.filter((skill): skill is CatalogSummary => !!skill), missing: results.filter((skill) => !skill).length, limited: ids.length > LIST_LIMIT };
    } finally {
      controller.abort();
      signal.removeEventListener("abort", abort);
    }
  }
}

export function publicScope(nav: Navigation) {
  if (nav.query.trim()) return `search:${nav.query.trim()}`;
  return `${nav.view}:${nav.id}`;
}

export async function loadPublicView(client: PublicCatalogClient, nav: Navigation, signal: AbortSignal) {
  const catalog = await client.metadata(signal);
  let skills: CatalogSummary[] = [], note = "";
  const categoryTerm = nav.view === "category" && discoveryCategories.some((group) => group.items.includes(nav.id)) ? nav.id : "";
  const query = nav.query.trim() || categoryTerm;
  if (query) skills = await client.list("search_skills", { query }, signal);
  else if (nav.view === "top" || nav.view === "discover") skills = await client.list("list_trending", { limit: nav.view === "discover" ? 9 : LIST_LIMIT }, signal);
  else if (nav.view === "creator") {
    if (!handle(nav.id)) throw new Error("This creator could not be found.");
    skills = await client.list("list_by_author", { author: nav.id }, signal);
  } else if (nav.view === "collection") {
    const collection = catalog.collections.find((item) => item.id === nav.id);
    if (!collection) throw new Error("This collection could not be found.");
    const result = await client.collection(collection.skillIds, signal);
    skills = result.skills;
    note = [result.limited ? `Showing the first ${LIST_LIMIT} collection entries.` : "", result.missing ? `${result.missing} collection entries are no longer available in the catalog.` : ""].filter(Boolean).join(" ");
  }
  if ((query || nav.view === "creator" || nav.view === "top") && skills.length === LIST_LIMIT) note = `Showing up to ${LIST_LIMIT} results${query ? ". Refine your search for more specific matches." : "."}`;
  return { catalog: { ...catalog, skills, resultIds: skills.map((skill) => skill.id), trendingIds: !query && ["top", "discover"].includes(nav.view) ? skills.map((skill) => skill.id) : [] }, note };
}

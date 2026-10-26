import type { CatalogDisplay, CatalogSummary, Navigation } from "./model";
import { discoveryCategories } from "./discovery-categories";
import { parsePageInfo, publicPageRequest, PublicCatalogError, type PublicPage, type PublicPageInfo, type PublicPageRequest, type PublicListTool } from "./public-paging";

export const LIST_LIMIT = 30;
export const emptyCatalog = (): CatalogDisplay => ({
  skills: [], collections: [], creators: [], categories: discoveryCategories, trendingIds: [], resultIds: [],
});
type RecordValue = Record<string, unknown>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Pending = { controller: AbortController; promise: Promise<unknown>; users: number };
type PublicView = { catalog: CatalogDisplay; note: string; page?: PublicPageInfo };
type Capabilities = Record<PublicListTool, { paging: boolean; ranking: boolean; summary: boolean }>;
type StoredCapabilities = { at: number; value: Capabilities };
// Persist positive hints for startup, but revalidate them and never persist unavailable capabilities.
const CAPABILITIES_KEY = "omgskills-catalog-capabilities";
const CAPABILITIES_MEMORY_MS = 3_600_000, CAPABILITIES_STORED_MS = 86_400_000;
function hasPagedSearch(value: Capabilities) {
  return value.search_skills.paging && value.search_skills.ranking && value.list_by_author.paging && value.list_trending.paging;
}
function storedCapabilities(now: number): StoredCapabilities | undefined {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(CAPABILITIES_KEY) ?? "null");
    if (!stored || !Number.isFinite(stored.at) || now - stored.at > CAPABILITIES_STORED_MS || now < stored.at) return undefined;
    const tools = ["search_skills", "list_by_author", "list_trending"] as const;
    if (!tools.every(name => ["paging", "ranking", "summary"].every(key => typeof stored.value?.[name]?.[key] === "boolean"))) return undefined;
    const value = Object.fromEntries(tools.map(name => [name, {
      paging: stored.value[name].paging, ranking: stored.value[name].ranking, summary: stored.value[name].summary,
    }])) as Capabilities;
    return hasPagedSearch(value) ? { at: stored.at, value } : undefined;
  } catch { return undefined; }
}
function storeCapabilities(value: Capabilities | undefined, now: number) {
  try {
    if (value && hasPagedSearch(value)) globalThis.localStorage?.setItem(CAPABILITIES_KEY, JSON.stringify({ at: now, value }));
    else globalThis.localStorage?.removeItem(CAPABILITIES_KEY);
  } catch { /* Storage is an optimization only. */ }
}
export type PublicViewProgress =
  | { section: "metadata"; state: "ready"; catalog: CatalogDisplay }
  | { section: "list"; state: "ready"; skills: CatalogSummary[]; page?: PublicPageInfo; note?: string }
  | { section: "metadata" | "list"; state: "error"; error: unknown };

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
function collectionImage(value: unknown, id: string): string | undefined {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return;
  try {
    const url = new URL(value);
    if (url.origin !== "https://omgskills.com" || url.username || url.password || url.hash
      || url.pathname !== `/images/collections/${id}.webp`
      || [...url.searchParams.keys()].some(key => key !== "v")
      || url.searchParams.getAll("v").length > 1
      || (url.searchParams.has("v") && !/^[a-f0-9]{12}$/.test(url.searchParams.get("v")!))) return;
    return url.href;
  } catch { return; }
}
// Only a plain one-line clone command is offered for copying.
function installCommand(value: unknown) {
  const command = optionalText(value);
  return command && command.length <= 500 && command.startsWith("git clone https://github.com/") && !/[\x00-\x1f\x7f]/.test(command) ? command : undefined;
}
function parseSkill(value: unknown): CatalogSummary {
  const skill = record(value);
  const id = text(skill.id), name = text(skill.name), author = text(skill.author_handle);
  // Some source records have no author; do not infer one from a mirror URL.
  if (!id || !name || (author !== "" && !handle(author))) throw new Error("The catalog returned an invalid skill.");
  if (skill.stars !== undefined && (typeof skill.stars !== "number" || !Number.isFinite(skill.stars) || skill.stars < 0)) throw new Error("The catalog returned invalid skill statistics.");
  return {
    id, name, author, description: text(skill.description), githubUrl: safeGithub(skill.github_url),
    skillMDPath: optionalText(skill.skill_md_path) || undefined,
    hasPinnedInstall: skill.pinned_install != null || skill.repo_commit_sha != null || skill.skill_tree_sha != null,
    installCommand: installCommand(skill.install_cmd),
    stars: skill.stars as number | undefined, tags: strings(skill.tags ?? []), avatar: author ? avatar(author) : undefined,
  };
}
export function parseCollections(value: unknown): CatalogDisplay {
  const source = record(value);
  if (!Array.isArray(source.collections) || source.collections.length > 1000) throw new Error("The catalog returned invalid collections.");
  const catalog = emptyCatalog();
  for (const value of source.collections) {
    const item = record(value);
    const id = text(item.id), name = text(item.title);
    if (!id || !name) throw new Error("The catalog returned an unnamed collection.");
    if (item.type === "author") {
      const author = text(item.authorHandle);
      if (!handle(author)) throw new Error("The catalog returned an invalid creator.");
      if (item.isCompany !== undefined && typeof item.isCompany !== "boolean") throw new Error("The catalog returned an invalid creator classification.");
      catalog.creators.push({ handle: author, name, tagline: optionalText(item.subtitle) || optionalText(item.description), avatar: avatar(author),
        ...(item.isCompany === undefined ? {} : { isCompany: item.isCompany }) });
    } else if (item.type === "topic") {
      const skillIds = [...new Set(strings(item.skillIds ?? item.featuredSkillIds ?? []))];
      if (skillIds.length > 1000) throw new Error("This collection is too large to display.");
      catalog.collections.push({ id, name, description: optionalText(item.subtitle) || optionalText(item.description), skillIds,
        imageUrl: collectionImage(item.imageUrl, id),
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
  private views = new Map<string, { at: number; value: PublicView }>();
  constructor(private fetcher: Fetcher = (input, init) => fetch(input, init), private timeoutMs = 15_000, private now = Date.now,
    readonly pagingEnabled = false) {
    const stored = storedCapabilities(this.now());
    if (stored) this.cache.set("capabilities", stored);
  }

  /** Start capability discovery at startup so the first search does not wait for it. */
  warm() {
    if (!this.pagingEnabled) return;
    this.capabilities(new AbortController().signal, true).catch(() => { /* The first real request retries and reports errors. */ });
  }

  cachedView(nav: Navigation) {
    const key = publicScope(nav), hit = this.views.get(key);
    if (hit && this.now() - hit.at < 600_000) return hit.value;
    this.views.delete(key);
    return undefined;
  }

  rememberView(nav: Navigation, value: PublicView) {
    const key = publicScope(nav);
    this.views.delete(key);
    this.views.set(key, { at: this.now(), value });
    while (this.views.size > 20 || [...this.views.values()].reduce((sum, view) => sum + view.value.catalog.skills.length, 0) > 600) this.views.delete(this.views.keys().next().value!);
    return value;
  }

  private remember(key: string, value: unknown) {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), value });
    while (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value!);
  }

  // Share in-flight public reads, but cancel upstream when the last consumer leaves.
  private cached<T>(key: string, load: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, ttl = 120_000): Promise<T> {
    signal.throwIfAborted();
    const hit = this.cache.get(key);
    if (ttl > 0 && hit && this.now() - hit.at < ttl) return Promise.resolve(hit.value as T);
    let entry = this.pending.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const fresh: Pending = { controller, users: 0, promise: Promise.resolve() };
      fresh.promise = load(controller.signal).then((value) => {
        if (!controller.signal.aborted && value !== null) {
          this.remember(key, value);
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

  private async rpc(method: string, params: RecordValue, signal: AbortSignal): Promise<RecordValue> {
    const id = ++this.requestId;
    const envelope = record(await this.json("/mcp", signal, { jsonrpc: "2.0", id, method, params }));
    if (envelope.id !== id || envelope.error) throw new Error("The catalog request failed. Try again.");
    return record(envelope.result);
  }

  private async tool(name: string, args: RecordValue, signal: AbortSignal): Promise<unknown> {
    const result = await this.rpc("tools/call", { name, arguments: args }, signal);
    if (result.isError) {
      const block = Array.isArray(result.content) ? result.content.find(item => item?.type === "text") : undefined;
      let code = "catalog_unavailable";
      try {
        const error = record(record(JSON.parse(text(block?.text))).error);
        if (["catalog_snapshot_changed", "invalid_cursor", "ranking_not_supported", "paging_not_supported"].includes(String(error.code))) code = String(error.code);
      } catch { /* Do not expose arbitrary server error text. */ }
      throw new PublicCatalogError(code, code === "catalog_snapshot_changed" ? "The catalog changed. Refresh these results." : undefined);
    }
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = result.content;
    if (!Array.isArray(content)) throw new Error("The catalog returned an invalid tool result.");
    const block = content.find((item) => item?.type === "text");
    try {
      const parsed: unknown = JSON.parse(text(block?.text));
      if (name === "get_skill") return record(parsed).error ? { found: false, skill: null } : { found: true, skill: parsed };
      if (!Array.isArray(parsed) && parsed && typeof parsed === "object" && "page" in parsed) return parsed;
      return { skills: parsed };
    } catch { throw new Error("The catalog returned an invalid tool result."); }
  }

  capabilities(signal: AbortSignal, refresh = false): Promise<Capabilities> {
    const hit = this.cache.get("capabilities")?.value as Capabilities | undefined;
    return this.cached("capabilities", async signal => {
      const result = await this.rpc("tools/list", {}, signal);
      if (!Array.isArray(result.tools)) throw new Error("The catalog returned invalid capabilities.");
      const tools = result.tools;
      const entries = (["search_skills", "list_by_author", "list_trending"] as const).map(name => {
        const matches = tools.filter((tool: RecordValue) => tool?.name === name);
        if (matches.length !== 1) throw new Error("The catalog returned invalid capabilities.");
        const properties = record(record(record(matches[0]).inputSchema).properties);
        const page = properties.page;
        if (page !== undefined && (!page || typeof page !== "object" || Array.isArray(page) || (page as RecordValue).type !== "object")) throw new Error("The catalog returned invalid capabilities.");
        const ranking = properties.ranking === undefined ? undefined : record(properties.ranking);
        const summary = properties.summary;
        return [name, { paging: page !== undefined,
          ranking: ranking?.type === "string" && (ranking.const === "web-v1" || (Array.isArray(ranking.enum) && ranking.enum.length === 1 && ranking.enum[0] === "web-v1")),
          summary: !!summary && typeof summary === "object" && !Array.isArray(summary) && (summary as RecordValue).type === "boolean" }];
      });
      const value = Object.fromEntries(entries) as Capabilities;
      storeCapabilities(value, this.now());
      return value;
    }, signal, refresh || (hit && !hasPagedSearch(hit)) ? 0 : CAPABILITIES_MEMORY_MS);
  }

  page(request: PublicPageRequest, signal: AbortSignal, cursor?: string): Promise<PublicPage> {
    if (!this.pagingEnabled) return Promise.reject(new PublicCatalogError("paging_not_supported"));
    return this.cached(`page:${JSON.stringify(request)}:${cursor ?? "first"}`, async signal => {
      const support = (await this.capabilities(signal))[request.name];
      if (!support.paging || (request.name === "search_skills" && !support.ranking)) throw new PublicCatalogError("paging_not_supported");
      const read = (summary: boolean) => this.tool(request.name, {
        ...request.args, page: cursor === undefined ? {} : { cursor }, ...(summary ? { summary: true } : {}),
      }, signal);
      let value: unknown;
      try { value = await read(support.summary); }
      catch (error) {
        if (!support.summary || !(error instanceof PublicCatalogError) || error.code !== "invalid_cursor") throw error;
        // A rollback can reject summary as an unknown paged argument. Retry only after confirming its removal.
        const current = (await this.capabilities(signal, true))[request.name];
        if (current.summary || !current.paging || (request.name === "search_skills" && !current.ranking)) throw error;
        value = await read(false);
      }
      const payload = record(value);
      if (!Array.isArray(payload.skills)) throw new Error("The catalog returned an invalid page.");
      const skills = payload.skills.map(parseSkill);
      if (new Set(skills.map(skill => skill.id)).size !== skills.length) throw new Error("The catalog returned duplicate skills.");
      return { skills, page: parsePageInfo(payload.page, payload.count, skills.length, request, cursor) };
    }, signal);
  }

  async firstPage(request: PublicPageRequest, signal: AbortSignal) {
    const support = (await this.capabilities(signal))[request.name];
    if (support.paging && (request.name !== "search_skills" || support.ranking)) return { ...await this.page(request, signal), note: "" };
    const { sort: _sort, ranking: _ranking, ...args } = request.args;
    return { skills: await this.list(request.name, args, signal), note: "Search upgrades are unavailable on this server. Showing up to 30 results." };
  }

  invalidateView(nav: Navigation) {
    this.views.delete(publicScope(nav));
    const request = publicPageRequest(nav);
    const pagePrefix = request ? `page:${JSON.stringify(request)}:` : "";
    const { sort: _sort, ranking: _ranking, ...args } = request?.args ?? {};
    const listKey = request ? `list:${request.name}:${JSON.stringify(args)}` : "";
    for (const key of this.cache.keys()) if ((pagePrefix && key.startsWith(pagePrefix)) || key === listKey || key === "capabilities") this.cache.delete(key);
    storeCapabilities(undefined, this.now());
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
      const payload = record(await this.tool(name, { ...input, summary: true }, signal));
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
    const requested = [...new Set(ids)].slice(0, LIST_LIMIT);
    if (!requested.length) return { skills: [], missing: 0, limited: false };
    const skills = await this.cached(`batch:${JSON.stringify(requested)}`, async signal => {
      const payload = record(await this.tool("get_skills", { ids: requested, summary: true }, signal));
      if (!Array.isArray(payload.skills) || payload.skills.length > requested.length) throw new Error("The catalog returned an invalid collection.");
      const parsed = payload.skills.map(parseSkill);
      const byId = new Map(parsed.map(skill => [skill.id, skill]));
      if (byId.size !== parsed.length || parsed.some(skill => !requested.includes(skill.id))) throw new Error("The catalog returned different collection skills.");
      signal.throwIfAborted();
      for (const skill of parsed) this.remember(`skill:${skill.id}`, skill);
      return requested.flatMap(id => byId.get(id) ?? []);
    }, signal);
    return { skills, missing: requested.length - skills.length, limited: ids.length > LIST_LIMIT };
  }
}

export function publicScope(nav: Navigation) {
  const scope = nav.query.trim() ? `search:${nav.query.trim()}` : `${nav.view}:${nav.id}`;
  const request = publicPageRequest(nav);
  return request && request.sort !== "relevance" && request.name !== "list_trending" ? `${scope}:sort:${request.sort}` : scope;
}

export async function loadPublicView(client: PublicCatalogClient, nav: Navigation, signal: AbortSignal, onProgress?: (update: PublicViewProgress) => void) {
  let note = "";
  let page: PublicPageInfo | undefined;
  const emit = (update: PublicViewProgress) => { if (!signal.aborted) onProgress?.(update); };
  const categoryTerm = nav.view === "category" && discoveryCategories.some((group) => group.items.includes(nav.id)) ? nav.id : "";
  const query = nav.query.trim() || categoryTerm;
  if (!query && nav.view === "creator" && !handle(nav.id)) throw new Error("This creator could not be found.");
  const metadata = client.metadata(signal).then(catalog => {
    emit({ section: "metadata", state: "ready", catalog });
    return catalog;
  }, error => {
    emit({ section: "metadata", state: "error", error });
    throw error;
  });
  // Only collection entries depend on metadata. Start all other lists immediately.
  const pageRequest = client.pagingEnabled ? publicPageRequest(nav) : null;
  const list = pageRequest ? client.firstPage(pageRequest, signal).then(result => { page = "page" in result ? result.page : undefined; note = result.note; return result.skills; })
    : query ? client.list("search_skills", { query }, signal)
    : nav.view === "top" || nav.view === "discover" ? client.list("list_trending", { limit: nav.view === "discover" ? 9 : LIST_LIMIT }, signal)
    : nav.view === "creator" ? client.list("list_by_author", { author: nav.id }, signal)
    : nav.view === "collection" ? metadata.then(async catalog => {
    const collection = catalog.collections.find(item => item.id === nav.id);
    if (!collection) throw new Error("This collection could not be found.");
    const result = await client.collection(collection.skillIds, signal);
    note = [result.limited ? `Showing the first ${LIST_LIMIT} collection entries.` : "", result.missing ? `${result.missing} collection entries are no longer available in the catalog.` : ""].filter(Boolean).join(" ");
    return result.skills;
  }) : Promise.resolve([] as CatalogSummary[]);
  const readyList = list.then(skills => {
    emit({ section: "list", state: "ready", skills, ...(page ? { page } : {}), ...(note ? { note } : {}) });
    return skills;
  }, error => {
    emit({ section: "list", state: "error", error });
    throw error;
  });
  // Settle both so a failure in one section cannot swallow a later success in another.
  const [metadataResult, listResult] = await Promise.allSettled([metadata, readyList]);
  signal.throwIfAborted();
  if (metadataResult.status === "rejected") throw metadataResult.reason;
  if (listResult.status === "rejected") throw listResult.reason;
  const catalog = metadataResult.value, skills = listResult.value;
  if (!page && !note && (query || nav.view === "creator") && skills.length === LIST_LIMIT) note = `Showing up to ${LIST_LIMIT} results.`;
  return client.rememberView(nav, { catalog: { ...catalog, skills, resultIds: skills.map((skill) => skill.id), trendingIds: !query && ["top", "discover"].includes(nav.view) ? skills.map((skill) => skill.id) : [] }, note, ...(page ? { page } : {}) });
}

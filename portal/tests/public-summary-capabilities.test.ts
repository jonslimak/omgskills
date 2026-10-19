import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PublicCatalogClient, loadPublicView } from "../src/app/unified/public-catalog";
import { initialNavigation } from "../src/app/unified/model";
import { publicPageRequest, PublicCatalogError, type PublicPageRequest } from "../src/app/unified/public-paging";
import { catalogFixture } from "../../mcp/test/search-catalog-fixture";
import { createConfiguredMcpHandler } from "../../netlify/functions/omgskills-mcp.mjs";
import { createCompactMcpLibraryLoader } from "../../netlify/functions/_shared/compact-mcp-library";
import { createMcpLibraryLoader } from "../../netlify/functions/_shared/mcp-library";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
}

const capabilitiesKey = "omgskills-catalog-capabilities";
const nav = { ...initialNavigation, view: "discover" as const, query: "design" };
const request = publicPageRequest(nav)!;
function installStorage(context: Pick<TestContext, "after">) {
  const storage = memoryStorage(), previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  context.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else delete (globalThis as { localStorage?: unknown }).localStorage; });
  return storage;
}
function capabilityServer() {
  const calls: { method: string; params: { name?: string; arguments?: Record<string, any> } }[] = [];
  const state = { paging: true, summary: true, pageError: "", discoveryGate: undefined as Promise<void> | undefined };
  const fetcher = async (_path: string, init?: RequestInit) => {
    const call = JSON.parse(String(init?.body)); calls.push(call);
    let result;
    if (call.method === "tools/list") {
      await state.discoveryGate;
      result = { tools: ["search_skills", "list_by_author", "list_trending"].map(name => ({ name, inputSchema: { properties: {
        ...(state.paging ? { page: { type: "object" }, ...(name === "search_skills" ? { ranking: { type: "string", const: "web-v1" } } : {}) } : {}),
        ...(state.summary ? { summary: { type: "boolean" } } : {}),
      } } })) };
    } else {
      const args = call.params.arguments;
      const code = state.pageError || (args.page && !state.summary && "summary" in args ? "invalid_cursor" : "");
      if (code) result = { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code } }) }] };
      else {
        const offset = args.page?.cursor ? 30 : 0;
        const skills = Array.from({ length: Math.min(args.limit ?? 30, 40 - offset) }, (_, i) => ({
          id: `example/skills:design-${offset + i}`, name: `design-${offset + i}`, description: "Design", author_handle: "example",
          github_url: "https://github.com/example/skills", tags: [], stars: 100,
        }));
        result = { structuredContent: { count: skills.length, skills, ...(args.page ? { page: {
          total: 40, snapshot: "a".repeat(64), sort: call.params.name === "list_trending" ? "trending" : args.sort ?? "relevance",
          hasMore: offset === 0, nextCursor: offset === 0 ? "c30" : null,
        } } : {}) } };
      }
    }
    return Response.json({ jsonrpc: "2.0", id: call.id, result });
  };
  return { calls, state, fetcher };
}

test("app list, page and collection reads use summary results without loading detail shards", async context => {
  const skills = Array.from({ length: 40 }, (_, i) => ({ id: `example/skills:design-${i}`, name: `design-${i}`, description: "Design an accessible app",
    author_handle: "example", github_url: "https://github.com/example/skills", tags: ["design"], stars: 100 + i, install_cmd: "legacy" }));
  const f = catalogFixture(context, skills, true), work: Promise<unknown>[] = [];
  const compact = createCompactMcpLibraryLoader({ ...f.options, ranking: true, tracks: [{ name: "crawl4", manifestUrl: f.url }] });
  const legacy = createMcpLibraryLoader({ loadTrack: async () => { throw new Error("Public compact reads must not initialize the full reader"); } });
  const handler = createConfiguredMcpHandler(true, { compact, legacy });
  const client = new PublicCatalogClient(async (path, init) => {
    if (path.endsWith("manifest.json")) return Response.json({ collections: { path: "collections-abcdef.json" } });
    if (path.includes("collections-")) return Response.json({ collections: [] });
    return handler(new Request("https://integration.test/mcp", init), { waitUntil: p => { work.push(p); } });
  }, 15000, Date.now, true);

  const view = await loadPublicView(client, { ...initialNavigation, view: "discover" as const, query: "design" }, new AbortController().signal);
  assert.equal(view.catalog.resultIds?.length, 30);
  const batch = await client.collection(skills.slice(0, 5).map(skill => skill.id), new AbortController().signal);
  assert.equal(batch.skills.length, 5);
  assert.equal(f.requested.filter(url => url.includes("/skill-details-")).length, 0, "summary reads must not fetch detail shards");
  await Promise.allSettled(work);
});

test("stored positive capabilities start search before startup revalidation completes", async context => {
  const storage = installStorage(context), server = capabilityServer();
  const first = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
  first.warm();
  await first.firstPage(request, new AbortController().signal);
  assert.equal(server.calls.filter(call => call.method === "tools/list").length, 1);
  assert.ok(storage.values.has(capabilitiesKey));

  server.calls.length = 0;
  let release!: () => void;
  server.state.discoveryGate = new Promise<void>(resolve => { release = resolve; });
  context.after(() => release());
  const second = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
  second.warm();
  const search = second.firstPage(request, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(server.calls.map(call => call.method), ["tools/list", "tools/call"], "a slow background recheck must not delay the cached positive search");
  release();
  assert.equal((await search).skills.length, 30);
  await second.capabilities(new AbortController().signal);

  second.invalidateView(nav);
  assert.equal(storage.values.has(capabilitiesKey), false);
});

test("paged calls omit summary unless that tool advertises it, including later pages", async () => {
  const server = capabilityServer(); server.state.summary = false;
  const client = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
  const requests: PublicPageRequest[] = [request,
    { name: "list_by_author", args: { author: "example", limit: 30, sort: "stars" }, sort: "stars" },
    { name: "list_trending", args: { limit: 30 }, sort: "trending" }];
  for (const req of requests) {
    const first = await client.page(req, new AbortController().signal);
    const next = await client.page(req, new AbortController().signal, first.page.nextCursor!);
    assert.equal(first.skills.length + next.skills.length, 40);
  }
  assert.equal(server.calls.filter(call => call.method === "tools/list").length, 1);
  for (const call of server.calls.filter(call => call.method === "tools/call")) assert.equal("summary" in call.params.arguments!, false);
});

test("a stale summary capability recovers from rollback with one confirmed full-read retry", async context => {
  installStorage(context);
  const server = capabilityServer();
  await new PublicCatalogClient(server.fetcher, 15000, Date.now, true).capabilities(new AbortController().signal);
  server.calls.length = 0; server.state.summary = false;
  const client = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
  const first = await client.firstPage(request, new AbortController().signal);
  assert.equal(first.skills.length, 30);
  const toolCalls = server.calls.filter(call => call.method === "tools/call");
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].params.arguments?.summary, true);
  assert.equal("summary" in toolCalls[1].params.arguments!, false);
  assert.equal(server.calls.filter(call => call.method === "tools/list").length, 1);
});

test("negative stored capabilities cannot hide a server's restored paging", async context => {
  const storage = installStorage(context), server = capabilityServer();
  const value = Object.fromEntries(["search_skills", "list_by_author", "list_trending"].map(name => [name, { paging: false, ranking: false, summary: false }]));
  storage.setItem(capabilitiesKey, JSON.stringify({ at: Date.now() - 23 * 3600_000, value }));
  const client = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
  client.warm();
  const first = await client.firstPage(request, new AbortController().signal);
  assert.equal(first.page?.total, 40);
  assert.equal(server.calls.filter(call => call.method === "tools/list").length, 1);
});

test("a running session rechecks unavailable capabilities on its next search without persisting them", async context => {
  const storage = installStorage(context), server = capabilityServer(); server.state.paging = false;
  const client = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
  assert.equal((await client.firstPage(request, new AbortController().signal)).page, undefined);
  assert.equal(storage.values.has(capabilitiesKey), false);
  server.state.paging = true;
  assert.equal((await client.firstPage(request, new AbortController().signal)).page?.total, 40);
  assert.equal(server.calls.filter(call => call.method === "tools/list").length, 2);
});

test("restoring stored capabilities does not renew their in-memory freshness", async context => {
  installStorage(context);
  const server = capabilityServer(); let now = Date.now();
  await new PublicCatalogClient(server.fetcher, 15000, () => now, true).capabilities(new AbortController().signal);
  now += 61 * 60_000; server.calls.length = 0;
  const client = new PublicCatalogClient(server.fetcher, 15000, () => now, true);
  await client.capabilities(new AbortController().signal);
  assert.equal(server.calls.filter(call => call.method === "tools/list").length, 1);
});

test("invalid cursors never retry a read unless fresh capabilities confirm summary was removed", async () => {
  for (const code of ["invalid_cursor", "catalog_snapshot_changed"]) {
    const server = capabilityServer(); server.state.pageError = code;
    const client = new PublicCatalogClient(server.fetcher, 15000, Date.now, true);
    await assert.rejects(client.page(request, new AbortController().signal), error => error instanceof PublicCatalogError && error.code === code);
    assert.equal(server.calls.filter(call => call.method === "tools/call").length, 1);
    assert.equal(server.calls.filter(call => call.method === "tools/list").length, code === "invalid_cursor" ? 2 : 1);
  }
});

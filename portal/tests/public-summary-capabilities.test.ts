import assert from "node:assert/strict";
import test from "node:test";
import { PublicCatalogClient, loadPublicView } from "../src/app/unified/public-catalog";
import { initialNavigation } from "../src/app/unified/model";
import { catalogFixture } from "../../mcp/test/search-catalog-fixture";
import { createConfiguredMcpHandler } from "../../netlify/functions/omgskills-mcp.mjs";
import { createCompactMcpLibraryLoader } from "../../netlify/functions/_shared/compact-mcp-library";
import { createMcpLibraryLoader } from "../../netlify/functions/_shared/mcp-library";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
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

test("stored capabilities let a new session search without a tools/list round trip", async context => {
  const storage = memoryStorage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  context.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else delete (globalThis as { localStorage?: unknown }).localStorage; });

  const skills = [{ id: "example/skills:design", name: "design", description: "Design", author_handle: "example", github_url: "https://github.com/example/skills", tags: [], stars: 1 }];
  const f = catalogFixture(context, skills, true), work: Promise<unknown>[] = [];
  const compact = createCompactMcpLibraryLoader({ ...f.options, ranking: true, tracks: [{ name: "crawl4", manifestUrl: f.url }] });
  const legacy = createMcpLibraryLoader({ loadTrack: async () => { throw new Error("unused"); } });
  const handler = createConfiguredMcpHandler(true, { compact, legacy });
  const methods: string[] = [];
  const fetcher = async (path: string, init?: RequestInit) => {
    if (path.endsWith("manifest.json")) return Response.json({ collections: { path: "collections-abcdef.json" } });
    if (path.includes("collections-")) return Response.json({ collections: [] });
    methods.push(JSON.parse(String(init?.body)).method);
    return handler(new Request("https://integration.test/mcp", init), { waitUntil: p => { work.push(p); } });
  };
  const nav = { ...initialNavigation, view: "discover" as const, query: "design" };

  const first = new PublicCatalogClient(fetcher, 15000, Date.now, true);
  first.warm();
  await loadPublicView(first, nav, new AbortController().signal);
  assert.equal(methods.filter(method => method === "tools/list").length, 1);
  assert.ok(storage.values.has("omgskills-catalog-capabilities"));

  methods.length = 0;
  const second = new PublicCatalogClient(fetcher, 15000, Date.now, true);
  second.warm();
  await loadPublicView(second, nav, new AbortController().signal);
  assert.deepEqual(methods, ["tools/call"], "the second session goes straight to the search call");

  // A paging restart clears the remembered answer so the next session re-checks the server.
  second.invalidateView(nav);
  assert.equal(storage.values.has("omgskills-catalog-capabilities"), false);
  await Promise.allSettled(work);
});

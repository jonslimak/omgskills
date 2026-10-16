import assert from "node:assert/strict";
import test from "node:test";
import { PublicCatalogClient, loadPublicView } from "../src/app/unified/public-catalog";
import { initialNavigation } from "../src/app/unified/model";
import { appendPublicPage, publicPageRequest, publicSorts } from "../src/app/unified/public-paging";
import { catalogFixture } from "../../mcp/test/search-catalog-fixture";
import { createConfiguredMcpHandler } from "../../netlify/functions/omgskills-mcp.mjs";
import { createCompactMcpLibraryLoader } from "../../netlify/functions/_shared/compact-mcp-library";
import { createMcpLibraryLoader } from "../../netlify/functions/_shared/mcp-library";

test("the actual app client pages/ranks through the real configured MCP handler and compact reader", async context => {
  const skills = Array.from({ length: 65 }, (_, i) => ({ id: `example/skills:design-${i}`, name: `design-${i}`, description: "Design an accessible app",
    author_handle: "example", github_url: "https://github.com/example/skills", tags: ["design"], stars: 100 + i }));
  const f = catalogFixture(context, skills, true), work: Promise<unknown>[] = [];
  const compact = createCompactMcpLibraryLoader({ ...f.options, ranking: true, tracks: [{ name: "crawl4", manifestUrl: f.url }] });
  const legacy = createMcpLibraryLoader({ loadTrack: async () => { throw new Error("Public compact reads must not initialize the full reader"); } });
  const handler = createConfiguredMcpHandler(true, { compact, legacy });
  let capabilities = 0;
  const client = new PublicCatalogClient(async (path, init) => {
    if (path.endsWith("manifest.json")) return Response.json({ collections: { path: "collections-abcdef.json" } });
    if (path.includes("collections-")) return Response.json({ collections: [] });
    const request = JSON.parse(String(init?.body)); if (request.method === "tools/list") capabilities++;
    return handler(new Request("https://integration.test/mcp", init), { waitUntil: p => { work.push(p); } });
  }, 15000, Date.now, true);
  for (const sort of publicSorts) {
    const nav = { ...initialNavigation, view: "discover" as const, query: "design", sort };
    const first = await loadPublicView(client, nav, new AbortController().signal);
    assert.equal(first.page?.total, 65); assert.equal(first.catalog.resultIds?.length, 30);
    let chain = { skills: first.catalog.skills, page: first.page! }; const seen = new Set<string>();
    while (chain.page.hasMore) {
      const cursor = chain.page.nextCursor!; seen.add(cursor);
      chain = appendPublicPage(chain, await client.page(publicPageRequest(nav)!, new AbortController().signal, cursor), seen);
    }
    assert.equal(chain.skills.length, 65); assert.equal(new Set(chain.skills.map(skill => skill.id)).size, 65);
    if (sort === "stars") assert.equal(chain.skills[0].id, skills.at(-1)!.id);
  }
  assert.equal(capabilities, 1);
  assert.ok(!f.requested.includes(new URL(f.manifest.skills.path, f.url).href));
  await Promise.allSettled(work);
});

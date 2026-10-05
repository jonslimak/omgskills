import assert from "node:assert/strict";
import test from "node:test";
import { collectionAssetPath, LIST_LIMIT, loadPublicView, parseCollections, PublicCatalogClient, publicScope } from "../src/app/unified/public-catalog";
import { initialNavigation } from "../src/app/unified/model";
import { discoveryCategories } from "../src/app/unified/discovery-categories";

const signal = () => new AbortController().signal;
const skill = (id = "author/repo:pdf") => ({ id, name: "pdf", description: "Work with PDFs", author_handle: "author", github_url: "https://github.com/author/repo", stars: 10, tags: ["documents"] });
const collections = { collections: [
  { id: "author-author", type: "author", authorHandle: "author", title: "The Author", subtitle: "Published skills", featuredSkillIds: ["author/repo:pdf"] },
  { id: "documents", type: "topic", title: "Document tools", subtitle: "Read and write", skillIds: ["author/repo:pdf", "author/repo:missing"] },
] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
type Request = { id: number; params: { name: string; arguments: Record<string, unknown> } };
function reply(init: RequestInit | undefined, result: unknown) {
  return json({ jsonrpc: "2.0", id: (JSON.parse(init!.body as string) as Request).id, result: { structuredContent: result } });
}

test("default transport does not bind browser fetch to the client instance", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: unknown, _input, init) {
    assert.ok(!(this instanceof PublicCatalogClient), "browser fetch rejects this receiver");
    return reply(init, { skills: [skill()] });
  };
  try { assert.equal((await new PublicCatalogClient().list("list_trending", {}, signal())).length, 1); }
  finally { globalThis.fetch = original; }
});

test("published collections stay separate from Mac Discover search categories", () => {
  const result = parseCollections(collections);
  assert.equal(result.creators[0].name, "The Author");
  assert.equal(result.collections[0].id, "documents");
  assert.deepEqual(result.categories, discoveryCategories);
  assert.ok(!result.categories.some((group) => group.items.includes("Document tools")));
  assert.equal(result.skills.length, 0);
  assert.equal(result.collections[0].authors?.[0].handle, "author");
  assert.throws(() => parseCollections({ collections: [{}] }));
});

test("Discover categories match the Mac app's 24 terms in screenshot row order", () => {
  assert.deepEqual(discoveryCategories, [
    { label: "Design + Apps", items: ["Design system", "React", "SwiftUI", "Remotion", "App Store", "Landing page"] },
    { label: "Marketing", items: ["Brand", "Blog", "SEO", "Scraping", "Social media", "Market research"] },
    { label: "Coding", items: ["Code review", "Security audit", "Playwright", "API design", "Debugging", "Refactoring"] },
    { label: "Practical", items: ["MCP server", "Deck", "Deep research", "PDF", "Humanizer", "Excel"] },
  ]);
});

test("every category term searches its exact label, including category deep links", async () => {
  const searches: string[] = [];
  const client = new PublicCatalogClient(async (path, init) => {
    if (path.endsWith("manifest.json")) return json({ collections: { path: "collections-123abc.json" } });
    if (path.includes("collections-")) return json(collections);
    const body = JSON.parse(init!.body as string) as Request;
    assert.equal(body.params.name, "search_skills");
    assert.equal(body.params.arguments.limit, LIST_LIMIT);
    searches.push(body.params.arguments.query as string);
    return reply(init, { skills: [skill()] });
  });
  for (const group of discoveryCategories) {
    const grouped = await loadPublicView(client, { ...initialNavigation, view: "category", id: group.label }, signal());
    assert.equal(grouped.catalog.skills.length, 0);
    for (const term of group.items) {
      const clicked = await loadPublicView(client, { ...initialNavigation, view: "discover", query: term }, signal());
      const linked = await loadPublicView(client, { ...initialNavigation, view: "category", id: term }, signal());
      assert.deepEqual(clicked.catalog.resultIds, ["author/repo:pdf"]);
      assert.deepEqual(linked.catalog.resultIds, clicked.catalog.resultIds);
    }
  }
  assert.deepEqual(searches, discoveryCategories.flatMap((group) => group.items));
});

test("opening a collection still reads its entries instead of searching its title", async () => {
  const client = new PublicCatalogClient(async (path, init) => {
    if (path.endsWith("manifest.json")) return json({ collections: { path: "collections-123abc.json" } });
    if (path.includes("collections-")) return json(collections);
    const body = JSON.parse(init!.body as string) as Request;
    assert.equal(body.params.name, "get_skill");
    return reply(init, { found: true, skill: skill(body.params.arguments.id as string) });
  });
  const result = await loadPublicView(client, { ...initialNavigation, view: "collection", id: "documents" }, signal());
  assert.deepEqual(result.catalog.resultIds, ["author/repo:pdf", "author/repo:missing"]);
});

test("manifest path accepts collections only and rejects traversal or raw skill assets", () => {
  assert.equal(collectionAssetPath({ collections: { path: "collections-abc123.json" } }, "crawl4"), "/data/crawl4/collections-abc123.json");
  for (const path of ["skills-abc123.json", "../collections.json", "https://evil.test/collections.json", "//evil.test/a.json", "collections-%2e.json"]) {
    assert.throws(() => collectionAssetPath({ collections: { path } }, "crawl4"));
  }
});

test("metadata resolves hashed filenames via manifest and follows existing v2 fallback", async () => {
  const requests: string[] = [];
  const client = new PublicCatalogClient(async (path) => {
    requests.push(path);
    if (path.includes("crawl4")) return json({}, 503);
    return json(path.endsWith("manifest.json") ? { skills: { path: "skills-large.json" }, collections: { path: "collections-abcdef.json" } } : collections);
  });
  assert.equal((await client.metadata(signal())).collections.length, 1);
  await client.metadata(signal());
  assert.deepEqual(requests, ["/data/crawl4/manifest.json", "/data/v2/manifest.json", "/data/v2/collections-abcdef.json"]);
});

test("bounded list requests omit credentials, preserve server order, and cache reads", async () => {
  let calls = 0;
  const client = new PublicCatalogClient(async (path, init) => {
    calls++;
    assert.equal(path, "/mcp");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal((JSON.parse(init!.body as string) as Request).params.arguments.limit, LIST_LIMIT);
    return reply(init, { skills: [skill("author/repo:z"), skill("author/repo:a")] });
  });
  const results = await client.list("search_skills", { query: "pdf", limit: 1000 }, signal());
  assert.deepEqual(results.map((s) => s.id), ["author/repo:z", "author/repo:a"]);
  await client.list("search_skills", { query: "pdf", limit: 1000 }, signal());
  assert.equal(calls, 1);
});

test("tool errors, protocol errors and malformed skills are not empty result lists", async () => {
  for (const envelope of [
    { error: { message: "bad" } },
    { result: { isError: true } },
    { result: { structuredContent: { skills: [{}] } } },
    { result: { structuredContent: { skills: [skill(), skill()] } } },
  ]) {
    const client = new PublicCatalogClient(async (_path, init) => json({ id: JSON.parse(init!.body as string).id, ...envelope }));
    await assert.rejects(client.list("search_skills", { query: "pdf", limit: 1 }, signal()));
  }
  const empty = new PublicCatalogClient(async (_path, init) => reply(init, { skills: [] }));
  assert.deepEqual(await empty.list("search_skills", {}, signal()), []);
});

test("MCP text fallback works but unsafe links and mismatched identities fail closed", async () => {
  const fallback = new PublicCatalogClient(async (_path, init) => json({ id: JSON.parse(init!.body as string).id, result: { content: [{ type: "text", text: JSON.stringify([skill()]) }] } }));
  assert.equal((await fallback.list("list_trending", {}, signal()))[0].id, "author/repo:pdf");
  const wrong = new PublicCatalogClient(async (_path, init) => reply(init, { found: true, skill: skill("other/repo:pdf") }));
  await assert.rejects(wrong.skill("author/repo:pdf", signal()), /different skill/);
  const unsafe = new PublicCatalogClient(async (_path, init) => reply(init, { skills: [{ ...skill(), github_url: "javascript:alert(1)" }] }));
  await assert.rejects(unsafe.list("search_skills", {}, signal()));
});

test("HTTP failures, non-JSON responses, timeouts and oversized bodies are visible errors", async () => {
  const busy = new PublicCatalogClient(async () => json({}, 429));
  await assert.rejects(busy.list("list_trending", {}, signal()), /busy/);
  const html = new PublicCatalogClient(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(html.list("list_trending", {}, signal()), /did not return JSON/);
  const large = new PublicCatalogClient(async () => json("x".repeat(2_000_001)));
  await assert.rejects(large.list("list_trending", {}, signal()), /too large/);
  const slow = new PublicCatalogClient((_path, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))), 5);
  await assert.rejects(slow.list("list_trending", {}, signal()), /too long/);
});

test("shared detail requests deduplicate without cancelling another consumer", async () => {
  let finish!: () => void, calls = 0, aborted = false;
  const client = new PublicCatalogClient(async (_path, init) => {
    calls++;
    init!.signal!.addEventListener("abort", () => { aborted = true; });
    await new Promise<void>((resolve) => { finish = resolve; });
    return reply(init, { found: true, skill: skill() });
  });
  const first = new AbortController();
  const a = client.skill("author/repo:pdf", first.signal);
  const b = client.skill("author/repo:pdf", signal());
  first.abort();
  await assert.rejects(a);
  assert.equal(aborted, false);
  finish();
  assert.equal((await b)?.name, "pdf");
  assert.equal(calls, 1);
});

test("abandoning all consumers aborts upstream and cannot poison a later request", async () => {
  let calls = 0, aborted = false;
  const client = new PublicCatalogClient(async (_path, init) => {
    calls++;
    if (calls === 1) await new Promise<void>((_resolve, reject) => init!.signal!.addEventListener("abort", () => { aborted = true; reject(init!.signal!.reason); }));
    return reply(init, { found: true, skill: skill() });
  });
  const controller = new AbortController();
  const pending = client.skill("author/repo:pdf", controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(aborted, true);
  assert.equal((await client.skill("author/repo:pdf", signal()))?.name, "pdf");
  assert.equal(calls, 2);
});

test("collection reads preserve order, cap total requests and use at most four concurrent requests", async () => {
  let active = 0, maxActive = 0, total = 0;
  const client = new PublicCatalogClient(async (_path, init) => {
    total++; maxActive = Math.max(maxActive, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    const id = JSON.parse(init!.body as string).params.arguments.id as string;
    return reply(init, id.endsWith(":1") ? { found: false, skill: null } : { found: true, skill: skill(id) });
  });
  const result = await client.collection(Array.from({ length: 100 }, (_, i) => `author/repo:${i}`), signal());
  assert.equal(total, LIST_LIMIT);
  assert.equal(maxActive, 4);
  assert.equal(result.missing, 1);
  assert.equal(result.limited, true);
  assert.equal(result.skills[1].id, "author/repo:2");
});

test("public links are lazy and restricted to known public skill routes", async () => {
  const client = new PublicCatalogClient(async () => json({ skills: { safe: "/skills/author/repo/pdf/", evil: "//evil.test/", private: "/app/groups/private/", escape: "/skills/../app/" } }));
  assert.equal(await client.publicUrl("safe", signal()), "https://omgskills.com/skills/author/repo/pdf/");
  for (const id of ["evil", "private", "escape", "missing"]) assert.equal(await client.publicUrl(id, signal()), undefined);
});

test("public cache stays bounded instead of retaining every browsed skill", async () => {
  let calls = 0;
  const client = new PublicCatalogClient(async (_path, init) => {
    calls++;
    return reply(init, { found: true, skill: skill(JSON.parse(init!.body as string).params.arguments.id) });
  });
  for (let i = 0; i < 61; i++) await client.skill(`author/repo:${i}`, signal());
  await client.skill("author/repo:60", signal());
  assert.equal(calls, 61);
  await client.skill("author/repo:0", signal());
  assert.equal(calls, 62);
});

test("failed collection read cancels its workers without fetching remaining entries", async () => {
  let calls = 0, cancelled = 0;
  const client = new PublicCatalogClient(async (_path, init) => {
    calls++;
    if (calls === 1) return json({}, 503);
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => {
      cancelled++;
      reject(init!.signal!.reason);
    }));
  });
  await assert.rejects(client.collection(Array.from({ length: 30 }, (_, i) => `author/repo:${i}`), signal()));
  assert.equal(calls, 4);
  assert.equal(cancelled, 3);
});

test("list scope excludes detail selection and account source filters", () => {
  const nav = { ...initialNavigation, view: "top" as const };
  assert.equal(publicScope(nav), publicScope({ ...nav, selected: "catalog:abc", source: "Claude" }));
});

test("Discover reads metadata and nine trending skills, without collection detail fan-out", async () => {
  const paths: string[] = [];
  const client = new PublicCatalogClient(async (path, init) => {
    paths.push(path);
    if (path.endsWith("manifest.json")) return json({ collections: { path: "collections-123abc.json" }, skills: { path: "skills-large.json" } });
    if (path.includes("collections-")) return json(collections);
    const body = JSON.parse(init!.body as string) as Request;
    assert.equal(body.params.name, "list_trending");
    assert.equal(body.params.arguments.limit, 9);
    return reply(init, { skills: [skill()] });
  });
  const result = await loadPublicView(client, { ...initialNavigation, view: "discover" }, signal());
  assert.deepEqual(result.catalog.trendingIds, ["author/repo:pdf"]);
  assert.equal(paths.length, 3);
  assert.ok(paths.every((path) => !path.includes("skills-large")));
});

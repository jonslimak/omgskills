import assert from "node:assert/strict";
import test from "node:test";
import { PublicCatalogClient, loadPublicView, publicScope, emptyCatalog } from "../src/app/unified/public-catalog";
import { initialNavigation, parseNavigation, navigationSearch } from "../src/app/unified/model";
import { publicNavigation } from "../src/integration/unified/policy";
import { appendPublicPage, publicPageRequest, publicSorts, requiresPageRestart, PublicCatalogError } from "../src/app/unified/public-paging";

const signal = () => new AbortController().signal;
const row = (n: number) => ({ id: `example/skills:item-${n}`, name: `Item ${n}`, description: "App design", author_handle: "example", github_url: "https://github.com/example/skills", tags: [], stars: n });
const tools = (modern = true) => ["search_skills", "list_by_author", "list_trending"].map(name => ({ name, inputSchema: { type: "object", properties: modern
  ? { page: { type: "object" }, ...(name === "search_skills" ? { ranking: { type: "string", const: "web-v1" } } : {}) } : {} } }));
const nav = { ...initialNavigation, view: "discover" as const, query: "app design" };
const request = publicPageRequest(nav)!;
type Call = { id: number; method: string; params: { name?: string; arguments?: Record<string, any> } };
function fixture(options: { legacy?: boolean; text?: boolean; mutate?: (value: any, call: Call) => unknown } = {}) {
  const calls: Call[] = [];
  const fetcher = async (path: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    if (path.includes("manifest.json")) return Response.json({ collections: { path: "collections-abc123.json" } });
    if (path.includes("collections-")) return Response.json({ collections: [] });
    assert.equal(init?.credentials, "omit");
    const call = JSON.parse(String(init?.body)) as Call; calls.push(call);
    let value: any;
    if (call.method === "tools/list") value = { tools: tools(!options.legacy) };
    else {
      const args = call.params.arguments!, offset = args.page?.cursor ? Number(args.page.cursor.slice(1)) : 0;
      const skills = Array.from({ length: Math.min(args.limit ?? 30, 65 - offset) }, (_, i) => row(offset + i));
      const page = { total: 65, snapshot: "a".repeat(64), sort: call.params.name === "list_trending" ? "trending" : args.sort ?? "relevance",
        hasMore: offset + skills.length < 65, nextCursor: offset + skills.length < 65 ? `c${offset + skills.length}` : null };
      value = { count: skills.length, skills, ...(args.page ? { page } : {}) };
    }
    value = options.mutate ? options.mutate(value, call) : value;
    const result = options.text && call.method !== "tools/list" ? { content: [{ type: "text", text: JSON.stringify(value) }] }
      : call.method === "tools/list" ? value : { structuredContent: value };
    return Response.json({ jsonrpc: "2.0", id: call.id, result });
  };
  return { client: new PublicCatalogClient(fetcher, 15000, Date.now, true), calls, fetcher };
}

test("public paging traverses past 30, preserves order, and discovers capabilities once for every sort", async () => {
  for (const sort of publicSorts) {
    const { client, calls } = fixture();
    const req = publicPageRequest({ ...nav, sort })!;
    let page = await client.page(req, signal());
    const seen = new Set<string>();
    while (page.page.hasMore) {
      const cursor = page.page.nextCursor!; seen.add(cursor);
      page = appendPublicPage(page, await client.page(req, signal(), cursor), seen);
    }
    assert.deepEqual(page.skills.map(skill => skill.id), Array.from({ length: 65 }, (_, i) => row(i).id));
    assert.equal(page.page.nextCursor, null);
    assert.equal(calls.filter(call => call.method === "tools/list").length, 1);
    assert.equal(calls.length, 4);
    for (const call of calls.filter(call => call.method === "tools/call")) {
      assert.equal(call.params.arguments?.ranking, "web-v1"); assert.equal(call.params.arguments?.sort, sort);
    }
  }
});

test("ranked page text-object fallback is accepted, and malformed page metadata is never empty success", async () => {
  assert.equal((await fixture({ text: true }).client.page(request, signal())).skills.length, 30);
  const changes = [
    (v: any) => ({ ...v, count: 1 }), (v: any) => ({ ...v, skills: [v.skills[0], v.skills[0]] }),
    (v: any) => ({ ...v, page: { ...v.page, total: -1 } }), (v: any) => ({ ...v, page: { ...v.page, hasMore: false } }),
    (v: any) => ({ ...v, page: { ...v.page, snapshot: "" } }), (v: any) => ({ ...v, page: { ...v.page, sort: "bogus" } }),
    (v: any) => ({ ...v, page: { ...v.page, nextCursor: "x".repeat(1025) } }), (v: any) => ({ ...v, page: undefined }),
  ];
  for (const change of changes) {
    const f = fixture({ mutate: (v, c) => c.method === "tools/list" ? v : change(v) });
    await assert.rejects(f.client.page(request, signal()), /invalid page|duplicate skills/);
  }
});

test("repeated cursors, overlapping rows, changed totals and mixed snapshots cannot append", async () => {
  const { client } = fixture(), first = await client.page(request, signal());
  const second = await client.page(request, signal(), first.page.nextCursor!);
  assert.equal(appendPublicPage(first, second, new Set(["c30"])).skills.length, 60);
  const changes = [
    { ...second, skills: [first.skills[0], ...second.skills.slice(1)] },
    { ...second, page: { ...second.page, total: 66 } },
    { ...second, page: { ...second.page, nextCursor: "c30" } },
  ];
  for (const bad of changes) assert.throws(() => appendPublicPage(first, bad, new Set(["c30"])), error => requiresPageRestart(error));
  assert.throws(() => appendPublicPage(first, { ...second, page: { ...second.page, snapshot: "b".repeat(64) } }, new Set()), error => requiresPageRestart(error));
});

test("only confirmed legacy capabilities use a capped view; errors are visible and retryable", async () => {
  const f = fixture({ legacy: true }), result = await loadPublicView(f.client, nav, signal());
  assert.equal(result.page, undefined); assert.match(result.note, /unavailable/);
  assert.equal(f.calls[1].params.arguments?.page, undefined);
  assert.equal(f.calls[1].params.arguments?.ranking, undefined);
  assert.equal(f.calls[1].params.arguments?.sort, undefined);
  let failures = 1;
  const client = new PublicCatalogClient(async (path, init) => {
    const call = JSON.parse(String(init?.body)) as Call;
    if (call.method === "tools/list" && failures-- > 0) return new Response("down", { status: 503 });
    return f.fetcher(path, init);
  }, 15000, Date.now, true);
  await assert.rejects(client.firstPage(request, signal()), /unavailable/);
  assert.match((await client.firstPage(request, signal())).note, /unavailable/);
  const bad = fixture({ mutate: (value, call) => call.method === "tools/list" ? { tools: [] } : value });
  await assert.rejects(bad.client.firstPage(request, signal()), /invalid capabilities/);
});

test("capabilities/pages deduplicate, cancelled requests do not poison retries, and sort scopes remain separate", async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 8 }, () => f.client.page(request, signal())));
  assert.equal(f.calls.length, 2);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(async () => f.client.page(request, stopped.signal));
  const byName = publicPageRequest({ ...nav, sort: "name" })!;
  await f.client.page(byName, signal());
  assert.equal(f.calls.length, 3);
  assert.notEqual(publicScope(nav), publicScope({ ...nav, sort: "name" }));
  f.client.invalidateView(nav);
  await f.client.page(request, signal());
  assert.equal(f.calls.length, 5);
});

test("discovery remains progressive without capability calls; creator and trending pages use their own contracts", async () => {
  const f = fixture();
  await loadPublicView(f.client, { ...initialNavigation, view: "discover" }, signal());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].params.arguments?.limit, 9);
  for (const view of ["creator", "top"] as const) {
    const current = { ...initialNavigation, view, id: view === "creator" ? "example" : "" };
    const result = await loadPublicView(f.client, current, signal());
    assert.equal(result.page?.total, 65);
    const call = f.calls.at(-1)!;
    assert.equal(call.params.arguments?.ranking, undefined);
    if (view === "top") assert.equal(call.params.arguments?.sort, undefined);
  }
});

test("navigation round trips sort only for public skill feeds, never cursors/private search", () => {
  for (const sort of publicSorts) {
    const current = { ...nav, sort };
    const restored = parseNavigation(navigationSearch(current));
    assert.equal(restored.sort ?? "relevance", sort);
    assert.equal(publicScope(restored), publicScope(current));
  }
  assert.equal(parseNavigation("?view=discover&q=pdf&sort=wrong").sort, undefined);
  assert.equal(parseNavigation("?view=top&sort=name").sort, undefined);
  for (const view of ["all", "favorites", "set"] as const) {
    const privateNav = { ...initialNavigation, view, query: "private project", sort: "stars" as const };
    assert.equal(publicPageRequest(privateNav), null);
    assert.equal(publicPageRequest(publicNavigation(privateNav)), null);
    assert.equal(new URLSearchParams(navigationSearch(privateNav)).has("sort"), false);
  }
  const parsed = parseNavigation("?view=discover&q=pdf&cursor=secret&sort=stars");
  assert.equal(navigationSearch(parsed).includes("cursor"), false);
});

test("inactive view retention is bounded by rows as well as view count", () => {
  const { client } = fixture();
  const skills = Array.from({ length: 400 }, (_, i) => ({ id: String(i), name: "n", description: "d", author: "example", githubUrl: "https://github.com/example/skills", tags: [] }));
  client.rememberView(nav, { catalog: { ...emptyCatalog(), skills }, note: "" });
  client.rememberView({ ...nav, query: "second" }, { catalog: { ...emptyCatalog(), skills }, note: "" });
  assert.equal(client.cachedView(nav), undefined);
  assert.ok(client.cachedView({ ...nav, query: "second" }));
});

test("safe tool errors retain only known restart codes", async () => {
  const f = fixture();
  const client = new PublicCatalogClient(async (path, init) => {
    const call = JSON.parse(String(init?.body)) as Call;
    if (call.method === "tools/list") return f.fetcher(path, init);
    return Response.json({ jsonrpc: "2.0", id: call.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "catalog_snapshot_changed", message: "untrusted text" } }) }] } });
  }, 15000, Date.now, true);
  await assert.rejects(client.page(request, signal()), error => error instanceof PublicCatalogError && requiresPageRestart(error) && !error.message.includes("untrusted"));
});

test("valid catalog rows with an unknown author remain visible without invented attribution", async () => {
  const { client } = fixture({ mutate: (value, call) => call.method === "tools/list" ? value : {
    ...value, skills: value.skills.map((skill: any, i: number) => i === 0 ? { ...skill, author_handle: "" } : skill),
  } });
  const page = await client.page(request, signal());
  assert.equal(page.skills.length, 30); assert.equal(page.skills[0].id, row(0).id);
  assert.equal(page.skills[0].author, ""); assert.equal(page.skills[0].avatar, undefined);
  const unsafe = fixture({ mutate: (value, call) => call.method === "tools/list" ? value : {
    ...value, skills: value.skills.map((skill: any) => ({ ...skill, author_handle: "bad/handle" })),
  } });
  await assert.rejects(unsafe.client.page(request, signal()), /invalid skill/);
});

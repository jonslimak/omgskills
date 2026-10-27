import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type LoadedLibrary, type Skill } from "../src/library.js";
import { catalogSorts, PagingError, type CatalogSort, type PageOptions, type SkillPage } from "../src/paging.js";
import { createOmgskillsServer } from "../src/server.js";
import type { CatalogReader } from "../src/catalog-reader.js";
import { loadCatalogReader, SearchCatalogReader } from "../src/search-catalog.js";
import { detailBucket } from "../src/search-catalog-format.mjs";
import { catalogFixture, rows } from "./search-catalog-fixture.js";

const data: LoadedLibrary = {
  skills: Array.from({ length: 257 }, (_, i) => ({ ...rows[0], id: `owner/repo:item-${String(i).padStart(3, "0")}`,
    name: `Tool ${i % 17}`, description: "workflow design", author_handle: "Owner", tags: [i % 2 ? "odd" : "even"],
    stars: i % 13, first_seen: `2026-01-${String(i % 28 + 1).padStart(2, "0")}`,
    last_updated: `2026-02-${String(i % 28 + 1).padStart(2, "0")}T00:00:00Z` })),
  trending: Array.from({ length: 257 }, (_, i) => ({ id: `owner/repo:item-${String(i).padStart(3, "0")}`, trending_rank: 257 - i, installs: i * 10 })),
  goldBasket: [],
};
const library = () => OmgskillsLibrary.fromData(data, "fixture-version-1");
const ids = (rows: { id: string }[]) => rows.map(row => row.id);
function reference(sort: CatalogSort, input = data.skills) {
  const numberCompare = (a: number, b: number) => b - a;
  const names = (a: Skill, b: Skill) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return input.slice().sort((a, b) => {
    const i = data.skills.findIndex(row => row.id === a.id), j = data.skills.findIndex(row => row.id === b.id);
    if (sort === "relevance") {
      const score = (row: Skill, index: number) => 4 + Math.max(0, 10 - (257 - index) / 50) + 6 * Math.log10((row.stars ?? 0) + 1);
      return score(b, j) - score(a, i) || (b.stars ?? 0) - (a.stars ?? 0) || i - j;
    }
    return (sort === "trending" ? j - i
      : sort === "stars" ? numberCompare(a.stars!, b.stars!)
      : sort === "updated" ? Date.parse(b.last_updated!) - Date.parse(a.last_updated!)
      : sort === "added" ? Date.parse(b.first_seen!) - Date.parse(a.first_seen!) : 0) || names(a, b);
  });
}
function walk(read: (options: PageOptions) => SkillPage, sort: CatalogSort, limit: number) {
  const actual: string[] = [];
  let cursor: string | undefined;
  do {
    const result = read({ page: cursor ? { cursor } : {}, limit, sort });
    assert.equal(result.page.hasMore, result.page.nextCursor !== null);
    assert.ok(result.skills.length <= limit);
    actual.push(...ids(result.skills)); cursor = result.page.nextCursor ?? undefined;
    assert.ok(actual.length <= data.skills.length);
  } while (cursor);
  return actual;
}

test("all sorts page beyond 100 without duplicate or omitted IDs, including one-row pages", () => {
  const l = library();
  for (const sort of catalogSorts) for (const limit of [1, 20, 30, 100]) {
    const expected = ids(reference(sort));
    assert.deepEqual(walk(options => l.searchPage({ ...options, query: "workflow" }), sort, limit), expected, `${sort}/${limit}`);
    // Empty-query author scores differ only by the constant text score, not ordering.
    assert.deepEqual(walk(options => l.listByAuthorPage("OWNER", options), sort, limit), expected);
  }
  for (const limit of [1, 20, 30, 100]) assert.deepEqual(walk(options => l.listTrendingPage({ limit: options.limit, page: options.page }), "trending", limit), ids(data.skills.slice().reverse()));
  assert.deepEqual(l.searchPage({ query: "workflow", limit: 30, page: {} }).skills, l.searchSkills({ query: "workflow", limit: 30 }));
  // An empty search lists trending skills instead of nothing.
  const empty = l.searchPage({ query: "", page: {} });
  assert.equal(empty.page.total, 257);
  assert.deepEqual(empty.search, { showing_trending: true });
  assert.equal(l.searchPage({ query: "no-match", page: {} }).page.nextCursor, null);
  const selected = data.skills.filter(row => row.tags?.includes("even") && row.stars! >= 5);
  const filtered = l.searchPage({ query: "WORKFLOW", author: "OWNER", tag: "EVEN", minStars: 5, sort: "name", limit: 100, page: {} });
  assert.equal(filtered.page.total, selected.length);
  assert.deepEqual(ids(filtered.skills), ids(reference("name", selected)));
});

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function errorCode(read: () => unknown, code: string) { assert.throws(read, error => error instanceof PagingError && error.code === code); }
test("cursors bind the request, tool, snapshot and size; malformed requests fail safely", () => {
  const l = library(), options = { query: "workflow", limit: 20, page: {} };
  const cursor = l.searchPage(options).page.nextCursor!;
  const raw = JSON.parse(Buffer.from(cursor, "base64url").toString());
  for (const change of [{ query: "design" }, { limit: 30 }, { sort: "stars" }, { tag: "even" }, { minStars: 1 }, { author: "owner" }]) {
    errorCode(() => l.searchPage({ ...options, ...change, page: { cursor } } as never), "invalid_cursor");
  }
  errorCode(() => l.listByAuthorPage("owner", { limit: 20, page: { cursor } }), "invalid_cursor");
  errorCode(() => l.listTrendingPage({ limit: 20, page: { cursor } }), "invalid_cursor");
  const next = OmgskillsLibrary.fromData(data, "fixture-version-2");
  errorCode(() => next.searchPage({ ...options, page: { cursor } }), "catalog_snapshot_changed");
  for (const token of ["", "%%%", "a".repeat(1025), "e30=", encoded(null), encoded([]), encoded({ ...raw, v: 2 }),
    encoded({ ...raw, offset: -1 }), encoded({ ...raw, offset: 1.5 }), encoded({ ...raw, offset: 1e20 }),
    encoded({ ...raw, offset: 258 }), encoded({ ...raw, snapshot: 123 }), encoded({ ...raw, snapshot: [raw.snapshot] }),
    encoded({ ...raw, request: [raw.request] }), encoded({ ...raw, extra: "https://evil.test" })]) {
    errorCode(() => l.searchPage({ ...options, page: { cursor: token } }), "invalid_cursor");
  }
  const terminal = l.searchPage({ ...options, page: { cursor: encoded({ ...raw, offset: 257 }) } });
  assert.deepEqual(terminal.skills, []); assert.equal(terminal.page.hasMore, false);
  for (const bad of [{ limit: NaN }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { minStars: Infinity },
    { query: "\u4e2d".repeat(400) }, { tag: "a".repeat(101) }, { author: "a".repeat(101) }, { page: { extra: true } }]) {
    errorCode(() => l.searchPage({ ...options, ...bad } as never), "invalid_cursor");
  }
  errorCode(() => OmgskillsLibrary.fromData(data).searchPage(options), "catalog_unavailable");
  assert.deepEqual(l.searchPage({ ...options, query: "  WORKFLOW  ", page: { cursor } }).skills, l.searchPage({ ...options, page: { cursor } }).skills);
});

test("explicit sorts handle invalid/missing values and Unicode deterministically", () => {
  const skills = [
    { ...rows[0], id: "a", name: "\u{10000}", stars: undefined, last_updated: "2026-02-30", first_seen: undefined },
    { ...rows[0], id: "b", name: "\ue000", stars: 0, last_updated: "2026-02-28T00:00:00Z", first_seen: "2026-01-01" },
    { ...rows[0], id: "c", name: "\uff21", stars: NaN, last_updated: "not-a-date", first_seen: "" },
    { ...rows[0], id: "d", name: "a", stars: 0, last_updated: "2026-03-01T01:00:00+01:00", first_seen: "2026-01-02" },
  ];
  const l = OmgskillsLibrary.fromData({ skills, trending: [], goldBasket: [] }, "v");
  const read = (sort: CatalogSort) => ids(l.searchPage({ query: "swift", sort, page: {} }).skills);
  assert.deepEqual(read("name"), ["c", "d", "b", "a"]);
  assert.deepEqual(read("stars"), ["d", "b", "c", "a"]);
  assert.deepEqual(read("updated"), ["d", "b", "c", "a"]);
  assert.deepEqual(read("added"), ["d", "b", "c", "a"]);
  for (const trending of [[{ id: "missing", trending_rank: 1 }], [{ id: skills[0].id }, { id: skills[0].id }], [{ id: skills[0].id, trending_rank: -1 }]]) {
    const bad = OmgskillsLibrary.fromData({ skills, trending, goldBasket: [] }, "v");
    errorCode(() => bad.listTrendingPage({ page: {} }), "catalog_unavailable");
    assert.ok(bad.listTrending().length); // The legacy degraded path is not changed.
  }
});

async function connected(context: { after: (fn: () => unknown) => void }, reader: CatalogReader, paging: boolean) {
  const server = createOmgskillsServer(reader, { paging }), client = new Client({ name: "paging-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  return client;
}
test("paging servers page by default and return the same skills as unpaged servers", async context => {
  const l = library(), old = await connected(context, l, false), candidate = await connected(context, l, true);
  const baselineTools = await old.listTools(), candidateTools = await candidate.listTools();
  assert.deepEqual(baselineTools.tools.map(t => t.name), candidateTools.tools.map(t => t.name));
  assert.equal("page" in baselineTools.tools[0].inputSchema.properties!, false);
  assert.equal("page" in candidateTools.tools[0].inputSchema.properties!, true);
  for (const [name, args] of [["search_skills", { query: "workflow" }], ["list_by_author", { author: "Owner" }], ["list_trending", {}]] as [string, object][]) {
    const paged = (await candidate.callTool({ name, arguments: args as never })).structuredContent as unknown as SkillPage;
    const unpaged = (await old.callTool({ name, arguments: args as never })).structuredContent as unknown as SkillPage;
    assert.deepEqual(paged.skills, unpaged.skills, name);
    assert.equal(paged.page.total, 257, name); assert.equal(unpaged.page, undefined, name);
  }
  for (const [name, args] of [["list_gold_basket", {}], ["get_skill", { id: data.skills[0].id }], ["get_skills", { ids: [data.skills[0].id, "missing"] }]] as [string, object][]) {
    assert.deepEqual(await candidate.callTool({ name, arguments: args as never }), await old.callTool({ name, arguments: args as never }), name);
  }
  const request = { name: "search_skills", arguments: { query: "workflow", limit: 30, sort: "stars", page: {}, summary: false } };
  const first = await candidate.callTool(request), content = first.structuredContent as unknown as { count: number } & SkillPage;
  assert.equal(content.page.total, 257); assert.equal(content.count, 30); assert.equal(first.isError, undefined);
  assert.match((first.content as { text: string }[])[0].text, /^30 skills of 257:/);
  assert.equal((content.skills[0] as unknown as { install_status: string }).install_status, "pinned");
  const second = await candidate.callTool({ ...request, arguments: { ...request.arguments, page: { cursor: content.page.nextCursor! } } });
  assert.deepEqual(ids((second.structuredContent as unknown as SkillPage).skills), ids(reference("stars").slice(30, 60)));
  for (const [name, args, expected] of [
    ["list_by_author", { author: "Owner", sort: "updated", limit: 100, page: {} }, ids(reference("updated"))],
    ["list_trending", { limit: 100, page: {} }, ids(data.skills.slice().reverse())],
  ] as [string, Record<string, unknown>, string[]][]) {
    const start = await candidate.callTool({ name, arguments: args });
    assert.equal(start.isError, undefined);
    const firstPage = start.structuredContent as unknown as SkillPage;
    assert.equal(firstPage.page.total, 257); assert.deepEqual(ids(firstPage.skills), expected.slice(0, 100));
    const next = await candidate.callTool({ name, arguments: { ...args, page: { cursor: firstPage.page.nextCursor! } } });
    assert.equal(next.isError, undefined); assert.deepEqual(ids((next.structuredContent as unknown as SkillPage).skills), expected.slice(100, 200));
  }
  // sort no longer needs page; unknown arguments are rejected by the schema; bad cursors say what to do.
  assert.equal((await candidate.callTool({ name: "search_skills", arguments: { query: "workflow", sort: "stars" } })).isError, undefined);
  const extra = await candidate.callTool({ name: "search_skills", arguments: { ...request.arguments, extra: "not-allowed" } });
  assert.equal(extra.isError, true); assert.match(JSON.stringify(extra.content), /extra/);
  const bad = await candidate.callTool({ name: "search_skills", arguments: { ...request.arguments, page: { cursor: "bad" } } });
  assert.equal(bad.isError, true); assert.equal(bad.structuredContent, undefined);
  assert.deepEqual(JSON.parse((bad.content as { text: string }[])[0].text).error.code, "invalid_cursor");
  assert.match(JSON.parse((bad.content as { text: string }[])[0].text).error.message, /Start again with page: \{\}/);
  const changed = await candidate.callTool({ name: "search_skills", arguments: { ...request.arguments, limit: 20, page: { cursor: content.page.nextCursor! } } });
  assert.match(JSON.parse((changed.content as { text: string }[])[0].text).error.message, /different arguments/);
  const unsupported: CatalogReader = { getSkill: l.getSkill.bind(l), searchSkills: l.searchSkills.bind(l), listTrending: l.listTrending.bind(l),
    listGoldBasket: l.listGoldBasket.bind(l), listByAuthor: l.listByAuthor.bind(l), getStats: l.getStats.bind(l) };
  const missing = await connected(context, unsupported, true);
  const response = await missing.callTool({ name: "search_skills", arguments: { query: "workflow", page: {} } });
  assert.equal(response.isError, true); assert.match(JSON.stringify(response.content), /paging_not_supported/);
});

test("compact pages hydrate only their selected buckets and keep complete install metadata", async context => {
  const f = catalogFixture(context, data.skills), compact = await loadCatalogReader(f.url, f.options) as SearchCatalogReader;
  const first = await compact.searchPage({ query: "workflow", sort: "stars", limit: 7, page: {} });
  assert.equal(first.page.total, 257);
  assert.deepEqual(ids(first.skills), ids(reference("stars").slice(0, 7)));
  assert.equal(compact.diagnostics().detailFetches, new Set(first.skills.map(row => detailBucket(row.id))).size);
  assert.equal(first.skills[0].skill_md_sha, rows[0].skill_md_sha);
  assert.equal(first.skills[0].install_target_name, "legacy-alias");
  await compact.searchPage({ query: "workflow", sort: "stars", limit: 7, page: {} });
  assert.equal(compact.diagnostics().detailFetches, new Set(first.skills.map(row => detailBucket(row.id))).size);
  assert.ok(!f.requested.some(url => url.endsWith(f.manifest.skills.path)));
  const noSignals = catalogFixture(context); noSignals.files.delete(noSignals.options.goldBasketUrl);
  const degraded = await loadCatalogReader(noSignals.url, noSignals.options) as SearchCatalogReader;
  assert.ok((await degraded.searchSkills({ query: "swift" })).length);
  await assert.rejects(async () => degraded.searchPage({ query: "swift", page: {} }), error => error instanceof PagingError && error.code === "catalog_unavailable");
});

test("corrupt detail shards are availability errors, not successful empty pages", async context => {
  const f = catalogFixture(context), compact = await loadCatalogReader(f.url, f.options) as SearchCatalogReader;
  const client = await connected(context, compact, true);
  for (const url of f.files.keys()) if (url.includes("/skill-details-")) f.files.set(url, Buffer.from("[]"));
  const response = await client.callTool({ name: "search_skills", arguments: { query: "swift", page: {}, summary: false } });
  assert.equal(response.isError, true); assert.match(JSON.stringify(response.content), /catalog_unavailable/);
  assert.equal(response.structuredContent, undefined);
});

test("old manifests retain legacy full-loader fallback with complete paging versions", async context => {
  const f = catalogFixture(context);
  f.files.set(f.url, Buffer.from(JSON.stringify({ ...f.manifest, searchCatalog: undefined })));
  const old = await loadCatalogReader(f.url, f.options);
  assert.ok(old instanceof OmgskillsLibrary);
  const first = old.searchPage({ query: "design", limit: 1, page: {} });
  assert.equal(first.page.total, 2); assert.deepEqual(first.skills, f.legacy.searchSkills({ query: "design", limit: 1 }));
  assert.equal(old.searchPage({ query: "design", limit: 1, page: { cursor: first.page.nextCursor! } }).skills.length, 1);
  assert.ok(f.requested.some(url => url.endsWith(f.manifest.skills.path)));
});

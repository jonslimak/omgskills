import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOmgskillsServer } from "../src/server.js";
import { loadCatalogReader, SearchCatalogReader } from "../src/search-catalog.js";
import { OmgskillsLibrary } from "../src/library.js";
import type { CatalogReader } from "../src/catalog-reader.js";
import { detailBucket } from "../src/search-catalog-format.mjs";
import { catalogFixture, rows } from "./search-catalog-fixture.js";

async function connected(context: { after: (fn: () => unknown) => void }, reader: CatalogReader, ranking = false) {
  const server = createOmgskillsServer(reader, { paging: true, ranking }), client = new Client({ name: "ranking-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); }); return client;
}
test("ranking is separately advertised and nonranked callers remain unchanged", async context => {
  const f = catalogFixture(context, rows, true), reader = await loadCatalogReader(f.url, { ...f.options, ranking: true });
  const old = await connected(context, reader), candidate = await connected(context, reader, true);
  assert.equal("ranking" in (await old.listTools()).tools[0].inputSchema.properties!, false);
  assert.equal("ranking" in (await candidate.listTools()).tools[0].inputSchema.properties!, true);
  for (const [name, args] of [["search_skills", { query: "design" }], ["search_skills", { query: "design", page: {}, sort: "stars" }],
    ["list_by_author", { author: "another" }], ["list_trending", { limit: 1 }], ["list_gold_basket", {}],
    ["get_skill", { id: rows[0].id }], ["get_skills", { ids: [rows[0].id, "missing"] }]] as [string, Record<string, unknown>][]) {
    assert.deepEqual(await candidate.callTool({ name, arguments: args }), await old.callTool({ name, arguments: args }));
  }
  const args = { query: "design", ranking: "web-v1", page: {}, limit: 1 };
  const result = await candidate.callTool({ name: "search_skills", arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const value = result.structuredContent as any;
  assert.equal(value.count, 1); assert.equal(value.page.total, 2);
  assert.match((result.content as { text: string }[])[0].text, /^1 skill of 2:/);
  // ranking no longer needs an explicit page.
  assert.equal((await candidate.callTool({ name: "search_skills", arguments: { query: "design", ranking: "web-v1" } })).isError, undefined);
  const unknown = await candidate.callTool({ name: "search_skills", arguments: { ...args, unknown: true } });
  assert.equal(unknown.isError, true); assert.match(JSON.stringify(unknown.content), /unknown/);
  for (const bad of [{ ...args, author: "other", query: "@another design" }, { ...args, page: { cursor: "bad" } }, { ...args, query: "@" }]) {
    const failed = await candidate.callTool({ name: "search_skills", arguments: bad });
    assert.equal(failed.isError, true); assert.match(JSON.stringify(failed.content), /invalid_cursor/);
  }
  assert.equal((await old.callTool({ name: "search_skills", arguments: args })).isError, true);
  assert.equal((await candidate.callTool({ name: "search_skills", arguments: { ...args, ranking: "unknown" } })).isError, true);
  const plain = await connected(context, OmgskillsLibrary.fromData({ skills: rows, trending: [], goldBasket: [] }, "v"), true);
  assert.match(JSON.stringify((await plain.callTool({ name: "search_skills", arguments: args })).content), /ranking_not_supported/);
});

test("compact ranking hydrates only selected pages; missing/corrupt metadata is explicit", async context => {
  const f = catalogFixture(context, rows, true), reader = await loadCatalogReader(f.url, { ...f.options, ranking: true }) as SearchCatalogReader;
  const options = { query: "design", ranking: "web-v1" as const, page: {}, limit: 1 };
  const result = await reader.searchRankedPage(options);
  assert.equal(reader.diagnostics().detailFetches, new Set(result.skills.map(row => detailBucket(row.id))).size);
  assert.ok(reader.diagnostics().rankingBytes > 0);
  assert.ok(!f.requested.some(url => url.endsWith(f.manifest.skills.path)));
  assert.ok(result.skills.every(row => row.install_cmd));
  const oldFixture = catalogFixture(context), old = await loadCatalogReader(oldFixture.url, { ...oldFixture.options, ranking: true });
  await assert.rejects(async () => old.searchRankedPage(options), /Ranking/);
  assert.ok((await old.searchSkills({ query: "design" })).length);
  for (const url of f.files.keys()) if (url.includes("search-ranking-")) f.files.set(url, Buffer.from("bad"));
  await assert.rejects(() => loadCatalogReader(f.url, { ...f.options, ranking: true }), /integrity/);
  assert.ok((await (await loadCatalogReader(f.url, f.options)).searchSkills({ query: "design" })).length);
  const unsupported = await connected(context, old, true);
  assert.match(JSON.stringify((await unsupported.callTool({ name: "search_skills", arguments: options })).content), /ranking_not_supported/);
});

test("unrelated shard or missing signals cannot become successful empty ranked results", async context => {
  const f = catalogFixture(context, rows, true), reader = await loadCatalogReader(f.url, { ...f.options, ranking: true });
  const client = await connected(context, reader, true), args = { query: "design", ranking: "web-v1", page: {}, summary: false };
  for (const url of f.files.keys()) if (url.includes("skill-details-")) f.files.set(url, Buffer.from("[]"));
  assert.match(JSON.stringify((await client.callTool({ name: "search_skills", arguments: args })).content), /catalog_unavailable/);
  const next = catalogFixture(context, rows, true); next.files.delete(next.options.goldBasketUrl);
  const partial = await connected(context, await loadCatalogReader(next.url, { ...next.options, ranking: true }), true);
  assert.match(JSON.stringify((await partial.callTool({ name: "search_skills", arguments: args })).content), /catalog_unavailable/);
});

test("ranked readers retain validated requested records after shard eviction within the same total budget", async context => {
  const targets = [rows[0]];
  for (let i = 0; targets.length < 6; i++) {
    const next = { ...rows[0], id: `example/records:target-${i}` };
    if (!targets.some(row => detailBucket(row.id) === detailBucket(next.id))) targets.push(next);
  }
  const skills = [...targets];
  for (let i = 0; i < targets.length; i++) {
    let id = "";
    for (let n = 0; ; n++) { id = `example/fillers:${i}-${n}`; if (detailBucket(id) === detailBucket(targets[i].id)) break; }
    skills.push({ ...rows[0], id, readme_snippet: "x".repeat(15000) } as any);
  }
  const f = catalogFixture(context, skills, true), options = { ...f.options, ranking: true, cacheBytes: 64000 };
  const reader = await loadCatalogReader(f.url, options) as SearchCatalogReader;
  for (const row of targets) assert.deepEqual(await reader.getRawRecord(row.id), row);
  const before = reader.diagnostics().detailFetches;
  assert.equal(before, 6);
  assert.deepEqual(await reader.getRawRecord(targets[0].id), targets[0]);
  assert.equal(reader.diagnostics().detailFetches, before);
  assert.ok(reader.diagnostics().recordCacheBytes > 0);
  assert.ok(reader.diagnostics().detailCacheBytes <= 64000);
  const aborted = new AbortController(); aborted.abort(new Error("cancelled"));
  await assert.rejects(reader.getRawRecord(targets[0].id, aborted.signal), /cancelled/);
  const fresh = await loadCatalogReader(f.url, options) as SearchCatalogReader;
  await fresh.getRawRecord(targets[0].id);
  assert.equal(fresh.diagnostics().detailFetches, 1); // Caches never cross snapshots/readers.
  for (const budget of [0, 12000]) {
    const small = await loadCatalogReader(f.url, { ...options, cacheBytes: budget }) as SearchCatalogReader;
    for (const row of targets) await small.getRawRecord(row.id);
    const fetched = small.diagnostics().detailFetches;
    await small.getRawRecord(targets[0].id);
    assert.ok(small.diagnostics().detailFetches > fetched);
    assert.ok(small.diagnostics().detailCacheBytes <= budget);
  }
});

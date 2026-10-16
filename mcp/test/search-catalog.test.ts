import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createOmgskillsServer } from "../src/server.js";
import type { CatalogReader } from "../src/catalog-reader.js";
import { loadCatalogReader, readCatalogVersion, SearchCatalogReader } from "../src/search-catalog.js";
import { detailBucket } from "../src/search-catalog-format.mjs";
import { catalogFixture, goldBasket, rows } from "./search-catalog-fixture.js";

test("compact reads reproduce legacy search, signals, full details and curated overrides", async context => {
  const f = catalogFixture(context), compact = await loadCatalogReader(f.url, f.options);
  assert.ok(compact instanceof SearchCatalogReader);
  for (const query of ["swift", "appstore skill", "ios design", "ui design", "browser use", "", "SWIFT", "@Example", "中文", "no-match", "example/skills:swift-review", "https://github.com"]) {
    for (const limit of [1, 20, 30, 100]) assert.deepEqual(await compact.searchSkills({ query, limit }), f.legacy.searchSkills({ query, limit }), `${query}/${limit}`);
  }
  for (const options of [{ query: "", author: "EXAMPLE" }, { query: "swift", tag: "SWIFT" }, { query: "", minStars: 20 }]) {
    assert.deepEqual(await compact.searchSkills(options), f.legacy.searchSkills(options));
  }
  for (const id of [...rows.map(row => row.id), goldBasket[1].id, "missing/repo:absent"]) assert.deepEqual(await compact.getSkill(id), f.legacy.getSkill(id));
  assert.deepEqual(await compact.listGoldBasket(), f.legacy.listGoldBasket());
  assert.deepEqual(await compact.listTrending(), f.legacy.listTrending());
  assert.deepEqual(await compact.listByAuthor("Example"), f.legacy.listByAuthor("Example"));
  assert.ok(!f.requested.includes("https://catalog.test/" + f.manifest.skills.path));
  assert.deepEqual(await compact.getRawRecord(rows[0].id), rows[0]);
  // The synchronous install-record consumer keeps aliases; MCP schemas stay unchanged.
  assert.equal(f.legacy.getSkill(rows[0].id)?.install_target_name, "legacy-alias");
  assert.equal((await compact.getSkill(rows[0].id))?.repo_slug, "example/skills");
});

test("cold lookup fetches one shard, shares inflight work and retries integrity failures", async context => {
  const f = catalogFixture(context), compact = await loadCatalogReader(f.url, f.options) as SearchCatalogReader;
  assert.equal(compact.diagnostics().detailFetches, 0);
  await Promise.all(Array.from({ length: 8 }, () => compact.getSkill(rows[0].id)));
  assert.equal(compact.diagnostics().detailFetches, 1);
  await compact.getSkill("unknown/id");
  assert.equal(compact.diagnostics().detailFetches, 1);
  const fresh = await loadCatalogReader(f.url, { ...f.options, cacheBytes: 0 }) as SearchCatalogReader;
  const desc = JSON.parse(Buffer.from(f.files.get("https://catalog.test/" + f.manifest.searchCatalog.path)!).toString());
  const index = JSON.parse(Buffer.from(f.files.get("https://catalog.test/" + desc.details.path)!).toString());
  const shardUrl = "https://catalog.test/" + index.shards[detailBucket(rows[0].id)].path;
  const saved = f.files.get(shardUrl)!;
  f.files.set(shardUrl, Buffer.from("[]"));
  await assert.rejects(fresh.getSkill(rows[0].id), /integrity/);
  f.files.delete(shardUrl);
  await assert.rejects(fresh.getSkill(rows[0].id), /fetch failed/);
  f.files.set(shardUrl, saved);
  assert.deepEqual(await fresh.getSkill(rows[0].id), f.legacy.getSkill(rows[0].id));
  assert.equal(fresh.diagnostics().detailCacheBytes, 0);
});

test("shared shard reads survive consumer cancellation, eviction and bounded concurrency", async context => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...rows[0], id: `example/repo:skill-${i}`, name: `skill-${i}` }));
  const f = catalogFixture(context, many);
  let active = 0, peak = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (!String(input).includes("/skill-details-")) return f.fetcher(input, init);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    try { return await f.fetcher(input, init); } finally { active--; }
  };
  const compact = await loadCatalogReader(f.url, { ...f.options, fetcher, cacheBytes: 1000 }) as SearchCatalogReader;
  const controller = new AbortController();
  const canceled = compact.getRawRecord(many[0].id, controller.signal);
  const retained = compact.getRawRecord(many[0].id);
  controller.abort(new Error("canceled"));
  await assert.rejects(canceled, /canceled/);
  assert.deepEqual(await retained, many[0]);
  await Promise.all(many.map(row => compact.getSkill(row.id)));
  assert.ok(peak <= 4);
  assert.ok(Number(compact.diagnostics().detailCacheBytes) <= 1000);
  assert.deepEqual(await compact.getRawRecord(many[0].id), many[0]);
});

test("old manifests fall back; mixed snapshots, unsafe references and oversized data are refused", async context => {
  const f = catalogFixture(context);
  const old = { ...f.manifest, searchCatalog: undefined };
  f.files.set(f.url, Buffer.from(JSON.stringify(old)));
  const legacy = await loadCatalogReader(f.url, f.options);
  assert.deepEqual(await legacy.getSkill(rows[0].id), f.legacy.getSkill(rows[0].id));
  f.files.set(f.url, Buffer.from(JSON.stringify({ ...f.manifest, skills: { ...f.manifest.skills, bytes: 1 } })));
  await assert.rejects(loadCatalogReader(f.url, f.options), /source mismatch/);
  f.files.set(f.url, Buffer.from(JSON.stringify({ ...f.manifest, searchCatalog: { ...f.manifest.searchCatalog, path: "https://evil.test/file.json" } })));
  await assert.rejects(loadCatalogReader(f.url, f.options), /reference/);
  await assert.rejects(loadCatalogReader(f.url, { ...f.options, fetcher: async () => new Response("", { headers: { "content-length": "999999999" } }) }), /byte limit/);
  await assert.rejects(loadCatalogReader(f.url, { ...f.options, fetcher: async () => {
    const r = Response.json({}); Object.defineProperty(r, "redirected", { value: true }); return r;
  } }), /fetch failed/);
});

test("refresh versions include independently changed curation without reading the skills file", async context => {
  const f = catalogFixture(context), compact = await loadCatalogReader(f.url, f.options);
  assert.equal(await readCatalogVersion(f.url, f.options), compact.version);
  f.files.set(f.options.goldBasketUrl, Buffer.from(JSON.stringify([{ ...goldBasket[0], score: 1 }])));
  assert.notEqual(await readCatalogVersion(f.url, f.options), compact.version);
  assert.ok(!f.requested.includes("https://catalog.test/" + f.manifest.skills.path));
});

async function call(reader: CatalogReader, name: string, args: Record<string, unknown>) {
  const server = createOmgskillsServer(reader), client = new Client({ name: "parity", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try { return await client.callTool({ name, arguments: args }); }
  finally { await client.close(); await server.close(); }
}
test("all six MCP tools keep identical structured/text outputs and install plans", async context => {
  const f = catalogFixture(context), compact = await loadCatalogReader(f.url, f.options);
  const calls = [
    ["search_skills", { query: "swift" }], ["get_skill", { id: rows[0].id }],
    ["get_skill", { id: rows[1].id }], ["get_skill", { id: "missing" }],
    ["get_skills", { ids: [rows[1].id, rows[0].id, rows[1].id, "missing"] }],
    ["list_trending", {}], ["list_gold_basket", {}], ["list_by_author", { author: "EXAMPLE" }],
  ] as [string, Record<string, unknown>][];
  for (const [name, args] of calls) assert.deepEqual(await call(compact, name, args), await call(f.legacy, name, args), name);
});

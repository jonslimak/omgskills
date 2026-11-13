import assert from "node:assert/strict";
import test from "node:test";
import { OmgskillsLibrary, type Skill } from "../../../mcp/src/library.js";
import { createMcpHandler } from "../omgskills-mcp.mjs";
import type { McpLibraryLoader } from "./mcp-library.js";
import { createQuickInstallRecordReader } from "./catalog-install-record.js";
import { catalogFixture, rows } from "../../../mcp/test/search-catalog-fixture.js";

const legacy: Skill = { id: "owner/repo:alias", name: "alias", description: "Skill", author_handle: "owner",
  github_url: "https://github.com/owner/repo", install_cmd: "ln -s /tmp/repo/skills/design ~/.claude/skills/old-alias" };
const pins = { repo_slug: "owner/repo", skill_md_path: "skills/design/SKILL.md",
  repo_commit_sha: "1".repeat(40), skill_tree_sha: "2".repeat(40), skill_md_sha: "3".repeat(40), install_target_name: "old-alias" };
function loader(skills: Skill[] = [legacy]): McpLibraryLoader {
  return loaderFor(OmgskillsLibrary.fromData({ skills, trending: [], goldBasket: [] }), skills.length);
}
function loaderFor(library: OmgskillsLibrary, count = 0): McpLibraryLoader {
  const skills = { length: count };
  return { get: async () => ({ library, sourceTrack: "crawl4", loadedAt: 0, skillCount: skills.length,
    trendingCount: 0, goldBasketCount: 0 }), refresh: async () => { throw Error("unused"); },
    pendingRefresh: () => null, status: () => ({ hasSnapshot: true, refreshing: false,
      lastRefreshFailed: false, maxAgeMs: 600_000 }) };
}
const context = { waitUntil: (_work: Promise<unknown>) => {} };
const request = (query: string, method = "GET") => new Request(`https://example.test/api/catalog/install-record?${query}`, { method });

for (const [label, record] of Object.entries({ legacy, pinned: { ...legacy, ...pins },
  partial: { ...legacy, repo_commit_sha: "not-a-pin" }, emptyPin: { ...legacy, repo_slug: "" } })) {
  test(`returns intact ${label} installation fields, without the whole catalog`, async () => {
    const response = await createMcpHandler(loader([record]))(request(`id=${encodeURIComponent(record.id)}`), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 1, found: true, skill: record });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });
}
test("missing ID is an exact lookup, not search or a fallback", async () => {
  const response = await createMcpHandler(loader())(request("id=owner%2Frepo"), context);
  assert.deepEqual(await response.json(), { version: 1, found: false, skill: null });
});
for (const query of ["", "id=", "id=%20", "id=x&id=y", "id=x&repo=evil", "id=" + "a".repeat(501), "id=%00", "id=%E2%80%8B"]) {
  test(`rejects malformed query ${query.slice(0, 30)} before loading`, async () => {
    const source = loader(); source.get = async () => { throw Error("must not load"); };
    assert.equal((await createMcpHandler(source)(request(query), context)).status, 400);
  });
}
test("rejects POST and unavailable catalogs", async () => {
  const source = loader(); source.get = async () => { throw Error("offline"); };
  assert.equal((await createMcpHandler(source)(request("id=x", "POST"), context)).status, 405);
  assert.equal((await createMcpHandler(source)(request("id=x"), context)).status, 503);
});
test("bounds large records and retains the shared refresh", async () => {
  const source = loader([{ ...legacy, description: "x".repeat(256 * 1024) }]);
  const refresh = source.get(); source.pendingRefresh = () => refresh;
  const pending: Promise<unknown>[] = [];
  assert.equal((await createMcpHandler(source)(request(`id=${legacy.id}`), { waitUntil: work => { pending.push(work); } })).status, 503);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
});

// Cold start: answered from the detail index and one shard, identical to the full catalog's answer.
function coldLoader(library: OmgskillsLibrary, full: Promise<void> = Promise.resolve()): McpLibraryLoader & { gets: number } {
  const source = { gets: 0, get: async () => { source.gets++; await full;
    return { library, sourceTrack: "crawl4", loadedAt: 0, skillCount: 0, trendingCount: 0, goldBasketCount: 0 }; },
  refresh: async () => { throw Error("unused"); }, pendingRefresh: () => null,
  status: () => ({ hasSnapshot: false, refreshing: source.gets > 0, lastRefreshFailed: false, maxAgeMs: 600_000 }) };
  return source;
}
const never = new Promise<void>(() => {});
const shardRequests = (requested: string[]) => requested.filter(url => /skill-details-/.test(url)).length;

test("cold quick records are byte-identical to the full catalog's, without waiting for it", async t => {
  const f = catalogFixture(t);
  const quick = createQuickInstallRecordReader(f.url, f.options);
  for (const skill of rows) {
    const query = `id=${encodeURIComponent(skill.id)}`;
    const work: Promise<unknown>[] = [];
    const cold = coldLoader(f.legacy, never);
    const response = await createMcpHandler(cold, quick)(request(query), { waitUntil: promise => { work.push(promise); } });
    const full = await createMcpHandler(loader(rows))(request(query), context);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await full.text(), skill.id);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(cold.gets, 1, "the full load starts for later warm requests");
    assert.equal(work.length, 1);
  }
  const body = await (await createMcpHandler(coldLoader(f.legacy, never), quick)(request(`id=${encodeURIComponent(rows[0].id)}`), context)).json();
  assert.equal(body.skill.repo_commit_sha, "a".repeat(40));
  assert.equal(body.skill.install_target_name, "legacy-alias");
  assert.equal(body.skill.install_cmd, "legacy swift", "the catalog record, not the curated copy");
  assert.equal(f.requested.filter(url => /skills-[a-f0-9]{12}\.json|search-skills-|gold\.json|trending-/.test(url)).length, 0,
    "no full skills, search index or signal reads");
});

for (const [label, id] of Object.entries({ unknown: "owner/missing:skill", cased: rows[0].id.toUpperCase(),
  curated: "curated/only:extra", prefixed: `catalog:${rows[2].id}` })) {
  test(`cold ${label} IDs answer exactly as the full catalog does`, async t => {
    const f = catalogFixture(t);
    const query = `id=${encodeURIComponent(id)}`;
    const response = await createMcpHandler(coldLoader(f.legacy), createQuickInstallRecordReader(f.url, f.options))(request(query), context);
    const full = await createMcpHandler(loaderFor(f.legacy))(request(query), context);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await full.text());
  });
}

test("a failing or incomplete quick read falls back to the full catalog", async t => {
  const f = catalogFixture(t);
  const query = `id=${encodeURIComponent(rows[0].id)}`;
  const expected = await (await createMcpHandler(loaderFor(f.legacy))(request(query), context)).text();
  const offline = createQuickInstallRecordReader(f.url, { fetcher: async () => new Response("down", { status: 503 }) });
  assert.equal(await (await createMcpHandler(coldLoader(f.legacy), offline)(request(query), context)).text(), expected);
  const incomplete = async () => ({ ...rows[0], install_cmd: undefined }) as unknown as Skill;
  assert.equal(await (await createMcpHandler(coldLoader(f.legacy), incomplete)(request(query), context)).text(), expected);
});

test("quick reads only run cold, and unavailable catalogs still fail closed", async t => {
  const f = catalogFixture(t);
  let quickCalls = 0;
  const counting = async (id: string) => { quickCalls++; return createQuickInstallRecordReader(f.url, f.options)(id); };
  await createMcpHandler(loader(rows), counting)(request(`id=${encodeURIComponent(rows[0].id)}`), context);
  assert.equal(quickCalls, 0, "warm snapshots answer directly");
  for (const query of ["", "id=x&id=y", "id=%00"]) {
    assert.equal((await createMcpHandler(coldLoader(f.legacy), counting)(request(query), context)).status, 400);
  }
  assert.equal((await createMcpHandler(coldLoader(f.legacy), counting)(request("id=x", "POST"), context)).status, 405);
  assert.equal(quickCalls, 0, "malformed requests never read");
  const down = coldLoader(f.legacy, Promise.reject(Error("offline")));
  assert.equal((await createMcpHandler(down, counting)(request("id=owner%2Fmissing%3Askill"), context)).status, 503);
  const manifests = () => f.requested.filter(url => url.endsWith("/manifest.json")).length;
  const [shards, before] = [shardRequests(f.requested), manifests()];
  const reader = createQuickInstallRecordReader(f.url, f.options);
  assert.equal((await reader(rows[0].id))?.id, rows[0].id);
  assert.equal((await reader(rows[1].id))?.id, rows[1].id);
  assert.equal(manifests() - before, 1, "the detail index is reused");
  assert.equal(shardRequests(f.requested) - shards, 2, "one shard per record");
});

test("a quick hit is answered even when the full load then fails", async t => {
  const f = catalogFixture(t);
  const query = `id=${encodeURIComponent(rows[0].id)}`;
  const expected = await (await createMcpHandler(loaderFor(f.legacy))(request(query), context)).text();
  const work: Promise<unknown>[] = [];
  const down = coldLoader(f.legacy, Promise.reject(Error("offline")));
  const response = await createMcpHandler(down, createQuickInstallRecordReader(f.url, f.options))(request(query),
    { waitUntil: promise => { work.push(promise); } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expected);
  await Promise.all(work);
});

test("after a full snapshot from another track, cold requests skip the quick reader", async t => {
  const f = catalogFixture(t);
  let hasSnapshot = false;
  const source: McpLibraryLoader = { get: async () => { hasSnapshot = true;
    return { library: f.legacy, sourceTrack: "v2", loadedAt: 0, skillCount: 0, trendingCount: 0, goldBasketCount: 0 }; },
  refresh: async () => { throw Error("unused"); }, pendingRefresh: () => null,
  status: () => ({ hasSnapshot, refreshing: false, lastRefreshFailed: false, maxAgeMs: 600_000 }) };
  const inner = createQuickInstallRecordReader(f.url, { ...f.options, track: "crawl4" });
  let calls = 0;
  const quick = Object.assign(async (id: string) => { calls++; return inner(id); }, { track: "crawl4" }) as typeof inner;
  const handler = createMcpHandler(source, quick);
  const query = `id=${encodeURIComponent(rows[0].id)}`;
  assert.equal((await handler(request(query), context)).status, 200);
  assert.equal(calls, 1, "a fresh instance reads quickly");
  assert.equal(quick.seenTrack, "v2");
  hasSnapshot = false; // as if the snapshot were dropped: the v2 history still decides
  assert.equal((await handler(request(query), context)).status, 200);
  assert.equal(calls, 1);
});

test("a failed shard read clears the cached index so the next request reloads it", async t => {
  const f = catalogFixture(t);
  let failShards = true;
  const fetcher: typeof fetch = async (input, init) =>
    failShards && /skill-details-/.test(String(input)) ? new Response("gone", { status: 404 }) : f.fetcher(input, init);
  const reader = createQuickInstallRecordReader(f.url, { ...f.options, fetcher });
  const manifests = () => f.requested.filter(url => url.endsWith("/manifest.json")).length;
  await assert.rejects(reader(rows[0].id));
  failShards = false;
  const before = manifests();
  assert.equal((await reader(rows[0].id))?.id, rows[0].id);
  assert.equal(manifests() - before, 1, "the index was reloaded");
});

test("concurrent reads of one shard share a single fetch", async t => {
  const f = catalogFixture(t);
  const reader = createQuickInstallRecordReader(f.url, f.options);
  await reader(rows[2].id); // load the index
  const before = shardRequests(f.requested);
  const results = await Promise.all([reader(rows[0].id), reader(rows[0].id), reader(rows[0].id)]);
  assert.deepEqual(results.map(row => row?.id), [rows[0].id, rows[0].id, rows[0].id]);
  assert.equal(shardRequests(f.requested) - before, 1);
  await reader(rows[0].id);
  assert.equal(shardRequests(f.requested) - before, 2, "nothing is cached once settled");
});

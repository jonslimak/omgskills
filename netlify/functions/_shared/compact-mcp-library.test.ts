import assert from "node:assert/strict";
import test from "node:test";
import { createCompactMcpLibraryLoader } from "./compact-mcp-library.js";
import { createCompactMcpHandler } from "../omgskills-mcp.mjs";
import { catalogFixture, rows, goldBasket } from "../../../mcp/test/search-catalog-fixture.js";

test("cold readers share one snapshot; unchanged refresh skips index/detail downloads", async context => {
  const f = catalogFixture(context);
  let now = 0;
  const loader = createCompactMcpLibraryLoader({ ...f.options, now: () => now, maxAgeMs: 100, tracks: [{ name: "test", manifestUrl: f.url }] });
  const snapshots = await Promise.all(Array.from({ length: 8 }, () => loader.get()));
  assert.ok(snapshots.every(s => s === snapshots[0]));
  const firstLoads = f.requested.filter(url => url.includes("search-skills-")).length;
  now = 101;
  assert.equal(await loader.get(), snapshots[0]);
  await loader.pendingRefresh();
  assert.equal((await loader.get()).library, snapshots[0].library);
  assert.equal(f.requested.filter(url => url.includes("search-skills-")).length, firstLoads);
  f.files.set(f.options.goldBasketUrl, Buffer.from(JSON.stringify([{ ...goldBasket[0], score: 1 }])));
  await loader.refresh();
  assert.notEqual((await loader.get()).library, snapshots[0].library);
});

test("failed refresh retains usable data and missing optional signals are retried", async context => {
  const f = catalogFixture(context);
  f.files.delete(f.options.goldBasketUrl);
  const loader = createCompactMcpLibraryLoader({ ...f.options, tracks: [{ name: "test", manifestUrl: f.url }] });
  const first = await loader.get();
  assert.equal(first.library.version, undefined);
  f.files.set(f.options.goldBasketUrl, Buffer.from(JSON.stringify(goldBasket)));
  const complete = await loader.refresh();
  assert.ok(complete.library.version);
  f.files.delete(f.url);
  assert.equal(await loader.refresh(), complete);
  assert.equal(loader.status().lastRefreshFailed, true);
});

test("an old request stays on its original snapshot across refresh", async context => {
  const f = catalogFixture(context), next = catalogFixture(context, rows.map(row => ({ ...row, install_cmd: "new generation" })));
  const loader = createCompactMcpLibraryLoader({ ...f.options, tracks: [{ name: "test", manifestUrl: f.url }] });
  const before = await loader.get();
  // Preserve old immutable files while the manifest changes, as publication must.
  for (const [url, bytes] of next.files) f.files.set(url, bytes);
  const after = await loader.refresh();
  assert.notEqual(before.library, after.library);
  assert.equal((await before.library.getSkill(rows[0].id))?.install_cmd, rows[0].install_cmd);
  assert.equal((await after.library.getSkill(rows[0].id))?.install_cmd, "new generation");
});

test("fallback snapshots are coherent and a recovered higher-priority track is retried", async context => {
  const f = catalogFixture(context);
  let primaryUp = false;
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input);
    if (url.startsWith("https://primary.test/") && !primaryUp) return Promise.resolve(new Response("down", { status: 503 }));
    return f.fetcher(url.replace("https://primary.test/", "https://catalog.test/"), init);
  };
  const loader = createCompactMcpLibraryLoader({ ...f.options, fetcher, tracks: [
    { name: "primary", manifestUrl: "https://primary.test/manifest.json" }, { name: "fallback", manifestUrl: f.url },
  ] });
  assert.equal((await loader.get()).sourceTrack, "fallback");
  primaryUp = true;
  assert.equal((await loader.refresh()).sourceTrack, "primary");
});

test("the candidate handler serves existing MCP routes and diagnostics without changing production registration", async context => {
  const f = catalogFixture(context);
  const loader = createCompactMcpLibraryLoader({ ...f.options, tracks: [{ name: "test", manifestUrl: f.url }] });
  const handler = createCompactMcpHandler(loader);
  const work: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => { work.push(promise); } };
  const response = await handler(new Request("https://host.test/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_skill", arguments: { id: rows[0].id } } }) }), ctx);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.result.structuredContent.skill.pinned_install.commit_sha, "a".repeat(40));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const health = await (await handler(new Request("https://host.test/mcp/health"), ctx)).json();
  assert.equal(health.catalog.mode, "compact");
  assert.equal(health.catalog.detailFetches, 1);
  assert.equal(health.skillCount, rows.length);
  await Promise.allSettled(work);
});

test("candidate paging is opt-in and cursors survive only unchanged complete snapshots", async context => {
  const f = catalogFixture(context);
  const loader = createCompactMcpLibraryLoader({ ...f.options, tracks: [{ name: "test", manifestUrl: f.url }] });
  const work: Promise<unknown>[] = [], ctx = { waitUntil: (promise: Promise<unknown>) => { work.push(promise); } };
  const call = async (enabled: boolean, method: string, params?: unknown) => {
    const handler = createCompactMcpHandler(loader, { paging: enabled });
    const response = await handler(new Request("https://host.test/mcp", { method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), ctx);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.headers.get("server-timing"));
    return (await response.json()).result;
  };
  assert.equal("page" in (await call(false, "tools/list")).tools[0].inputSchema.properties, false);
  assert.equal("page" in (await call(true, "tools/list")).tools[0].inputSchema.properties, true);
  // Both design matches satisfy the public schema; the Swift root fixture has an intentional null SHA.
  const args = { query: "design", limit: 1, page: {} };
  const first = (await call(true, "tools/call", { name: "search_skills", arguments: args })).structuredContent;
  assert.equal(first.page.total, 2);
  const cursor = first.page.nextCursor;
  const before = await loader.get(), held = before.library.searchPage!({ query: "design", limit: 1, page: { cursor } });
  await loader.refresh();
  const unchanged = await call(true, "tools/call", { name: "search_skills", arguments: { ...args, page: { cursor } } });
  assert.equal(unchanged.isError, undefined, JSON.stringify(unchanged));
  f.files.set(f.options.goldBasketUrl, Buffer.from(JSON.stringify([{ ...goldBasket[0], score: 2 }])));
  await loader.refresh();
  const stale = await call(true, "tools/call", { name: "search_skills", arguments: { ...args, page: { cursor } } });
  assert.equal(stale.isError, true);
  assert.match(JSON.stringify(stale.content), /catalog_snapshot_changed/);
  assert.equal((await held).skills.length, 1);
  await Promise.allSettled(work);
});

test("ranked HTTP reads preserve no-store, immutable snapshots and failed-refresh recovery", async context => {
  const f = catalogFixture(context, rows, true), options = { ...f.options, ranking: true, tracks: [{ name: "test", manifestUrl: f.url }] };
  const loader = createCompactMcpLibraryLoader(options), handler = createCompactMcpHandler(loader, { paging: true, ranking: true });
  const work: Promise<unknown>[] = [], ctx = { waitUntil: (promise: Promise<unknown>) => { work.push(promise); } };
  const call = async (args: unknown) => {
    const response = await handler(new Request("https://host.test/mcp", { method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_skills", arguments: args } }) }), ctx);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return (await response.json()).result;
  };
  const args = { query: "design", ranking: "web-v1" as const, limit: 1, page: {} };
  const first = await call(args), cursor = first.structuredContent.page.nextCursor;
  assert.equal(first.isError, undefined);
  const before = await loader.get(), held = before.library.searchRankedPage!(args);
  await loader.refresh();
  assert.equal((await call({ ...args, page: { cursor } })).isError, undefined);
  const next = catalogFixture(context, rows.map(row => ({ ...row, provenance_type: "catalog" })), true);
  for (const [url, bytes] of next.files) f.files.set(url, bytes);
  await loader.refresh();
  assert.match(JSON.stringify((await call({ ...args, page: { cursor } })).content), /catalog_snapshot_changed/);
  assert.equal((await held).skills.length, 1);
  const current = await loader.get();
  // Force full loading rather than an unchanged-manifest early return.
  f.files.set(f.options.goldBasketUrl, Buffer.from(JSON.stringify([{ ...goldBasket[0], score: 5 }])));
  for (const url of f.files.keys()) if (url.includes("search-ranking-")) f.files.set(url, Buffer.from("bad"));
  assert.equal(await loader.refresh(), current);
  assert.equal(loader.status().lastRefreshFailed, true);
  await Promise.allSettled(work);
});

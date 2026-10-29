import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createRefreshingCatalog, catalogRefreshIntervalMs } from "../src/catalog-refresh.js";
import { catalogFixture, rows } from "./search-catalog-fixture.js";
import { sha256 } from "../src/search-catalog-format.mjs";
import { catalogTracks } from "../src/catalog-tracks.js";

const keys = ["OMGSKILLS_SKILLS_PATH", "OMGSKILLS_TRENDING_PATH", "OMGSKILLS_GOLD_BASKET_PATH", "OMGSKILLS_MANIFEST_URL", "OMGSKILLS_GOLD_BASKET_URL"] as const;
function setup(context: TestContext) {
  const before = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) delete process.env[key];
  process.env.OMGSKILLS_MANIFEST_URL = "https://catalog.test/manifest.json";
  process.env.OMGSKILLS_GOLD_BASKET_URL = "https://catalog.test/gold.json";
  context.after(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = catalogFixture(context, rows, true);
  const messages: string[] = [];
  return { fixture, messages, options: { fetcher: fixture.fetcher, log: (message: string) => messages.push(message) } };
}

test("automatically replaces a changed catalog without restarting, leaving existing readers intact", async context => {
  const { fixture, options, messages } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  const old = catalog.get();
  const added = { ...rows[0], id: "example/skills:new-skill", name: "new-skill" };
  const next = catalogFixture(context, [...rows, added], true);
  for (const [url, bytes] of next.files) fixture.files.set(url, bytes);
  context.mock.timers.tick(catalogRefreshIntervalMs - 1);
  assert.equal(catalog.get(), old);
  context.mock.timers.tick(1);
  assert.equal(catalog.get(), old);
  await catalog.refresh();
  assert.notEqual(catalog.get(), old);
  assert.equal((await catalog.get().getSkill(added.id))?.id, added.id);
  assert.equal(await old.getSkill(added.id), undefined);
  assert.equal(messages.length, 1);
});

test("unchanged checks reuse the reader and fetch only manifest and curated metadata", async context => {
  const { fixture, options } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  const old = catalog.get();
  fixture.requested.length = 0;
  await catalog.refresh();
  assert.equal(catalog.get(), old);
  assert.deepEqual(fixture.requested, [fixture.url, "https://catalog.test/gold.json"]);
});

test("curated and install metadata changes are included in version checks", async context => {
  const { fixture, options } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  let old = catalog.get();
  fixture.files.set("https://catalog.test/gold.json", Buffer.from("[]"));
  await catalog.refresh();
  assert.notEqual(catalog.get(), old);
  assert.deepEqual(await catalog.get().listGoldBasket(), []);
  old = catalog.get();
  const changed = catalogFixture(context, rows.map((row, i) => i === 0 ? { ...row, repo_commit_sha: "d".repeat(40) } : row), true);
  for (const [url, bytes] of changed.files) fixture.files.set(url, bytes);
  await catalog.refresh();
  assert.notEqual(catalog.get(), old);
  assert.equal((await catalog.get().getSkill(rows[0].id))?.repo_commit_sha, "d".repeat(40));
});

test("a trending-only publication refreshes even when skills are unchanged", async context => {
  const { fixture, options } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  const old = catalog.get();
  const bytes = Buffer.from(JSON.stringify([{ id: rows[1].id, trending_rank: 1 }]));
  const hash = sha256(bytes);
  const manifest = { ...fixture.manifest, trending: { path: `trending-${hash.slice(0, 12)}.json`, sha256: hash, bytes: bytes.length } };
  fixture.files.set(fixture.url, Buffer.from(JSON.stringify(manifest)));
  fixture.files.set(`https://catalog.test/${manifest.trending.path}`, bytes);
  await catalog.refresh();
  assert.notEqual(catalog.get(), old);
  assert.equal((await catalog.get().listTrending(1))[0].id, rows[1].id);
});

test("failed refresh of a chosen remote catalog does not silently switch tracks", async context => {
  const { fixture, options } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  fixture.requested.length = 0;
  fixture.files.delete(fixture.url);
  await catalog.refresh();
  assert.deepEqual(fixture.requested, [fixture.url]);
  assert.ok(!fixture.requested.some(url => catalogTracks.some(track => track.manifestUrl === url)));
});

test("startup fallback remains on the successfully selected track for later checks", async context => {
  const { fixture, options } = setup(context);
  delete process.env.OMGSKILLS_MANIFEST_URL;
  const requested: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("https://omgskills.com/data/crawl4/")) return Promise.resolve(new Response("unavailable", { status: 503 }));
    return fixture.fetcher(url.replace("https://omgskills.com/data/v2/", "https://catalog.test/"), init);
  };
  const catalog = await createRefreshingCatalog({ ...options, fetcher });
  context.after(catalog.stop);
  assert.deepEqual(requested.filter(url => url.endsWith("manifest.json")), catalogTracks.slice(0, 2).map(track => track.manifestUrl));
  requested.length = 0;
  await catalog.refresh();
  assert.deepEqual(requested, [catalogTracks[1].manifestUrl, "https://catalog.test/gold.json"]);
});

test("a fully local setup remains offline through timer ticks and manual checks", async context => {
  const { options } = setup(context);
  for (const [key, name] of [["OMGSKILLS_SKILLS_PATH", "skills"], ["OMGSKILLS_TRENDING_PATH", "trending"], ["OMGSKILLS_GOLD_BASKET_PATH", "gold-basket"]]) {
    process.env[key] = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  }
  let requests = 0;
  const catalog = await createRefreshingCatalog({ ...options, fetcher: async () => { requests++; throw new Error("Network forbidden"); } });
  context.after(catalog.stop);
  context.mock.timers.tick(24 * 60 * 60_000);
  await catalog.refresh();
  assert.equal(requests, 0);
  assert.equal((await catalog.get().getSkill("openai/codex:mcp-builder"))?.id, "openai/codex:mcp-builder");
});

test("corrupt replacement assets keep the last catalog and a later valid refresh recovers", async context => {
  const { fixture, options, messages } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  const old = catalog.get();
  const changed = catalogFixture(context, rows.slice(0, 2), true);
  for (const [url, bytes] of changed.files) fixture.files.set(url, bytes);
  const badUrl = `https://catalog.test/${changed.manifest.searchCatalog.path}`;
  fixture.files.set(badUrl, Buffer.from("{}"));
  await catalog.refresh();
  assert.equal(catalog.get(), old);
  assert.match(messages[0], /keeping/i);
  fixture.files.set(badUrl, changed.files.get(badUrl)!);
  await catalog.refresh();
  assert.notEqual(catalog.get(), old);
  assert.equal(catalog.get().getStats().skills, 2);
});

test("a missing optional signal cannot replace a usable catalog with partial data", async context => {
  const { fixture, options } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  context.after(catalog.stop);
  const old = catalog.get();
  const changed = catalogFixture(context, rows.slice(0, 2), true);
  for (const [url, bytes] of changed.files) fixture.files.set(url, bytes);
  fixture.files.delete(`https://catalog.test/${changed.manifest.trending.path}`);
  await catalog.refresh();
  assert.equal(catalog.get(), old);
});

test("overlapping refreshes share one request and stop aborts it without a late swap", async context => {
  const { fixture, options, messages } = setup(context);
  let block = false;
  let refreshes = 0;
  let signal: AbortSignal | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    if (block) {
      refreshes++;
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    }
    return fixture.fetcher(input, init);
  };
  const catalog = await createRefreshingCatalog({ ...options, fetcher });
  context.after(catalog.stop);
  const old = catalog.get();
  block = true;
  const first = catalog.refresh();
  assert.equal(catalog.refresh(), first);
  assert.equal(refreshes, 1);
  catalog.stop();
  assert.equal(signal?.aborted, true);
  await first;
  assert.equal(catalog.get(), old);
  context.mock.timers.tick(24 * 60 * 60_000);
  await catalog.refresh();
  assert.equal(refreshes, 1);
  assert.equal(messages.length, 0);
});

test("offline failures back off without changing readers or logging URLs and secrets", async context => {
  const { fixture, options, messages } = setup(context);
  let offline = false;
  let checks = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (offline) { checks++; throw new Error("https://example.test/?token=private-value"); }
    return fixture.fetcher(input, init);
  };
  const catalog = await createRefreshingCatalog({ ...options, fetcher });
  context.after(catalog.stop);
  const old = catalog.get();
  offline = true;
  context.mock.timers.tick(catalogRefreshIntervalMs);
  await catalog.refresh();
  assert.equal(checks, 1);
  context.mock.timers.tick(catalogRefreshIntervalMs);
  await catalog.refresh();
  assert.equal(checks, 2);
  context.mock.timers.tick(catalogRefreshIntervalMs);
  assert.equal(checks, 2);
  context.mock.timers.tick(catalogRefreshIntervalMs);
  await catalog.refresh();
  assert.equal(checks, 3);
  context.mock.timers.tick(4 * catalogRefreshIntervalMs);
  await catalog.refresh();
  assert.equal(checks, 4);
  context.mock.timers.tick(5 * catalogRefreshIntervalMs);
  assert.equal(checks, 4);
  context.mock.timers.tick(catalogRefreshIntervalMs);
  await catalog.refresh();
  assert.equal(checks, 5);
  assert.match(messages.at(-1)!, /60 minutes/);
  assert.equal(catalog.get(), old);
  assert.ok(messages.every(message => !/private-value|example.test/.test(message)));
  offline = false;
  await catalog.refresh();
  fixture.requested.length = 0;
  context.mock.timers.tick(catalogRefreshIntervalMs);
  await catalog.refresh();
  assert.equal(fixture.requested.length, 2);
});

for (const key of ["OMGSKILLS_SKILLS_PATH", "OMGSKILLS_TRENDING_PATH", "OMGSKILLS_GOLD_BASKET_PATH"] as const) {
  test(`${key} keeps its existing data and disables new background traffic`, async context => {
    const { fixture, options } = setup(context);
    const name = key === "OMGSKILLS_SKILLS_PATH" ? "skills" : key === "OMGSKILLS_TRENDING_PATH" ? "trending" : "gold-basket";
    process.env[key] = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
    const catalog = await createRefreshingCatalog(options);
    context.after(catalog.stop);
    const old = catalog.get();
    fixture.requested.length = 0;
    context.mock.timers.tick(24 * 60 * 60_000);
    await catalog.refresh();
    assert.equal(catalog.get(), old);
    assert.deepEqual(fixture.requested, []);
  });
}

test("configured missing files and startup failures still fail rather than falling back silently", async context => {
  const { options } = setup(context);
  process.env.OMGSKILLS_SKILLS_PATH = "/missing/omgskills-test-skills.json";
  await assert.rejects(createRefreshingCatalog(options), { code: "ENOENT" });
});

test("stopping an idle catalog cancels future refreshes", async context => {
  const { fixture, options } = setup(context);
  const catalog = await createRefreshingCatalog(options);
  fixture.requested.length = 0;
  catalog.stop();
  catalog.stop();
  context.mock.timers.tick(24 * 60 * 60_000);
  await catalog.refresh();
  assert.deepEqual(fixture.requested, []);
});

test("the refresh timer is unreferenced and is cleared on shutdown", async context => {
  const { options } = setup(context);
  let unrefs = 0;
  const handle = { unref() { unrefs++; } } as ReturnType<typeof setTimeout>;
  context.mock.method(globalThis, "setTimeout", (_callback: () => void, delay: number) => {
    assert.equal(delay, catalogRefreshIntervalMs);
    return handle;
  });
  const cleared: unknown[] = [];
  context.mock.method(globalThis, "clearTimeout", value => { cleared.push(value); });
  const catalog = await createRefreshingCatalog(options);
  assert.equal(unrefs, 1);
  catalog.stop();
  assert.deepEqual(cleared, [handle]);
});

test("default refresh diagnostics use stderr and never the stdio protocol output", async context => {
  const { fixture } = setup(context);
  const errors: string[] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { errors.push(args.join(" ")); });
  context.mock.method(console, "log", () => { assert.fail("Refresh wrote to stdout"); });
  const catalog = await createRefreshingCatalog({ fetcher: fixture.fetcher });
  context.after(catalog.stop);
  fixture.files.delete(fixture.url);
  await catalog.refresh();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\[omgskills-mcp\].*keeping previous data/);
});

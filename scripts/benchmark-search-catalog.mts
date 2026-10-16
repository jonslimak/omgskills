#!/usr/bin/env node
// Offline only: fresh child processes measure reads from one frozen local snapshot.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { OmgskillsLibrary, type SearchOptions, type Skill } from "../mcp/src/library.js";
import { loadCatalogReader, SearchCatalogReader } from "../mcp/src/search-catalog.js";
import { detailBucket, sha256 } from "../mcp/src/search-catalog-format.mjs";
import { buildSearchCatalog, validateSearchCatalog } from "./search-catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://offline.test/";
const queries: SearchOptions[] = [
  { query: "appstore skill", limit: 20 }, { query: "ios design", limit: 30 },
  { query: "ui design", limit: 100 }, { query: "browser use", limit: 30 },
  { query: "swiftui-pro", limit: 30 }, { query: "APPSTORE", limit: 20 },
  { query: "@anthropics", limit: 30 }, { query: "中文", limit: 20 },
  { query: "", limit: 30 }, { query: "no-result-73e73b2c", limit: 100 },
];
type Config = { dir: string; detailId: string };
async function localFetch(dir: string) {
  const requests: { path: string; bytes: number }[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin + "/", origin);
    const name = url.pathname.slice(1);
    assert.equal(basename(name), name);
    const bytes = await readFile(join(dir, name));
    requests.push({ path: name, bytes: bytes.length });
    return new Response(bytes, { headers: { "content-type": "application/json" } });
  };
  return { requests, fetcher };
}
const sumBytes = (requests: { bytes: number }[]) => requests.reduce((sum, row) => sum + row.bytes, 0);
const timed = async <T,>(fn: () => T | Promise<T>) => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
};
function gc() { (globalThis as { gc?: () => void }).gc?.(); }

async function sample(configPath: string, mode: string, operation: string) {
  const config: Config = JSON.parse(await readFile(configPath, "utf8"));
  const f = await localFetch(config.dir);
  const options = { fetcher: f.fetcher, goldBasketUrl: origin + "gold.json" };
  const loaded = await timed(() => mode === "compact"
    ? loadCatalogReader(origin + "manifest.json", options)
    : OmgskillsLibrary.load({ ...options, manifestUrl: origin + "legacy-manifest.json" }));
  const library = loaded.value;
  const initBytes = sumBytes(f.requests), initRequests = f.requests.length;
  const cold = await timed(() => operation === "detail" ? library.getSkill(config.detailId) : library.searchSkills(queries[0]));
  const coldBytes = sumBytes(f.requests), coldRequests = f.requests.length;
  const firstUse = [];
  for (const query of queries) firstUse.push((await timed(async () => JSON.stringify(await library.searchSkills(query)))).ms);
  const warm = [], warmDetail = [];
  for (const query of queries) warm.push((await timed(async () => JSON.stringify(await library.searchSkills(query)))).ms);
  await library.getSkill(config.detailId);
  for (let i = 0; i < 10; i++) warmDetail.push((await timed(() => library.getSkill(config.detailId))).ms);
  const parallel = await timed(() => Promise.all(Array.from({ length: 8 }, () => library.searchSkills(queries[0]))));
  gc();
  const memory = process.memoryUsage();
  return { mode, operation, initMs: loaded.ms, hydrationMs: cold.ms, totalColdMs: loaded.ms + cold.ms,
    initBytes, coldBytes, initRequests, coldRequests, firstUseSequentialMs: firstUse, warmSequentialMs: warm, warmDetailMs: warmDetail,
    sharedProcessEightParallelMs: parallel.ms,
    heapUsed: memory.heapUsed, rss: memory.rss, peakRss: process.resourceUsage().maxRSS * 1024,
    diagnostics: library instanceof SearchCatalogReader ? library.diagnostics() : null,
    fullCatalogFetched: f.requests.some(row => /^skills-/.test(row.path)),
    responseBytes: Buffer.byteLength(JSON.stringify(cold.value)), requests: f.requests };
}

function median(values: number[]) { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function distribution(values: number[]) { return { min: Math.min(...values), p50: median(values), max: Math.max(...values) }; }

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "omgskills-c1-benchmark-"));
  const sourceDir = join(root, "site/data/crawl4");
  const originalManifest = JSON.parse(await readFile(join(sourceDir, "manifest.json"), "utf8"));
  for (const ref of [originalManifest.skills, originalManifest.trending]) await copyFile(join(sourceDir, ref.path), join(dir, ref.path));
  await copyFile(join(root, "index/gold-basket.json"), join(dir, "gold.json"));
  const legacyManifest = { skills: originalManifest.skills, trending: originalManifest.trending };
  await writeFile(join(dir, "legacy-manifest.json"), JSON.stringify(legacyManifest));
  const searchCatalog = buildSearchCatalog(dir, originalManifest.skills, { generatedAt: originalManifest.generatedAt });
  const manifest = { ...legacyManifest, searchCatalog };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  const closure = validateSearchCatalog(dir, manifest)!;
  assert.deepEqual(buildSearchCatalog(dir, originalManifest.skills, { generatedAt: originalManifest.generatedAt }), searchCatalog);
  const sourceBytes = await readFile(join(dir, originalManifest.skills.path));
  const source: Skill[] = JSON.parse(sourceBytes.toString());
  const f = await localFetch(dir);
  const options = { fetcher: f.fetcher, goldBasketUrl: origin + "gold.json" };
  const legacy = await OmgskillsLibrary.load({ ...options, manifestUrl: origin + "legacy-manifest.json" });
  const compact = await loadCatalogReader(origin + "manifest.json", options);
  assert.ok(compact instanceof SearchCatalogReader);
  let queryChecks = 0;
  const fixedQueries = [...queries, { query: source[0].id }, { query: "", author: source[0].author_handle },
    { query: "", tag: source.find(row => row.tags?.length)?.tags?.[0] }, { query: "", minStars: 1000 }];
  for (const query of fixedQueries) for (const limit of [20, 30, 100]) {
    assert.deepEqual(await compact.searchSkills({ ...query, limit }), legacy.searchSkills({ ...query, limit }));
    queryChecks++;
  }
  for (const limit of [20, 30, 100]) {
    assert.deepEqual(await compact.listTrending(limit), legacy.listTrending(limit));
    assert.deepEqual(await compact.listGoldBasket(limit), legacy.listGoldBasket(limit));
    assert.deepEqual(await compact.listByAuthor(source[0].author_handle, limit), legacy.listByAuthor(source[0].author_handle, limit));
  }
  // Bucket ordering visits each raw shard once rather than churning the bounded LRU.
  const bucketed = new Map<string, Skill[]>();
  for (const row of source) {
    const bucket = detailBucket(row.id);
    if (!bucketed.has(bucket)) bucketed.set(bucket, []);
    bucketed.get(bucket)!.push(row);
  }
  for (const records of bucketed.values()) for (const row of records) {
    assert.deepEqual(await compact.getRawRecord(row.id), row);
    assert.deepEqual(await compact.getSkill(row.id), legacy.getSkill(row.id));
  }
  const inventory = [];
  for (const name of [...new Set(closure.paths)].sort()) {
    const bytes = await readFile(join(dir, name));
    inventory.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const projection = await readFile(join(dir, closure.descriptor.search.path));
  const metadataBytes = searchCatalog.bytes + closure.descriptor.details.bytes;
  assert.ok(projection.length + metadataBytes < 35_000_000);
  assert.ok((projection.length + metadataBytes) / sourceBytes.length < 0.45);
  const configPath = join(dir, "sample-config.json");
  await writeFile(configPath, JSON.stringify({ dir, detailId: source[0].id }));
  const samples: Awaited<ReturnType<typeof sample>>[] = [];
  for (const operation of ["search", "detail"]) for (let iteration = 0; iteration < 3; iteration++) {
    for (const mode of ["legacy", "compact"]) {
      samples.push(JSON.parse(execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", fileURLToPath(import.meta.url), "--sample", configPath, mode, operation],
        { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })));
    }
  }
  const summary = Object.fromEntries(["search", "detail"].map(operation => [operation,
    Object.fromEntries(["legacy", "compact"].map(mode => {
      const rows = samples.filter(row => row.mode === mode && row.operation === operation);
      return [mode, { samples: rows.length, initMs: distribution(rows.map(row => row.initMs)),
        totalColdMs: distribution(rows.map(row => row.totalColdMs)), hydrationMs: distribution(rows.map(row => row.hydrationMs)),
        warmSearchMs: distribution(rows.flatMap(row => row.warmSequentialMs)),
        firstUseSearchMs: distribution(rows.flatMap(row => row.firstUseSequentialMs)),
        warmDetailMs: distribution(rows.flatMap(row => row.warmDetailMs)),
        sharedProcessEightParallelMs: distribution(rows.map(row => row.sharedProcessEightParallelMs)),
        coldBytes: rows[0].coldBytes, coldRequests: rows[0].coldRequests,
        heapUsed: distribution(rows.map(row => row.heapUsed)), peakRss: distribution(rows.map(row => row.peakRss)) }];
    }))]));
  assert.ok(samples.filter(row => row.mode === "compact").every(row => !row.fullCatalogFetched));
  assert.ok(summary.search.compact.coldBytes < summary.search.legacy.coldBytes);
  assert.ok(summary.search.compact.initMs.p50 < summary.search.legacy.initMs.p50);
  assert.ok(summary.search.compact.warmSearchMs.p50 <= summary.search.legacy.warmSearchMs.p50 * 1.2 + 5);
  assert.ok(summary.detail.compact.warmDetailMs.p50 <= summary.detail.legacy.warmDetailMs.p50 + 1);
  const changed = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const implementation = [];
  for (const path of changed) if ((await stat(join(root, path))).isFile()) implementation.push({ path, sha256: sha256(await readFile(join(root, path))) });
  const receipt = { generatedAt: new Date().toISOString(), runtime: process.version,
    base: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    boundary: "Uncommitted candidate; offline filesystem fetches, not hosted latency, wire transfer or a deployment.",
    data: { source: originalManifest.skills, records: source.length, projectionBytes: projection.length, metadataBytes,
      projectionGzip: gzipSync(projection).length, projectionBrotliQ4: brotliCompressSync(projection, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length,
      addedStaticBytes: inventory.filter(row => row.path !== originalManifest.skills.path).reduce((sum, row) => sum + row.bytes, 0),
      signals: { trending: originalManifest.trending, goldSha256: sha256(await readFile(join(dir, "gold.json"))) } },
    parity: { fullRawRecords: source.length, enrichedRecords: source.length, queryChecks, listChecks: 9, allPassed: true },
    summary, samples, artifactInventory: inventory, implementation,
    limits: ["Three genuinely fresh processes per mode/operation; eight parallel requests share each initialized process.",
      "First-use distribution includes new shard reads; warm ten-query timings follow a complete prewarm pass.",
      "No network latency simulation or production load test.",
      "Cache bytes measure encoded JSON, not a cap on JavaScript object overhead.",
      "Added static storage is separate from per-request savings; production remains on its existing loader."] };
  const receiptPath = join(dir, "receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receiptPath, data: receipt.data, parity: receipt.parity, summary }, null, 2));
}

if (process.argv[2] === "--sample") console.log(JSON.stringify(await sample(process.argv[3], process.argv[4], process.argv[5])));
else await main();

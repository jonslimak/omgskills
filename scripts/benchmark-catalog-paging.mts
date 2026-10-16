#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OmgskillsLibrary, type SearchOptions, type Skill } from "../mcp/src/library.js";
import type { CatalogReader } from "../mcp/src/catalog-reader.js";
import { loadCatalogReader, SearchCatalogReader } from "../mcp/src/search-catalog.js";
import { createOmgskillsServer } from "../mcp/src/server.js";
import { catalogSorts, type CatalogSort, type SkillPage } from "../mcp/src/paging.js";
import { sha256 } from "../mcp/src/search-catalog-format.mjs";
import { buildSearchCatalog } from "./search-catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), base = "04c6011ee11bacb099544b3d0379240ac60bba64";
const origin = "https://offline.test/", goldBasketUrl = origin + "gold.json";
const queries = ["appstore skill", "ios design", "ui design", "browser use", "swiftui-pro", "APPSTORE", "@anthropics", "\u4e2d\u6587", "", "no-result-73e73b2c"];
type Config = { dir: string; baseline: string; author: string };
type ReaderModule = { loadCatalogReader: typeof loadCatalogReader };
async function source(dir: string) {
  const requests: { path: string; bytes: number }[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)), name = url.pathname.slice(1);
    assert.equal(url.origin + "/", origin); assert.equal(basename(name), name);
    const bytes = await readFile(join(dir, name)); requests.push({ path: name, bytes: bytes.length });
    return new Response(bytes);
  };
  return { requests, fetcher };
}
async function timed<T,>(fn: () => T | Promise<T>) { const start = performance.now(), value = await fn(); return { value, ms: performance.now() - start }; }
const gc = () => (globalThis as { gc?: () => void }).gc?.();
const ids = (rows: { id: string }[]) => rows.map(row => row.id);
const tokenAt = (cursor: string, offset: number) => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, "base64url").toString()), offset })).toString("base64url");

async function sample(configPath: string, mode: string) {
  const config: Config = JSON.parse(await readFile(configPath, "utf8"));
  const module: ReaderModule = mode === "baseline" ? await import(pathToFileURL(join(config.baseline, "mcp/dist/search-catalog.js")).href) : { loadCatalogReader };
  const f = await source(config.dir), loaded = await timed(() => module.loadCatalogReader(origin + "manifest.json", { fetcher: f.fetcher, goldBasketUrl }));
  const reader: CatalogReader = loaded.value;
  const cold = await timed(() => reader.searchSkills({ query: queries[0], limit: 20 }));
  const coldBytes = f.requests.reduce((sum, row) => sum + row.bytes, 0);
  const legacyHashes = [];
  for (const query of queries) legacyHashes.push(sha256(Buffer.from(JSON.stringify(await reader.searchSkills({ query, limit: 30 })))));
  const legacyWarmMs = [];
  for (const query of queries) legacyWarmMs.push((await timed(() => reader.searchSkills({ query, limit: 30 }))).ms);
  const legacyParallel = await timed(() => Promise.all(Array.from({ length: 8 }, () => reader.searchSkills({ query: queries[0], limit: 30 }))));
  gc(); const legacyMemory = { ...process.memoryUsage(), peakRss: process.resourceUsage().maxRSS * 1024 };
  const pagedFirstUseMs: number[] = [], pagedRepeatMs: number[] = [];
  let pagedParallelMs: number | undefined, diagnostics;
  if (mode === "candidate") {
    const reads = [...catalogSorts.map(sort => () => reader.searchPage!({ query: "design", limit: 30, sort, page: {} })),
      () => reader.listByAuthorPage!(config.author, { limit: 30, page: {} }), () => reader.listTrendingPage!({ limit: 30, page: {} }),
      () => reader.searchPage!({ query: "swift", limit: 20, page: {} }), () => reader.searchPage!({ query: "browser", limit: 100, page: {} })];
    for (const read of reads) pagedFirstUseMs.push((await timed(read)).ms);
    for (const read of reads) pagedRepeatMs.push((await timed(read)).ms);
    pagedParallelMs = (await timed(() => Promise.all(Array.from({ length: 8 }, reads[0])))).ms;
    diagnostics = reader.diagnostics?.();
  }
  gc();
  return { mode, initMs: loaded.ms, totalColdMs: loaded.ms + cold.ms, coldBytes, legacyHashes, legacyWarmMs,
    legacyParallelMs: legacyParallel.ms, legacyMemory, pagedFirstUseMs, pagedRepeatMs, pagedParallelMs,
    finalMemory: { ...process.memoryUsage(), peakRss: process.resourceUsage().maxRSS * 1024 }, diagnostics,
    fullCatalogFetched: f.requests.some(row => /^skills-/.test(row.path)) };
}

function textOrder(a: string, b: string) {
  const x = Array.from(a, c => c.codePointAt(0)!), y = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function reference(rows: Skill[], trending: { id: string; installs?: number; trending_rank?: number }[], gold: { id: string; score?: number; installs?: number; trending_rank?: number }[], sort: CatalogSort) {
  const t = new Map(trending.map(row => [row.id, row])), g = new Map(gold.map(row => [row.id, row]));
  const weights = [12, 10, 8, 6, 4, 2];
  const matches = rows.flatMap((skill, position) => {
    const rank = t.get(skill.id)?.trending_rank ?? g.get(skill.id)?.trending_rank;
    const fields = [skill.name, skill.id, skill.author_handle, (skill.tags ?? []).join(" "), skill.description, skill.github_url].map(v => String(v ?? "").toLowerCase().trim());
    if (!fields.some(value => value.includes("github.com"))) return [];
    const text = fields.reduce((sum, field, i) => sum + (field === "github.com" ? weights[i] * 3 : field.includes("github.com") ? weights[i] : 0), 0);
    const signal = (t.get(skill.id)?.trending_rank ? Math.max(0, 10 - t.get(skill.id)!.trending_rank! / 50) : 0) + (g.get(skill.id)?.score ? g.get(skill.id)!.score! / 10 : 0);
    return [{ skill, position, rank, installs: t.get(skill.id)?.installs ?? g.get(skill.id)?.installs,
      score: signal + Math.log10((skill.stars ?? 0) + 1) + text, name: skill.name.normalize("NFKC").toLowerCase(),
      updated: Date.parse(skill.last_updated!), added: Date.parse(skill.first_seen!) }];
  });
  const count = (a: number | null | undefined, b: number | null | undefined, ascending = false) => a == null || b == null ? a == b ? 0 : a == null ? 1 : -1 : ascending ? a - b : b - a;
  matches.sort((a, b) => sort === "relevance" ? b.score - a.score || (b.skill.stars ?? 0) - (a.skill.stars ?? 0) || a.position - b.position
    : (sort === "trending" ? count(a.rank, b.rank, true) || count(a.installs, b.installs) || count(a.skill.stars, b.skill.stars)
      : sort === "stars" ? count(a.skill.stars, b.skill.stars)
      : sort === "updated" ? b.updated - a.updated : sort === "added" ? b.added - a.added : 0)
      || textOrder(a.name, b.name) || textOrder(a.skill.id, b.skill.id));
  return matches.map(row => row.skill.id);
}
function distribution(values: number[]) { const sorted = values.slice().sort((a, b) => a - b); return { min: sorted[0], p50: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }; }

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "omgskills-c1-paging-")), baseline = join(dir, "baseline"); await mkdir(baseline);
  const archive = execFileSync("git", ["archive", base, "--", "mcp"], { cwd: root });
  execFileSync("tar", ["-x", "-C", baseline], { input: archive });
  await symlink(join(root, "mcp/node_modules"), join(baseline, "mcp/node_modules"));
  execFileSync(join(root, "mcp/node_modules/.bin/tsc"), ["-p", join(baseline, "mcp/tsconfig.json")], { cwd: root });
  const dataDir = join(root, "site/data/crawl4"), manifest = JSON.parse(await readFile(join(dataDir, "manifest.json"), "utf8"));
  for (const ref of [manifest.skills, manifest.trending]) await copyFile(join(dataDir, ref.path), join(dir, ref.path));
  await copyFile(join(root, "index/gold-basket.json"), join(dir, "gold.json"));
  const searchCatalog = buildSearchCatalog(dir, manifest.skills, { generatedAt: manifest.generatedAt });
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ skills: manifest.skills, trending: manifest.trending, searchCatalog }));
  const skills: Skill[] = JSON.parse(await readFile(join(dir, manifest.skills.path), "utf8"));
  const trending = JSON.parse(await readFile(join(dir, manifest.trending.path), "utf8")), goldBasket = JSON.parse(await readFile(join(dir, "gold.json"), "utf8"));
  const authorCounts = new Map<string, number>();
  for (const row of skills) authorCounts.set(row.author_handle, (authorCounts.get(row.author_handle) ?? 0) + 1);
  const author = [...authorCounts].sort((a, b) => b[1] - a[1])[0][0];
  const index = OmgskillsLibrary.fromData({ skills, trending, goldBasket }, "offline-selection");
  // Offline proof of the complete private selector; public methods remain bounded to 100 rows.
  const selection = index as unknown as { matches: (options: SearchOptions) => { entry: { skill: Skill }; score: number }[];
    sortMatches: (matches: unknown, sort: CatalogSort) => { entry: { skill: Skill }; score: number }[] };
  const f = await source(dir), reader = await loadCatalogReader(origin + "manifest.json", { fetcher: f.fetcher, goldBasketUrl }) as SearchCatalogReader;
  const baselineModule = await import(pathToFileURL(join(baseline, "mcp/dist/search-catalog.js")).href) as ReaderModule;
  const oldReader = await baselineModule.loadCatalogReader(origin + "manifest.json", { fetcher: f.fetcher, goldBasketUrl });
  const { createOmgskillsServer: oldServer } = await import(pathToFileURL(join(baseline, "mcp/dist/server.js")).href);
  const sessions = [];
  for (const server of [oldServer(oldReader), createOmgskillsServer(reader), createOmgskillsServer(reader, { paging: true })]) {
    const client = new Client({ name: "offline-full-catalog", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a); sessions.push({ client, server });
  }
  const [old, current, candidate] = sessions.map(row => row.client);
  const legacyCalls = [["search_skills", { query: "appstore skill" }], ["list_by_author", { author }], ["list_trending", {}], ["list_gold_basket", {}],
    ["get_skill", { id: skills[0].id }], ["get_skills", { ids: [skills[0].id, skills[1].id, "missing"] }]] as [string, Record<string, unknown>][];
  assert.deepEqual(await current.listTools(), await old.listTools());
  for (const [name, args] of legacyCalls) assert.deepEqual(await current.callTool({ name, arguments: args }), await old.callTool({ name, arguments: args }));
  const examples = [], fullOrders = [];
  for (const sort of catalogSorts) {
    const expected = reference(skills, trending, goldBasket, sort);
    assert.deepEqual(selection.sortMatches(selection.matches({ query: "github.com" }), sort).map(row => row.entry.skill.id), expected);
    fullOrders.push({ sort, matches: expected.length, orderedIdSha256: sha256(Buffer.from(JSON.stringify(expected))) });
    const first = await candidate.callTool({ name: "search_skills", arguments: { query: "github.com", sort, limit: 30, page: {} } });
    assert.equal(first.isError, undefined);
    const content = first.structuredContent as unknown as SkillPage;
    for (const offset of [0, Math.floor(expected.length / 2 / 30) * 30, Math.floor((expected.length - 1) / 30) * 30]) {
      const response = offset ? await candidate.callTool({ name: "search_skills", arguments: { query: "github.com", sort, limit: 30,
        page: { cursor: tokenAt(content.page.nextCursor!, offset) } } }) : first;
      assert.equal(response.isError, undefined, JSON.stringify(response));
      const result = response.structuredContent as unknown as SkillPage;
      assert.equal(result.page.total, expected.length); assert.deepEqual(ids(result.skills), expected.slice(offset, offset + 30));
      examples.push({ sort, offset, count: result.skills.length, total: result.page.total, ids: ids(result.skills), hasMore: result.page.hasMore });
    }
  }
  for (const { client, server } of sessions) { await client.close(); await server.close(); }
  const configPath = join(dir, "config.json"); await writeFile(configPath, JSON.stringify({ dir, baseline, author }));
  const samples: Awaited<ReturnType<typeof sample>>[] = [];
  for (let i = 0; i < 3; i++) for (const mode of ["baseline", "candidate"]) samples.push(JSON.parse(execFileSync(process.execPath,
    ["--expose-gc", "--import", "tsx", fileURLToPath(import.meta.url), "--sample", configPath, mode], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 })));
  const summary = Object.fromEntries(["baseline", "candidate"].map(mode => {
    const group = samples.filter(row => row.mode === mode);
    return [mode, { initMs: distribution(group.map(row => row.initMs)), legacyWarmMs: distribution(group.flatMap(row => row.legacyWarmMs)),
      totalColdMs: distribution(group.map(row => row.totalColdMs)), coldBytes: group[0].coldBytes,
      legacyParallelMs: distribution(group.map(row => row.legacyParallelMs)), legacyHeap: distribution(group.map(row => row.legacyMemory.heapUsed)),
      legacyPeakRss: distribution(group.map(row => row.legacyMemory.peakRss)),
      ...(mode === "candidate" ? { pagedFirstUseMs: distribution(group.flatMap(row => row.pagedFirstUseMs)),
        pagedRepeatMs: distribution(group.flatMap(row => row.pagedRepeatMs)), pagedParallelMs: distribution(group.map(row => row.pagedParallelMs!)),
        peakRssIncludingPaging: distribution(group.map(row => row.finalMemory.peakRss)) } : {}) }];
  }));
  assert.ok(samples.every(row => !row.fullCatalogFetched));
  assert.ok(samples.every(row => JSON.stringify(row.legacyHashes) === JSON.stringify(samples[0].legacyHashes)));
  assert.ok(summary.candidate.initMs.p50 <= summary.baseline.initMs.p50 * 1.2 + 5);
  assert.ok(summary.candidate.legacyWarmMs.p50 <= summary.baseline.legacyWarmMs.p50 * 1.2 + 5);
  const files = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const implementation = await Promise.all(files.map(async path => ({ path, sha256: sha256(await readFile(join(root, path))) })));
  const receipt = { generatedAt: new Date().toISOString(), runtime: process.version, base, implementation,
    boundary: "Uncommitted local candidate; frozen filesystem fetches, not hosted latency, a public data publication or deployment.",
    inputs: { source: manifest.skills, trending: manifest.trending, goldSha256: sha256(await readFile(join(dir, "gold.json"))) },
    verification: { records: skills.length, allSixCompleteOrdersMatched: true, legacyToolMetadataAndSixOutputsMatched: true, publicPageExamples: examples.length },
    fullOrders, examples, summary, samples,
    limits: ["Three fresh processes per mode; ten sequential reads plus eight shared-process parallel reads.",
      "Paged repeat passes can hydrate evicted shards; cache is bounded, not a promise that every query is warm.",
      "Compare legacyPeakRss for the same workload; candidate peakRssIncludingPaging includes extra paged reads.",
      "Private selector access is used only for offline full-order proof; public page results are bounded.",
      "No hosted performance target is proved. UI, ranking, install and data model are unchanged."] };
  await writeFile(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: join(dir, "receipt.json"), verification: receipt.verification, summary }, null, 2));
}
if (process.argv[2] === "--sample") console.log(JSON.stringify(await sample(process.argv[3], process.argv[4])));
else await main();

#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCatalogReader, type SearchCatalogReader } from "../mcp/src/search-catalog.js";
import { createOmgskillsServer } from "../mcp/src/server.js";
import type { Skill } from "../mcp/src/library.js";
import { catalogSorts, type CatalogSort, type SkillPage } from "../mcp/src/paging.js";
import { sha256 } from "../mcp/src/search-catalog-format.mjs";
import { buildSearchCatalog, validateSearchCatalog } from "./search-catalog.mjs";
import { realAcceptance, acceptanceSource, baselineQueries, categoryQueries } from "../mcp/test/ranking-acceptance.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), base = "0464073babfc6de0731cd40e656d1dea3964d46b";
const origin = "https://offline.test/", goldBasketUrl = origin + "gold.json";
const queries = [...new Set([...baselineQueries, ...categoryQueries, ...realAcceptance.map(row => row.query)])];
type Config = { dir: string; baseline: string };
const ids = (rows: { id: string }[]) => rows.map(row => row.id);
const hash = (value: unknown) => sha256(Buffer.from(JSON.stringify(value)));
const distribution = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], max: sorted.at(-1)! }; };
async function timed<T>(fn: () => T | Promise<T>) { const start = performance.now(), value = await fn(); return { value, ms: performance.now() - start }; }
async function source(dir: string) {
  const requests: { path: string; bytes: number }[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)), name = url.pathname.slice(1); assert.equal(url.origin + "/", origin); assert.equal(basename(name), name);
    const bytes = await readFile(join(dir, name)); requests.push({ path: name, bytes: bytes.length }); return new Response(bytes);
  };
  return { requests, fetcher };
}
async function modules(config: Config, mode: string) {
  return mode === "baseline" ? import(pathToFileURL(join(config.baseline, "mcp/dist/search-catalog.js")).href) : { loadCatalogReader };
}
async function sample(path: string, mode: string) {
  const config: Config = JSON.parse(await readFile(path, "utf8")), module = await modules(config, mode), f = await source(config.dir);
  const loaded = await timed(() => module.loadCatalogReader(origin + "manifest.json", { fetcher: f.fetcher, goldBasketUrl, ranking: mode === "ranked" }));
  const reader = loaded.value as SearchCatalogReader;
  const cold = await timed(() => reader.searchSkills({ query: baselineQueries[0], limit: 30 }));
  const coldBytes = f.requests.reduce((sum, row) => sum + row.bytes, 0);
  const hashes = [];
  for (const query of baselineQueries) hashes.push(hash(await reader.searchSkills({ query, limit: 30 })));
  const legacyMs = [];
  for (const query of baselineQueries) legacyMs.push((await timed(() => reader.searchSkills({ query, limit: 30 }))).ms);
  const reads = baselineQueries.map(query => () => mode === "ranked"
    ? reader.searchRankedPage({ query, ranking: "web-v1", limit: 30, page: {} }) : reader.searchPage({ query, limit: 30, page: {} }));
  const firstMs = [], repeatMs = [];
  for (const read of reads) firstMs.push((await timed(read)).ms);
  for (const read of reads) repeatMs.push((await timed(read)).ms);
  const parallel = await timed(() => Promise.all(Array.from({ length: 8 }, reads[0])));
  (globalThis as { gc?: () => void }).gc?.();
  return { mode, initMs: loaded.ms, coldMs: loaded.ms + cold.ms, coldBytes, hashes, legacyMs, firstMs, repeatMs, parallelMs: parallel.ms,
    memory: { ...process.memoryUsage(), peakRss: process.resourceUsage().maxRSS * 1024 }, diagnostics: reader.diagnostics(),
    requests: f.requests, fullCatalogFetched: f.requests.some(row => /^skills-/.test(row.path)) };
}

// Independent reference: deliberately not the runtime's normalizer, ranker or quality helper.
const publishers = new Set(["affaan-m/ecc", "affaan-m/everything-claude-code", "aiskillstore/marketplace", "francostino/opencode-skills-collection", "neversight/learn-skills.dev", "openclaw/openclaw", "openclaw/skills", "orcaqubits/agentic-commerce-skills-plugins", "sickn33/antigravity-awesome-skills"]);
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/app[\s-]*store/g, "appstore").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function order(a: string, b: string) { const x = Array.from(a, c => c.codePointAt(0)!), y = Array.from(b, c => c.codePointAt(0)!); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; }
function reference(skills: Skill[], query: string) {
  let author: string | undefined;
  if (query.startsWith("@")) { const [handle, ...rest] = query.split(/\s+/); author = handle.slice(1).toLowerCase(); query = rest.join(" "); }
  let terms = [...new Set(norm(query).split(" ").filter(Boolean))];
  const meaningful = terms.filter(t => !["skill", "skills", "claude", "agent", "agents", "code"].includes(t)); if (meaningful.length) terms = meaningful;
  if (!terms.length) return null; // Author-only ordering uses unchanged published signals.
  const weights = [[100, 75], [60, 45], [30, 20], [25, 12], [20, 10], [10, 5]];
  return skills.flatMap(skill => {
    if (author && skill.author_handle.toLowerCase() !== author) return [];
    const fields = [skill.name, (skill.tags ?? []).join(" "), skill.author_handle, skill.description, skill.id, skill.github_url].map(value => norm(String(value ?? "")));
    const scores = terms.map(term => Math.max(...fields.map((f, i) => f.split(" ").includes(term) ? weights[i][0] : (term.length >= 3 || /[^\x00-\x7f]/.test(term)) && f.includes(term) ? weights[i][1] : 0)));
    const matched = scores.filter(Boolean).length, exactId = skill.id === query;
    if (!matched && !exactId) return [];
    const all = matched === terms.length, stars = typeof skill.stars === "number" && Number.isFinite(skill.stars) && skill.stars >= 0 ? skill.stars : 0;
    const penalty = ["catalog", "repackaged"].includes(skill.provenance_type ?? "") || publishers.has(skill.publisher_repo?.toLowerCase() ?? "") ? 250 : 0;
    const bonus = Math.min(20, Math.log10(stars + 1) * 4) - (stars <= 3 ? 150 : 0) - penalty;
    const corroboration = terms.some(term => fields[0].split(" ").includes(term) && fields[1].split(" ").includes(term)) ? 25 : 0;
    return [{ id: skill.id, exactId, all, stars, name: skill.name.normalize("NFKC").toLowerCase(), score: scores.reduce((a, b) => a + b, 0) + ((all ? 1000 : -(terms.length - matched) * 50) + bonus) + corroboration }];
  }).sort((a, b) => Number(b.exactId) - Number(a.exactId) || Number(b.all) - Number(a.all) || b.score - a.score || b.stars - a.stars || order(a.name, b.name) || order(a.id, b.id));
}
const tokenAt = (cursor: string, offset: number) => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, "base64url").toString()), offset })).toString("base64url");
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "omgskills-c1-ranking-")), baseline = join(dir, "baseline"); await mkdir(baseline);
  execFileSync("tar", ["-x", "-C", baseline], { input: execFileSync("git", ["archive", base, "--", "mcp"], { cwd: root }) });
  await symlink(join(root, "mcp/node_modules"), join(baseline, "mcp/node_modules"));
  execFileSync(join(root, "mcp/node_modules/.bin/tsc"), ["-p", join(baseline, "mcp/tsconfig.json")], { cwd: root });
  const dataDir = join(root, "site/data/crawl4"), manifest = JSON.parse(await readFile(join(dataDir, "manifest.json"), "utf8"));
  assert.equal(manifest.skills.sha256, acceptanceSource);
  for (const ref of [manifest.skills, manifest.trending]) await copyFile(join(dataDir, ref.path), join(dir, ref.path));
  await copyFile(join(root, "index/gold-basket.json"), join(dir, "gold.json"));
  const oldRef = buildSearchCatalog(dir, manifest.skills, { generatedAt: manifest.generatedAt });
  const searchCatalog = buildSearchCatalog(dir, manifest.skills, { generatedAt: manifest.generatedAt, previous: oldRef, ranking: true });
  const closure = validateSearchCatalog(dir, { skills: manifest.skills, searchCatalog })!;
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ skills: manifest.skills, trending: manifest.trending, searchCatalog }));
  const config: Config = { dir, baseline }, configPath = join(dir, "config.json"); await writeFile(configPath, JSON.stringify(config));
  const f = await source(dir), reader = await loadCatalogReader(origin + "manifest.json", { fetcher: f.fetcher, goldBasketUrl, ranking: true }) as SearchCatalogReader;
  const old = await (await modules(config, "baseline")).loadCatalogReader(origin + "manifest.json", { fetcher: f.fetcher, goldBasketUrl });
  const skills: Skill[] = JSON.parse(await readFile(join(dir, manifest.skills.path), "utf8"));
  const trending = new Map<string, any>(JSON.parse(await readFile(join(dir, manifest.trending.path), "utf8")).map((row: any) => [row.id, row]));
  const gold = new Map<string, any>(JSON.parse(await readFile(join(dir, "gold.json"), "utf8")).map((row: any) => [row.id, row]));
  const byId = new Map(skills.map(row => [row.id, row]));
  const comparison = [], failures: unknown[] = [];
  for (const query of queries) {
    const result = await reader.searchRankedPage({ query, ranking: "web-v1", limit: 100, page: {} }), expected = reference(skills, query);
    if (expected) { assert.equal(result.page.total, expected.length); assert.deepEqual(result.skills.map(row => [row.id, row.score]), expected.slice(0, 100).map(row => [row.id, row.score])); }
    for (const requirement of realAcceptance.filter(row => row.query === query)) {
      const position = result.skills.findIndex(row => row.id === requirement.id) + 1;
      if (!position || position > requirement.within) failures.push({ ...requirement, position });
    }
    const oldRows = await old.searchSkills({ query, limit: 100 });
    assert.deepEqual(await reader.searchSkills({ query, limit: 100 }), oldRows);
    comparison.push({ query, oldTop10: ids(oldRows.slice(0, 10)), newTop10: ids(result.skills.slice(0, 10)), total: result.page.total,
      orderedReferenceSha256: expected ? hash(expected.map(row => [row.id, row.score])) : null });
  }
  const sessions = [];
  const { createOmgskillsServer: oldServer } = await import(pathToFileURL(join(baseline, "mcp/dist/server.js")).href);
  for (const server of [oldServer(old), createOmgskillsServer(reader), createOmgskillsServer(reader, { paging: true, ranking: true })]) {
    const client = new Client({ name: "offline-ranking", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a); sessions.push({ server, client });
  }
  assert.deepEqual(await sessions[0].client.listTools(), await sessions[1].client.listTools());
  for (const [name, args] of [["search_skills", { query: "appstore skill" }], ["list_trending", {}], ["list_gold_basket", {}], ["list_by_author", { author: "twostraws" }], ["get_skill", { id: skills[0].id }], ["get_skills", { ids: [skills[0].id, "missing"] }]] as [string, Record<string, unknown>][]) {
    assert.deepEqual(await sessions[0].client.callTool({ name, arguments: args }), await sessions[1].client.callTool({ name, arguments: args }));
  }
  const examples = [];
  for (const sort of catalogSorts) {
    const expected = reference(skills, "design")!;
    if (sort !== "relevance") expected.sort((a, b) => {
      const left = byId.get(a.id)!, right = byId.get(b.id)!;
      const number = (x?: number, y?: number, ascending = false) => x == null || y == null ? x == y ? 0 : x == null ? 1 : -1 : ascending ? x - y : y - x;
      const signal = (id: string, key: string) => trending.get(id)?.[key] ?? gold.get(id)?.[key];
      return (sort === "stars" ? number(left.stars, right.stars)
        : sort === "trending" ? number(signal(a.id, "trending_rank"), signal(b.id, "trending_rank"), true) || number(signal(a.id, "installs"), signal(b.id, "installs")) || number(left.stars, right.stars)
        : sort === "updated" ? number(Date.parse(left.last_updated!), Date.parse(right.last_updated!))
        : sort === "added" ? number(Date.parse(left.first_seen!), Date.parse(right.first_seen!)) : 0) || order(a.name, b.name) || order(a.id, b.id);
    });
    const args = { query: "design", ranking: "web-v1" as const, sort, limit: 30, page: {} };
    const first = await reader.searchRankedPage(args), total = first.page.total;
    assert.equal(total, expected.length);
    for (const offset of [0, Math.floor(total / 2 / 30) * 30, Math.floor((total - 1) / 30) * 30]) {
      const page = offset ? { cursor: tokenAt(first.page.nextCursor!, offset) } : {};
      const result = await sessions[2].client.callTool({ name: "search_skills", arguments: { ...args, page } }); assert.equal(result.isError, undefined, JSON.stringify(result));
      const value = result.structuredContent as unknown as SkillPage;
      assert.deepEqual(value.skills.map(row => [row.id, row.score]), expected.slice(offset, offset + 30).map(row => [row.id, row.score]));
      assert.equal(value.page.total, total); assert.equal(value.page.hasMore, offset + value.skills.length < total);
      examples.push({ sort, offset, total, ids: ids(value.skills) });
    }
  }
  for (const { server, client } of sessions) { await client.close(); await server.close(); }
  const samples = [];
  for (let i = 0; i < 3; i++) for (const mode of ["baseline", "candidate", "ranked"]) samples.push(JSON.parse(execFileSync(process.execPath,
    ["--expose-gc", "--import", "tsx", fileURLToPath(import.meta.url), "--sample", configPath, mode], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })));
  assert.ok(samples.every(row => !row.fullCatalogFetched && JSON.stringify(row.hashes) === JSON.stringify(samples[0].hashes)));
  const summary = Object.fromEntries(["baseline", "candidate", "ranked"].map(mode => {
    const group = samples.filter(row => row.mode === mode);
    const values: [string, ReturnType<typeof distribution>][] = ["initMs", "coldMs", "coldBytes", "parallelMs"].map(key => [key, distribution(group.map(row => row[key]))]);
    values.push(
      ["legacyMs", distribution(group.flatMap(row => row.legacyMs))], ["firstMs", distribution(group.flatMap(row => row.firstMs))], ["repeatMs", distribution(group.flatMap(row => row.repeatMs))],
      ["heap", distribution(group.map(row => row.memory.heapUsed))], ["peakRss", distribution(group.map(row => row.memory.peakRss))],
    );
    return [mode, Object.fromEntries(values)];
  })) as Record<string, Record<string, ReturnType<typeof distribution>>>;
  const budgets = { legacyWarm: summary.candidate.legacyMs.p50 <= summary.baseline.legacyMs.p50 * 1.2 + 5,
    rankedWarm: summary.ranked.repeatMs.p50 <= summary.baseline.repeatMs.p50 * 1.2 + 5,
    rankedInitialization: summary.ranked.initMs.p50 <= summary.baseline.initMs.p50 * 1.2 + 20,
    rankedHeap: summary.ranked.heap.p50 <= summary.baseline.heap.p50 * 1.25 };
  const paths = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const implementation = await Promise.all(paths.map(async path => ({ path, sha256: sha256(await readFile(join(root, path))) })));
  const receipt = { at: new Date().toISOString(), base, runtime: process.version, boundary: "Offline uncommitted candidate; no hosted requests, publication, merge or deploy.", implementation,
    source: manifest.skills, ranking: closure.descriptor.ranking, records: skills.length, queries: queries.length, acceptance: realAcceptance, failures,
    legacyMetadataAndAllSixOutputsMatched: true, comparisons: comparison, examples, summary, budgets, samples,
    limits: ["Filesystem-backed fetches; bytes are decoded file bytes, not compressed network transfer or hosted latency.", "Three fresh processes per mode; ten sequential and eight shared-process parallel reads.", "First/middle/last MCP examples supplement exhaustive synthetic paging, not a traversal of every hydrated full-catalog result."] };
  await writeFile(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await writeFile(join(dir, "comparison.md"), comparison.map(row => `## ${row.query || "(empty)"}\n\nOld: ${row.oldTop10.join(", ")}\n\nNew: ${row.newTop10.join(", ")}\n`).join("\n"));
  console.log(JSON.stringify({ receipt: join(dir, "receipt.json"), failures, summary, budgets }, null, 2));
  assert.equal(failures.length, 0, "Fixed relevance acceptance failed; review without moving the goalposts");
  assert.ok(Object.values(budgets).every(Boolean), "Performance stop point: review representation/scope before proceeding");
}
if (process.argv[2] === "--sample") console.log(JSON.stringify(await sample(process.argv[3], process.argv[4])));
else await main();

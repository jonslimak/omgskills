import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fixture, records, sourceAsset } from "./search-catalog.test.mjs";
import { validateSearchCatalog } from "./search-catalog.mjs";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";
const cli = new URL("./search-catalog-cli.mjs", import.meta.url).pathname;
const read = path => JSON.parse(readFileSync(path, "utf8"));

test("explicit bootstrap preserves all source fields and no-op bytes; ordinary publishers keep ranking without opt-in", context => {
  const dir = fixture(context), source = sourceAsset(dir, records);
  const original = { version: 1, generatedAt: "2026-10-16T00:00:00Z", skills: source, collections: source,
    shaHistory: source, skillEquivalence: source, trending: source, xTrending: source, custom: { keep: true } };
  const path = join(dir, "manifest.json"); writeFileSync(path, JSON.stringify(original));
  const sourceBytes = readFileSync(join(dir, source.path));
  execFileSync(process.execPath, [cli, "--bootstrap-ranking", dir]);
  const first = read(path), { searchCatalog, ...unchanged } = first;
  assert.deepEqual(unchanged, original);
  assert.deepEqual(readFileSync(join(dir, source.path)), sourceBytes);
  assert.ok(validateSearchCatalog(dir, first).descriptor.ranking);
  const firstBytes = readFileSync(path);
  execFileSync(process.execPath, [cli, "--bootstrap-ranking", dir]);
  assert.deepEqual(readFileSync(path), firstBytes);
  const next = { ...first, skills: sourceAsset(dir, records.map(row => ({ ...row, stars: 42 }))), generatedAt: "2026-10-17" };
  writeFileSync(join(dir, "next.json"), JSON.stringify(next)); writeFileSync(join(dir, "previous.json"), JSON.stringify(first));
  execFileSync(process.execPath, [cli, dir, join(dir, "next.json"), join(dir, "previous.json")], { env: { ...process.env, OMGSKILLS_SEARCH_CATALOG: "0" } });
  const prepared = read(join(dir, "next.json"));
  assert.ok(validateSearchCatalog(dir, prepared).descriptor.ranking);
  publishCatalogManifest({ dataDir: dir, manifest: prepared, previousManifest: first, prefixes: ["skills"] });
  validateSearchCatalog(dir, first); validateSearchCatalog(dir, prepared);
  for (const key of ["trending", "collections", "shaHistory", "skillEquivalence", "xTrending", "custom"]) assert.deepEqual(prepared[key], original[key]);
});

test("bootstrap refuses missing, corrupt and symlinked closure assets before replacing the manifest", async context => {
  for (const mode of ["missing", "corrupt", "symlink"]) await context.test(mode, sub => {
    const dir = fixture(sub), path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify({ version: 1, generatedAt: "2026-10-16", skills: sourceAsset(dir, records) }));
    execFileSync(process.execPath, [cli, "--bootstrap-ranking", dir]);
    const manifest = read(path), ref = validateSearchCatalog(dir, manifest).descriptor.ranking;
    const before = readFileSync(path), asset = join(dir, ref.path), saved = readFileSync(asset);
    rmSync(asset);
    if (mode === "corrupt") writeFileSync(asset, Buffer.alloc(saved.length));
    if (mode === "symlink") { writeFileSync(join(dir, "target.json"), saved); symlinkSync(join(dir, "target.json"), asset); }
    assert.notEqual(spawnSync(process.execPath, [cli, "--bootstrap-ranking", dir]).status, 0);
    assert.deepEqual(readFileSync(path), before);
  });
});

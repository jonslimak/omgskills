import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishContentData } from "./publish-content-data.mjs";
import { buildSearchCatalog } from "./search-catalog.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fixture(t, track = "v2") {
  const repoRoot = mkdtempSync(join(tmpdir(), "content-data-test-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const dataDir = join(repoRoot, "site/data", track);
  for (const name of ["v2", "crawl4"]) mkdirSync(join(repoRoot, "site/data", name), { recursive: true });
  mkdirSync(join(repoRoot, "index"));
  const skills = [{ id: "owner/repo:skill", name: "skill", description: "Fixture skill", author_handle: "owner", github_url: "https://github.com/owner/repo" }];
  const bytes = encode(skills);
  writeFileSync(join(repoRoot, "index/skills.json"), bytes);
  const asset = (prefix, value) => {
    const data = encode(value);
    const sha256 = hash(data);
    const path = `${prefix}-${sha256.slice(0, 12)}.json`;
    writeFileSync(join(dataDir, path), data);
    return { path, sha256, bytes: Buffer.byteLength(data) };
  };
  const manifest = {
    version: 1,
    generatedAt: "2026-11-01T22:15:18Z",
    skills: asset("skills", track === "crawl4" ? skills.map(skill => ({ ...skill, quality_tier: "curated" })) : skills),
    trending: asset("trending", []),
    collections: asset("collections", { version: 1, generatedAt: "2026-11-01T22:15:18Z", collections: [] }),
    customMetadata: { keep: true },
  };
  writeFileSync(join(dataDir, "manifest.json"), encode(manifest));
  writeFileSync(join(repoRoot, "site/data/manifest.json"), "frozen root\n");
  writeFileSync(join(repoRoot, "site/data", track === "v2" ? "crawl4" : "v2", "manifest.json"), "unchanged other track\n");
  const input = (name, value) => writeFileSync(join(repoRoot, "index", `${name}.json`), encode(value));
  return { repoRoot, dataDir, asset, input, manifest };
}

test("refreshes v2 report assets without shadow files, catalog changes, or cross-track writes", (t) => {
  const f = fixture(t);
  for (const name of ["trending", "trending-leaderboard", "leaderboard-view-data", "x-trending", "skill-signals", "author-signals", "author-leaderboards"]) {
    f.input(name, name === "leaderboard-view-data" ? { version: 1 } : [{ id: "owner/repo:skill" }]);
  }
  publishContentData({ repoRoot: f.repoRoot, generatedAt: "2026-11-02T14:00:00Z" });
  const next = JSON.parse(readFileSync(join(f.dataDir, "manifest.json"), "utf8"));
  assert.deepEqual(next.skills, f.manifest.skills);
  assert.equal(next.generatedAt, "2026-11-02T14:00:00Z");
  assert.deepEqual(next.collections, f.manifest.collections);
  assert.deepEqual(next.customMetadata, f.manifest.customMetadata);
  for (const key of ["trending", "trendingLeaderboard", "leaderboardViewData", "xTrending", "skillSignals", "authorSignals", "authorLeaderboards"]) {
    const data = readFileSync(join(f.dataDir, next[key].path));
    assert.equal(hash(data), next[key].sha256);
    assert.equal(data.length, next[key].bytes);
  }
  assert.equal(readFileSync(join(f.repoRoot, "site/data/manifest.json"), "utf8"), "frozen root\n");
  assert.equal(readFileSync(join(f.repoRoot, "site/data/crawl4/manifest.json"), "utf8"), "unchanged other track\n");
});

test("catalog drift fails before writing any assets or changing the manifest", (t) => {
  const f = fixture(t);
  const before = readdirSync(f.dataDir).sort();
  f.input("skills", [{ id: "unpublished/other:skill" }]);
  f.input("trending", []);
  assert.throws(() => publishContentData({ repoRoot: f.repoRoot }), /catalog.*match|match.*catalog/i);
  assert.deepEqual(readdirSync(f.dataDir).sort(), before);
  assert.deepEqual(JSON.parse(readFileSync(join(f.dataDir, "manifest.json"))), f.manifest);
});

test("missing report inputs preserve existing optional assets and no-op runs are byte-stable", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.dataDir, "manifest.json"));
  publishContentData({ repoRoot: f.repoRoot });
  assert.deepEqual(readFileSync(join(f.dataDir, "manifest.json")), before);
});

test("invalid report JSON and broken catalog assets fail without activating a manifest", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.dataDir, "manifest.json"));
  writeFileSync(join(f.repoRoot, "index/author-signals.json"), "{");
  assert.throws(() => publishContentData({ repoRoot: f.repoRoot }), /JSON|position|property/i);
  assert.deepEqual(readFileSync(join(f.dataDir, "manifest.json")), before);
  rmSync(join(f.repoRoot, "index/author-signals.json"));
  writeFileSync(join(f.dataDir, f.manifest.skills.path), "corrupt");
  assert.throws(() => publishContentData({ repoRoot: f.repoRoot }), /mismatch/);
  assert.deepEqual(readFileSync(join(f.dataDir, "manifest.json")), before);
});

test("retains the previous report asset and preserves byte stability on repeated publication", (t) => {
  const f = fixture(t);
  f.input("trending", [{ id: "owner/repo:skill" }]);
  publishContentData({ repoRoot: f.repoRoot });
  assert.ok(readdirSync(f.dataDir).includes(f.manifest.trending.path));
  const before = readFileSync(join(f.dataDir, "manifest.json"));
  publishContentData({ repoRoot: f.repoRoot });
  assert.deepEqual(readFileSync(join(f.dataDir, "manifest.json")), before);
  assert.ok(readdirSync(f.dataDir).includes(f.manifest.trending.path));
});

test("the normal published-data verifier accepts refreshed v2 reports", (t) => {
  const f = fixture(t);
  f.input("trending", [{ id: "owner/repo:skill" }]);
  f.input("skill-signals", [{ id: "owner/repo:skill" }]);
  f.input("author-signals", [{ authorHandle: "owner", topSkillIds: ["owner/repo:skill"] }]);
  publishContentData({ repoRoot: f.repoRoot });
  const run = () => spawnSync(process.execPath, [new URL("./verify-published-data.mjs", import.meta.url).pathname], {
    cwd: f.repoRoot,
    env: { ...process.env, OMGSKILLS_DATA_ROOT: join(f.repoRoot, "site/data"), OMGSKILLS_DATA_SUBDIR: "v2" },
    encoding: "utf8",
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  f.input("author-signals", [{ authorHandle: "", topSkillIds: ["owner/repo:skill"] }]);
  publishContentData({ repoRoot: f.repoRoot });
  const invalid = run();
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /missing matching author handle/);
});

test("Crawl 4 refresh changes only Trending and preserves its catalog and compact search bundle", (t) => {
  const f = fixture(t, "crawl4");
  f.manifest.searchCatalog = buildSearchCatalog(f.dataDir, f.manifest.skills, { generatedAt: f.manifest.generatedAt, ranking: true });
  writeFileSync(join(f.dataDir, "manifest.json"), encode(f.manifest));
  const originalAssets = new Map(readdirSync(f.dataDir).filter(name => name !== "manifest.json").map(name => [name, readFileSync(join(f.dataDir, name))]));
  f.input("trending", [{ id: "owner/repo:skill", trending_rank: 1, installs: 100 }]);
  f.input("author-signals", [{ authorHandle: "not-in-crawl4" }]);
  const next = publishContentData({ repoRoot: f.repoRoot, track: "crawl4", generatedAt: "2026-11-02T16:00:00Z" });
  assert.deepEqual(next.skills, f.manifest.skills);
  assert.deepEqual(next.searchCatalog, f.manifest.searchCatalog);
  assert.deepEqual(next.collections, f.manifest.collections);
  assert.equal(next.authorSignals, undefined, "Crawl 4 owns only Trending in this report refresh");
  assert.notDeepEqual(next.trending, f.manifest.trending);
  assert.equal(next.generatedAt, "2026-11-02T16:00:00Z");
  for (const [name, bytes] of originalAssets) assert.deepEqual(readFileSync(join(f.dataDir, name)), bytes, name);
  assert.equal(readFileSync(join(f.repoRoot, "site/data/manifest.json"), "utf8"), "frozen root\n");
  assert.equal(readFileSync(join(f.repoRoot, "site/data/v2/manifest.json"), "utf8"), "unchanged other track\n");
  const verified = spawnSync(process.execPath, [new URL("./verify-published-data.mjs", import.meta.url).pathname], {
    cwd: f.repoRoot, env: { ...process.env, OMGSKILLS_DATA_SUBDIR: "crawl4", OMGSKILLS_DATA_ROOT: join(f.repoRoot, "site/data") }, encoding: "utf8",
  });
  assert.equal(verified.status, 0, verified.stderr);
});

for (const track of ["v2", "crawl4"]) {
  test(`${track}: unknown Trending IDs fail before writing any assets`, (t) => {
    const f = fixture(t, track);
    const before = readFileSync(join(f.dataDir, "manifest.json"));
    const files = readdirSync(f.dataDir).sort();
    f.input("trending", [{ id: "missing/repo:skill", trending_rank: 1 }]);
    assert.throws(() => publishContentData({ repoRoot: f.repoRoot, track }), /Trending.*missing.*catalog/i);
    assert.deepEqual(readFileSync(join(f.dataDir, "manifest.json")), before);
    assert.deepEqual(readdirSync(f.dataDir).sort(), files);
  });
}

test("unsupported tracks cannot write ROOT or arbitrary directories", (t) => {
  const f = fixture(t);
  for (const track of ["root", "", "../", "v3"]) {
    assert.throws(() => publishContentData({ repoRoot: f.repoRoot, track }), /Unsupported.*track/);
  }
  assert.equal(readFileSync(join(f.repoRoot, "site/data/manifest.json"), "utf8"), "frozen root\n");
});

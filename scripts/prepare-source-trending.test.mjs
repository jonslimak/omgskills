import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareSourceTrending } from "./prepare-source-trending.mjs";
import { publishContentData } from "./publish-content-data.mjs";
import { sourceTrendingUrl, validateSourceTrending } from "./source-trending-format.mjs";

const entry = (source, rank, catalogId) => ({ source, skillId: "skill", name: "skill", rank, installs24h: 10,
  sourceUrl: sourceTrendingUrl(source, "skill"), ...(catalogId ? { catalogId } : {}) });
const snapshot = entries => ({ version: 1, source: "skills.sh", board: "trending", fetchedAt: "2026-11-09T10:00:00Z", entries });

function fixture(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), "publish-source-trending-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const dataDir = join(repoRoot, "site/data/crawl4");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(repoRoot, "index/seeds"), { recursive: true });
  const seed = (name, value) => writeFileSync(join(repoRoot, "index/seeds", `${name}.json`), JSON.stringify(value));
  seed("do-not-crawl", { repos: [], owners: [] }); seed("catalog-repos", []); seed("suppressed-skills", { skills: [] });
  const input = value => writeFileSync(join(repoRoot, "index/source-trending.json"), JSON.stringify(value));
  return { repoRoot, dataDir, seed, input };
}

test("publishes unindexed entries as a hashed optional asset without changing legacy assets", t => {
  const f = fixture(t);
  const asset = (prefix, value) => {
    const bytes = Buffer.from(JSON.stringify(value)), sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${prefix}-${sha256.slice(0, 12)}.json`;
    writeFileSync(join(f.dataDir, path), bytes);
    return { path, sha256, bytes: bytes.length };
  };
  const skills = [{ id: "known/repo:skill", name: "skill" }];
  const old = { version: 1, generatedAt: "2026-11-08T10:00:00Z", skills: asset("skills", skills), trending: asset("trending", [{ id: skills[0].id }]) };
  writeFileSync(join(f.dataDir, "manifest.json"), JSON.stringify(old));
  const before = readFileSync(join(f.dataDir, old.trending.path));
  f.input(snapshot([entry("new/repo", 1), entry("known/repo", 13, skills[0].id)]));
  const next = publishContentData({ repoRoot: f.repoRoot, track: "crawl4" });
  assert.deepEqual(next.skills, old.skills); assert.deepEqual(next.trending, old.trending);
  assert.deepEqual(readFileSync(join(f.dataDir, old.trending.path)), before);
  const bytes = readFileSync(join(f.dataDir, next.sourceTrending.path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), next.sourceTrending.sha256);
  const feed = validateSourceTrending(JSON.parse(bytes));
  assert.deepEqual(feed.entries.map(e => e.rank), [1, 13]);
  assert.equal(feed.fetchedAt, "2026-11-09T10:00:00Z");
});

test("reapplies current policy to retained snapshots and clears removed catalog links", t => {
  const f = fixture(t), manifest = {};
  f.seed("do-not-crawl", { repos: [{ repo: "blocked/repo" }], owners: [] });
  f.input(snapshot([entry("blocked/repo", 1), entry("safe/repo", 2, "safe/repo:skill")]));
  prepareSourceTrending({ ...f, manifest, skills: [] });
  const feed = JSON.parse(readFileSync(join(f.dataDir, manifest.sourceTrending.path)));
  assert.deepEqual(feed.entries, [entry("safe/repo", 2)]);
});

test("newly admitted exact source IDs become catalog links, never a same-name skill from another repo", t => {
  const f = fixture(t), manifest = {};
  f.input(snapshot([entry("new/repo", 1), entry("other/repo", 2)]));
  prepareSourceTrending({ ...f, manifest, skills: [{ id: "New/Repo:skill" }] });
  const feed = JSON.parse(readFileSync(join(f.dataDir, manifest.sourceTrending.path)));
  assert.deepEqual(feed.entries, [entry("new/repo", 1, "New/Repo:skill"), entry("other/repo", 2)]);
});

test("publication normalizes repo rules and linked identities the same way as crawler policy", t => {
  const f = fixture(t), manifest = {};
  f.seed("do-not-crawl", { repos: [{ repo: " BLOCKED/REPO.git " }, { repo: "https://github.com/Blocked/Publisher.git" }], owners: [] });
  f.seed("catalog-repos", [{ repo: "Catalog/Repo.GIT" }]);
  f.input(snapshot([entry("blocked/repo", 1), entry("catalog/repo", 2),
    entry("old/repo", 3, "old/repo:skill"), entry("safe/repo", 4)]));
  prepareSourceTrending({ ...f, manifest, skills: [{ id: "old/repo:skill", repo_slug: "Blocked/Publisher.GIT" }] });
  const feed = JSON.parse(readFileSync(join(f.dataDir, manifest.sourceTrending.path)));
  assert.deepEqual(feed.entries, [entry("safe/repo", 4)]);
});

test("missing optional feed is a no-op; malformed feed or unsafe URLs fail", t => {
  const f = fixture(t), manifest = { trending: { path: "legacy.json" } };
  prepareSourceTrending({ ...f, manifest, skills: [] });
  assert.deepEqual(manifest, { trending: { path: "legacy.json" } });
  const feed = snapshot([{ ...entry("safe/repo", 1), sourceUrl: "javascript:alert(1)" }]);
  f.input(feed);
  assert.throws(() => prepareSourceTrending({ ...f, manifest, skills: [] }), /Invalid/);
  for (const change of [{ rank: 0 }, { installs24h: -1 }, { source: "../evil" }]) {
    assert.throws(() => validateSourceTrending(snapshot([{ ...entry("safe/repo", 1), ...change }])), /Invalid/);
  }
});

test("a linked skill cannot bypass a publisher repo block through a historical ID", t => {
  const f = fixture(t), manifest = {};
  f.seed("do-not-crawl", { repos: [{ repo: "blocked/publisher" }], owners: [] });
  f.input(snapshot([entry("old/repo", 1, "old/repo:skill")]));
  prepareSourceTrending({ ...f, manifest, skills: [{ id: "old/repo:skill", github_url: "https://github.com/blocked/publisher.git" }] });
  assert.deepEqual(JSON.parse(readFileSync(join(f.dataDir, manifest.sourceTrending.path))).entries, []);
});

test("publication hides what the Trending intake blocked", t => {
  const f = fixture(t);
  writeFileSync(join(f.repoRoot, "index/trending-intake-state.json"), JSON.stringify({ version: 1, reviews: [
    { sourceId: "copy/repo:skill", outcome: "blocked", reason: "non-original-provenance" },
    { sourceId: "added/repo:skill", outcome: "added", reason: "verified-trending" },
  ] }));
  f.input(snapshot([entry("copy/repo", 1), entry("added/repo", 2), entry("new/repo", 3)]));
  const manifest = {};
  prepareSourceTrending({ repoRoot: f.repoRoot, dataDir: f.dataDir, manifest, skills: [] });
  const feed = JSON.parse(readFileSync(join(f.dataDir, manifest.sourceTrending.path), "utf8"));
  assert.deepEqual(feed.entries.map(e => e.source), ["added/repo", "new/repo"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshSourceTrending } from "./build-source-trending.js";
import {
  installCountForTrendingHit,
  isUnsafeTrendingShrink,
  loadTrendingSourceData,
  spreadTrendingByRepo,
} from "./build-trending.js";
import type { SkillsShHit } from "./sources/skillssh.js";

const hit: SkillsShHit = {
  id: "owner/repo:skill",
  path: "__RESOLVE__",
  skill_name_hint: "skill",
  github_url: "https://github.com/owner/repo",
  author_handle: "owner",
  installs: 25,
  trending_rank: 1,
  trending_source: "skills.sh",
  board: "trending",
};

test("lifetime install failure keeps fresh trending hits", async () => {
  const warnings: string[] = [];
  const result = await loadTrendingSourceData({
    search: async () => [hit],
    fetchInstallTotals: async () => { throw new Error("all-time unavailable"); },
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(result.hits, [hit]);
  assert.equal(result.totals.size, 0);
  assert.match(warnings[0] ?? "", /lifetime install totals unavailable/);
});

test("invalid optional source snapshot keeps its last-good bytes without blocking legacy trending", async t => {
  const dir = mkdtempSync(join(tmpdir(), "trending-optional-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outputPath = join(dir, "source-trending.json");
  const policy = { blockedRepos: [], blockedOwners: [], catalogRepos: [], suppressedIds: [] };
  const good = { source: "owner/repo", skillId: "skill", name: "skill", installs: 25 };
  await refreshSourceTrending({ entries: [good], skills: [], policy, outputPath, now: () => "2026-11-09T10:00:00Z" });
  const before = readFileSync(outputPath);
  const warnings: string[] = [];
  const result = await loadTrendingSourceData({
    refreshSourceSnapshot: () => refreshSourceTrending({ entries: [good, { ...good, source: "bad source" }],
      skills: [], policy, outputPath, now: () => "2026-11-10T10:00:00Z" }),
    search: async () => [hit],
    fetchInstallTotals: async () => new Map([[hit.id, 100]]),
    warn: message => warnings.push(message),
  });
  assert.deepEqual(result.hits, [hit]);
  assert.equal(result.totals.get(hit.id), 100);
  assert.deepEqual(readFileSync(outputPath), before);
  assert.match(warnings[0] ?? "", /optional-source-unavailable.*source Trending snapshot.*Invalid/);
});

test("optional snapshot failure does not hide a required legacy source failure", async () => {
  await assert.rejects(loadTrendingSourceData({
    refreshSourceSnapshot: async () => { throw new Error("snapshot invalid"); },
    search: async () => { throw new Error("required source unavailable"); },
    fetchInstallTotals: async () => new Map(), warn: () => {},
  }), /required source unavailable/);
});

test("missing lifetime total reuses the previous published count", () => {
  const existing = new Map([[hit.id, {
    id: hit.id,
    installs: 1_000,
    trending_rank: 3,
    trending_source: "skills.sh",
  }]]);

  assert.equal(installCountForTrendingHit(hit, new Map(), existing), 1_000);
  assert.equal(installCountForTrendingHit(hit, new Map([[hit.id, 1_200]]), existing), 1_200);
});

test("shrink guard remains active during a ranking-board transition", () => {
  assert.equal(isUnsafeTrendingShrink(275, 192), false);
  assert.equal(isUnsafeTrendingShrink(275, 0), true);
  assert.equal(isUnsafeTrendingShrink(275, 137), true);
});

test("trending keeps two skills per repo at the top and moves the rest below", () => {
  const ids = ["a/r:1", "a/r:2", "a/r:3", "b/r:1", "A/R:4", "c/r:1", "b/r:2", "b/r:3"];
  const spread = spreadTrendingByRepo(ids.map((id, index) => ({
    id,
    source_rank: index + 10,
    trending_rank: index + 10,
  })));
  assert.deepEqual(spread.map((entry) => entry.id),
    ["a/r:1", "a/r:2", "b/r:1", "c/r:1", "b/r:2", "a/r:3", "A/R:4", "b/r:3"]);
  assert.deepEqual(spread.map((entry) => entry.trending_rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(spread.map((entry) => entry.source_rank), [10, 11, 13, 15, 16, 12, 14, 17]);
});

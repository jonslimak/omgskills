import test from "node:test";
import assert from "node:assert/strict";
import { admitDiscoveredRepos, HIGH_STAR_BACKFILL_ONLY_MAX_NEW_ADMISSIONS, HIGH_STAR_BACKFILL_ONLY_MAX_SAMPLED_REPOS, parseOnlyHighStarBackfill } from "./build-shadow.js";
import { shouldRunWeeklyHighStarSkillMdDiscovery } from "./high-star-schedule.js";
import type { ShadowRepoIndex, TrustedSeeds } from "./types.js";

test("high-star SKILL.md discovery runs on Sunday UTC by default", () => {
  assert.equal(shouldRunWeeklyHighStarSkillMdDiscovery("2026-06-21T12:00:00.000Z"), true);
});

test("high-star SKILL.md discovery skips on non-Sunday UTC days", () => {
  assert.equal(shouldRunWeeklyHighStarSkillMdDiscovery("2026-06-22T12:00:00.000Z"), false);
});

test("high-star SKILL.md discovery supports configured weekly UTC day", () => {
  assert.equal(shouldRunWeeklyHighStarSkillMdDiscovery("2026-06-22T12:00:00.000Z", 1), true);
});

test("high-star backfill-only mode requires combined cadence", () => {
  assert.equal(parseOnlyHighStarBackfill(["--only-high-star-backfill"], "combined"), true);
  assert.equal(parseOnlyHighStarBackfill([], "combined"), false);
  assert.throws(
    () => parseOnlyHighStarBackfill(["--only-high-star-backfill"], "fast"),
    /requires --cadence=combined/,
  );
});

test("high-star backfill-only constants keep sampling larger than admission cap", () => {
  assert.equal(HIGH_STAR_BACKFILL_ONLY_MAX_NEW_ADMISSIONS, 50);
  assert.equal(HIGH_STAR_BACKFILL_ONLY_MAX_SAMPLED_REPOS, 250);
});

test("admission cap prioritizes highest-star new repos", () => {
  const repoIndex: ShadowRepoIndex = {
    generatedAt: "2026-06-23T00:00:00.000Z",
    repoCount: 0,
    repos: [],
  };
  const seeds: TrustedSeeds = {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
  };
  const discoveredRows: Array<[string, number]> = [
    ["owner/c", 700],
    ["owner/a", 900],
    ["owner/b", 800],
  ];
  const discovered = new Map<string, any>(
    discoveredRows.map(([repo, stars]) => [
      repo,
      {
        repo,
        repoUrl: `https://github.com/${repo}`,
        sources: new Set(["high-star-skillmd"]),
        lanes: new Set(["background"]),
        stars,
        bootstrapCandidate: {
          source: "code",
          id: `${repo}:skill`,
          skill_md_path: "skills/skill/SKILL.md",
          github_url: `https://github.com/${repo}`,
          stars,
        },
      },
    ]),
  );

  const admitted = admitDiscoveredRepos(
    "combined",
    "2026-06-23T00:00:00.000Z",
    repoIndex,
    discovered,
    new Set(),
    seeds,
    { maxNewAdmissions: 2 },
  );

  assert.deepEqual([...admitted].sort(), ["owner/a", "owner/b"]);
  assert.deepEqual(repoIndex.repos.map((repo) => repo.repo), ["owner/a", "owner/b"]);
});

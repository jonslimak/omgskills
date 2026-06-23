import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCheapTriggeredRefreshSelection,
  buildWeeklyCheapCheckRepos,
  CHEAP_TRIGGERED_REFRESH_LIMIT,
  markRepoMissingCheapCheck,
  mergePriorShadowRepoTimestamps,
  repoMetaLooksChanged,
  WEEKLY_CHEAP_CHECK_DAYS,
} from "./rolling-refresh.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry } from "./types.js";

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "stars">): ShadowRepoIndexEntry {
  const { repo: repoName, stars, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "library",
    discoveredSources: ["baseline"],
    skillIds: [`${repoName}:skill`],
    skillCount: 1,
    stars,
    lastSeenAt: "2026-06-02T00:00:00Z",
    lastRefreshedAt: "2026-06-02T00:00:00Z",
    lastCheapCheckedAt: null,
    lastObservedRepoUpdatedAt: null,
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: `${repoName}:skill`,
    topSkillStars: stars,
    ...rest,
  };
}

function repoIndex(repos: ShadowRepoIndexEntry[]): ShadowRepoIndex {
  return {
    generatedAt: "2026-06-02T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

test("mergePriorShadowRepoTimestamps preserves prior timestamps when current values are rebuilt defaults", () => {
  const current = repoIndex([
    repo({ repo: "owner/kept", stars: 10, lastSeenAt: "2026-06-10T00:00:00Z", lastRefreshedAt: "2026-06-10T00:00:00Z" }),
    repo({ repo: "owner/overlay", stars: 10, lastSeenAt: "2026-06-05T00:00:00Z", lastRefreshedAt: "2026-06-06T00:00:00Z", lastCheapCheckedAt: "2026-06-07T00:00:00Z", lastObservedRepoUpdatedAt: "2026-06-08T00:00:00Z" }),
    repo({ repo: "owner/new", stars: 10, lastSeenAt: "2026-06-10T00:00:00Z", lastRefreshedAt: "2026-06-10T00:00:00Z" }),
  ]);
  const prior = repoIndex([
    repo({ repo: "owner/kept", stars: 10, lastSeenAt: "2026-05-01T00:00:00Z", lastRefreshedAt: "2026-05-02T00:00:00Z", lastCheapCheckedAt: "2026-05-03T00:00:00Z", lastObservedRepoUpdatedAt: "2026-05-04T00:00:00Z" }),
    repo({ repo: "owner/overlay", stars: 10, lastSeenAt: "2026-05-03T00:00:00Z", lastRefreshedAt: "2026-05-04T00:00:00Z", lastCheapCheckedAt: "2026-05-05T00:00:00Z", lastObservedRepoUpdatedAt: "2026-05-06T00:00:00Z" }),
  ]);

  mergePriorShadowRepoTimestamps(current, prior, "2026-06-10T00:00:00Z");

  assert.equal(current.repos[0]?.lastSeenAt, "2026-05-01T00:00:00Z");
  assert.equal(current.repos[0]?.lastRefreshedAt, "2026-05-02T00:00:00Z");
  assert.equal(current.repos[0]?.lastCheapCheckedAt, "2026-05-03T00:00:00Z");
  assert.equal(current.repos[0]?.lastObservedRepoUpdatedAt, "2026-05-04T00:00:00Z");
  assert.equal(current.repos[1]?.lastCheapCheckedAt, "2026-06-07T00:00:00Z");
  assert.equal(current.repos[1]?.lastObservedRepoUpdatedAt, "2026-06-08T00:00:00Z");
  assert.equal(current.repos[2]?.lastCheapCheckedAt, null);
  assert.equal(current.repos[2]?.lastObservedRepoUpdatedAt, null);
});

test("buildWeeklyCheapCheckRepos sizes queue from eligible non-daily repos and excludes daily repos", () => {
  const daily = [repo({ repo: "owner/daily", stars: 100, state: "core" })];
  const index = repoIndex([
    daily[0],
    ...Array.from({ length: 13 }, (_, i) =>
      repo({ repo: `owner/repo-${String(i).padStart(2, "0")}`, stars: 50 - i, state: i < 2 ? "core" : "library" }),
    ),
  ]);

  const selected = buildWeeklyCheapCheckRepos("combined", index, daily);
  assert.equal(selected.length, Math.ceil((index.repos.length - daily.length) / WEEKLY_CHEAP_CHECK_DAYS));
  assert.equal(selected.some((entry) => entry.repo === "owner/daily"), false);
  assert.deepEqual(buildWeeklyCheapCheckRepos("fast", index, daily), []);
});

test("buildWeeklyCheapCheckRepos target ignores non-daily repos without refreshable skills", () => {
  const daily = [repo({ repo: "owner/daily", stars: 100, state: "core" })];
  const index = repoIndex([
    daily[0],
    repo({ repo: "owner/no-skill-1", stars: 90, skillIds: [], topSkillId: null }),
    repo({ repo: "owner/no-skill-2", stars: 80, skillIds: [], topSkillId: null }),
    repo({ repo: "owner/eligible-1", stars: 70 }),
    repo({ repo: "owner/eligible-2", stars: 60 }),
    repo({ repo: "owner/eligible-3", stars: 50 }),
    repo({ repo: "owner/eligible-4", stars: 40 }),
    repo({ repo: "owner/eligible-5", stars: 30 }),
    repo({ repo: "owner/eligible-6", stars: 20 }),
    repo({ repo: "owner/eligible-7", stars: 10 }),
  ]);

  const selected = buildWeeklyCheapCheckRepos("combined", index, daily);
  assert.equal(selected.length, 1);
});

test("buildWeeklyCheapCheckRepos sorts null cheap-check timestamps first, then oldest, then state, stars, repo", () => {
  const index = repoIndex([
    repo({ repo: "owner/library-old", stars: 20, state: "library", lastCheapCheckedAt: "2026-05-01T00:00:00Z" }),
    repo({ repo: "owner/core-old", stars: 10, state: "core", lastCheapCheckedAt: "2026-05-01T00:00:00Z" }),
    repo({ repo: "owner/core-null-b", stars: 60, state: "core", lastCheapCheckedAt: null }),
    repo({ repo: "owner/core-null-a", stars: 60, state: "core", lastCheapCheckedAt: null }),
    repo({ repo: "owner/rising-old", stars: 90, state: "rising", lastCheapCheckedAt: "2026-05-01T00:00:00Z" }),
    repo({ repo: "owner/newer", stars: 100, state: "core", lastCheapCheckedAt: "2026-05-02T00:00:00Z" }),
  ]);

  assert.deepEqual(
    buildWeeklyCheapCheckRepos("combined", index, []).map((entry) => entry.repo),
    [
      "owner/core-null-a",
      "owner/core-null-b",
      "owner/core-old",
      "owner/rising-old",
      "owner/library-old",
      "owner/newer",
    ].slice(0, Math.ceil(index.repos.length / WEEKLY_CHEAP_CHECK_DAYS)),
  );
});

test("buildWeeklyCheapCheckRepos skips repos without persisted refreshable skills", () => {
  const index = repoIndex([
    repo({ repo: "owner/no-skill", stars: 10, skillIds: [], topSkillId: null }),
    repo({ repo: "owner/has-skill", stars: 9 }),
    repo({ repo: "owner/has-skill-2", stars: 8 }),
    repo({ repo: "owner/has-skill-3", stars: 7 }),
    repo({ repo: "owner/has-skill-4", stars: 6 }),
    repo({ repo: "owner/has-skill-5", stars: 5 }),
    repo({ repo: "owner/has-skill-6", stars: 4 }),
  ]);

  const selected = buildWeeklyCheapCheckRepos("combined", index, []);
  assert.equal(selected.some((entry) => entry.repo === "owner/no-skill"), false);
  assert.equal(selected.length, 1);
});

test("buildWeeklyCheapCheckRepos excludes repo-missing quarantined repos from weekly coverage", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo-missing",
      stars: 100,
      staleOrInvalidState: { reason: "repoMissing", observedRepoUpdatedAt: "" },
    }),
    repo({
      repo: "owner/skill-file-missing",
      stars: 90,
      staleOrInvalidState: { reason: "skillFileMissing", observedRepoUpdatedAt: "2026-06-04T00:00:00Z" },
    }),
    ...Array.from({ length: 6 }, (_, i) => repo({ repo: `owner/eligible-${i}`, stars: 50 - i })),
  ]);

  const selected = buildWeeklyCheapCheckRepos("combined", index, []);
  assert.equal(selected.some((entry) => entry.repo === "owner/repo-missing"), false);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.repo, "owner/skill-file-missing");
});

test("markRepoMissingCheapCheck stores minimal quarantine state", () => {
  const entry = repo({ repo: "owner/missing", stars: 10 });

  markRepoMissingCheapCheck(entry, "2026-06-04T12:00:00Z");

  assert.equal(entry.lastCheapCheckedAt, "2026-06-04T12:00:00Z");
  assert.deepEqual(entry.staleOrInvalidState, {
    reason: "repoMissing",
    observedRepoUpdatedAt: "",
  });
  assert.equal(entry.lastObservedRepoUpdatedAt, null);
});

test("repoMetaLooksChanged compares repo lastUpdated against persisted skill last_updated", () => {
  assert.equal(repoMetaLooksChanged("2026-06-03T00:00:00Z", "2026-06-02T00:00:00Z"), true);
  assert.equal(repoMetaLooksChanged("2026-06-02T00:00:00Z", "2026-06-02T00:00:00Z"), false);
  assert.equal(repoMetaLooksChanged("bad", "2026-06-02T00:00:00Z"), false);
});

test("buildCheapTriggeredRefreshSelection caps changed repos", () => {
  const changed = Array.from({ length: CHEAP_TRIGGERED_REFRESH_LIMIT + 5 }, (_, i) =>
    repo({ repo: `owner/repo-${String(i).padStart(3, "0")}`, stars: i }),
  );

  const selection = buildCheapTriggeredRefreshSelection(changed);

  assert.equal(selection.selected.length, CHEAP_TRIGGERED_REFRESH_LIMIT);
  assert.equal(selection.deferred.length, 5);
});

test("buildCheapTriggeredRefreshSelection orders by state, stars, oldest refresh, repo", () => {
  const selection = buildCheapTriggeredRefreshSelection(
    [
      repo({ repo: "owner/library-high", stars: 1000, state: "library", lastRefreshedAt: "2026-06-01T00:00:00Z" }),
      repo({ repo: "owner/rising-low", stars: 1, state: "rising", lastRefreshedAt: "2026-06-01T00:00:00Z" }),
      repo({ repo: "owner/core-new", stars: 50, state: "core", lastRefreshedAt: "2026-06-02T00:00:00Z" }),
      repo({ repo: "owner/core-old-b", stars: 50, state: "core", lastRefreshedAt: "2026-06-01T00:00:00Z" }),
      repo({ repo: "owner/core-old-a", stars: 50, state: "core", lastRefreshedAt: "2026-06-01T00:00:00Z" }),
      repo({ repo: "owner/core-high", stars: 100, state: "core", lastRefreshedAt: "2026-06-03T00:00:00Z" }),
    ],
    10,
  );

  assert.deepEqual(selection.selected.map((entry) => entry.repo), [
    "owner/core-high",
    "owner/core-old-a",
    "owner/core-old-b",
    "owner/core-new",
    "owner/rising-low",
    "owner/library-high",
  ]);
});

test("deferred changed repos can retain prior observed update while selected repos advance", () => {
  const selected = repo({
    repo: "owner/selected",
    stars: 100,
    lastObservedRepoUpdatedAt: "2026-06-01T00:00:00Z",
  });
  const deferred = repo({
    repo: "owner/deferred",
    stars: 1,
    lastObservedRepoUpdatedAt: "2026-06-01T00:00:00Z",
  });

  const selection = buildCheapTriggeredRefreshSelection([deferred, selected], 1);
  selection.selected[0]!.lastObservedRepoUpdatedAt = "2026-06-03T00:00:00Z";

  assert.equal(selection.selected[0]?.repo, "owner/selected");
  assert.equal(selected.lastObservedRepoUpdatedAt, "2026-06-03T00:00:00Z");
  assert.equal(deferred.lastObservedRepoUpdatedAt, "2026-06-01T00:00:00Z");
});

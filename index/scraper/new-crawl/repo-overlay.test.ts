import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShadowRepoOverlay,
  buildShadowRepoOverlay,
  shouldReadShadowRepoOverlay,
  shouldWriteShadowRepoOverlay,
} from "./repo-overlay.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, ShadowRepoOverlay } from "./types.js";

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
    lastSeenAt: "2026-05-22T00:00:00Z",
    lastRefreshedAt: "2026-05-22T00:00:00Z",
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
    generatedAt: "2026-05-22T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

function overlay(repos: ShadowRepoIndexEntry[]): ShadowRepoOverlay {
  return {
    generatedAt: "2026-05-22T01:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

test("combined run loads overlay and merges onto baseline index", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  const result = applyShadowRepoOverlay(
    "combined",
    index,
    overlay([
      repo({
        repo: "owner/repo",
        stars: 20,
        state: "rising",
        discoveredSources: ["baseline", "awesome"],
        skillIds: ["owner/repo:bootstrapped"],
        skillCount: 1,
        topSkillId: "owner/repo:bootstrapped",
        topSkillStars: 20,
        promotionReasons: ["shortlist-promotion"],
      }),
    ]),
  );

  assert.equal(result.overlayLoaded, true);
  assert.equal(result.overlayEntryCount, 1);
  assert.equal(index.repos[0]?.state, "rising");
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:bootstrapped");
  assert.deepEqual(index.repos[0]?.discoveredSources, ["awesome", "baseline"]);
});

test("fast run loads overlay and merges onto baseline index", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  const result = applyShadowRepoOverlay(
    "fast",
    index,
    overlay([repo({ repo: "owner/repo", stars: 20, state: "rising" })]),
  );

  assert.equal(result.overlayLoaded, true);
  assert.equal(result.overlayEntryCount, 1);
  assert.equal(index.repos[0]?.state, "rising");
  assert.equal(index.repos[0]?.stars, 20);
});

test("periodic and background cadences ignore overlay", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  const periodicResult = applyShadowRepoOverlay(
    "periodic",
    index,
    overlay([repo({ repo: "owner/repo", stars: 20, state: "rising" })]),
  );
  const backgroundResult = applyShadowRepoOverlay(
    "background",
    index,
    overlay([repo({ repo: "owner/repo", stars: 20, state: "rising" })]),
  );

  assert.equal(periodicResult.overlayLoaded, false);
  assert.equal(periodicResult.overlayEntryCount, 0);
  assert.equal(backgroundResult.overlayLoaded, false);
  assert.equal(backgroundResult.overlayEntryCount, 0);
  assert.equal(index.repos[0]?.state, "library");
});

test("only combined writes overlay", () => {
  assert.equal(shouldReadShadowRepoOverlay("fast"), true);
  assert.equal(shouldReadShadowRepoOverlay("combined"), true);
  assert.equal(shouldReadShadowRepoOverlay("periodic"), false);
  assert.equal(shouldReadShadowRepoOverlay("background"), false);

  assert.equal(shouldWriteShadowRepoOverlay("combined"), true);
  assert.equal(shouldWriteShadowRepoOverlay("fast"), false);
  assert.equal(shouldWriteShadowRepoOverlay("periodic"), false);
  assert.equal(shouldWriteShadowRepoOverlay("background"), false);
});

test("overlay-only repo is added to repo index", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([
      repo({
        repo: "new/repo",
        stars: 50,
        state: "rising",
        discoveredSources: ["awesome"],
        skillIds: [],
        skillCount: 0,
        topSkillId: null,
        topSkillStars: 0,
      }),
    ]),
  );

  assert.equal(index.repoCount, 2);
  assert.ok(index.repos.find((row) => row.repo === "new/repo"));
});

test("overlay state overrides baseline state for the same repo", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10, state: "library" })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([repo({ repo: "owner/repo", stars: 10, state: "rising" })]),
  );

  assert.equal(index.repos[0]?.state, "rising");
});

test("promoted rising repo survives into next combined-run starting state", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10, state: "library" })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([repo({ repo: "owner/repo", stars: 10, state: "rising", promotionReasons: ["shortlist-promotion"] })]),
  );

  assert.equal(index.repos[0]?.state, "rising");
  assert.deepEqual(index.repos[0]?.promotionReasons, ["shortlist-promotion"]);
});

test("bootstrapped skill ids survive into next combined-run starting state", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([
      repo({
        repo: "owner/repo",
        stars: 10,
        skillIds: ["owner/repo:bootstrapped"],
        skillCount: 1,
        topSkillId: "owner/repo:bootstrapped",
        topSkillStars: 10,
      }),
    ]),
  );

  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:bootstrapped"]);
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:bootstrapped");
});

test("overlay write count matches persisted repo entries", () => {
  const baseline = repoIndex([
    repo({ repo: "same/repo", stars: 10 }),
    repo({ repo: "changed/repo", stars: 10 }),
  ]);
  const current = repoIndex([
    repo({ repo: "same/repo", stars: 10 }),
    repo({ repo: "changed/repo", stars: 20, state: "rising", promotionReasons: ["shortlist-promotion"] }),
    repo({ repo: "new/repo", stars: 30, state: "rising", discoveredSources: ["awesome"], skillIds: [], skillCount: 0, topSkillId: null, topSkillStars: 0 }),
  ]);

  const result = buildShadowRepoOverlay(current, baseline, "2026-05-22T02:00:00Z");

  assert.equal(result.repoCount, 2);
  assert.deepEqual(result.repos.map((row) => row.repo), ["changed/repo", "new/repo"]);
});

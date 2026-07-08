import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShortlistPromotions,
  buildDailyPriorityRepos,
  buildNextPromotionCandidates,
  buildNextPromotionShortlist,
  DAILY_PRIORITY_REPO_LIMIT,
  MOMENTUM_PROMOTION_MIN_STARS,
  NEXT_PROMOTION_SHORTLIST_LIMIT,
  PERIODIC_PROMOTION_MIN_STARS,
  SHORTLIST_PROMOTION_LIMIT,
} from "./daily-priority.js";
import type { PriorityReason, PriorityReasonCounts, ShadowRepoIndex, ShadowRepoIndexEntry } from "./types.js";

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "stars">): ShadowRepoIndexEntry {
  const { repo: repoName, stars, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "core",
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

function discovered(...repos: string[]): Map<string, { repo: string; sources: Set<string>; lanes: Set<"fast">; stars: number }> {
  return new Map(repos.map((repo) => [repo, { repo, sources: new Set(["official"]), lanes: new Set(["fast"]), stars: 0 }]));
}

function candidateDiscovery(
  rows: Array<{ repo: string; lanes: Array<"periodic" | "background">; sources?: string[]; stars?: number }>,
): Map<string, { repo: string; sources: Set<string>; lanes: Set<"periodic" | "background">; stars: number }> {
  return new Map(
    rows.map((row) => [
      row.repo,
      {
        repo: row.repo,
        sources: new Set(row.sources ?? row.lanes),
        lanes: new Set(row.lanes),
        stars: row.stars ?? 0,
      },
    ]),
  );
}

function countReasons(reasonByRepo: Map<string, PriorityReason>): PriorityReasonCounts {
  const counts: PriorityReasonCounts = {
    official: 0,
    goldBasket: 0,
    trustedVendor: 0,
    creatorWatch: 0,
    momentum: 0,
    stars: 0,
  };
  for (const reason of reasonByRepo.values()) {
    counts[reason] += 1;
  }
  return counts;
}

test("caps daily priority selection by bucket and total size", () => {
  const repos: ShadowRepoIndexEntry[] = [];
  for (let i = 0; i < 20; i += 1) {
    repos.push(repo({ repo: `official/repo-${i}`, stars: 500 - i }));
  }
  for (let i = 0; i < 20; i += 1) {
    repos.push(repo({ repo: `gold/repo-${i}`, stars: 400 - i, isGoldBasketRepo: true }));
  }
  for (let i = 0; i < 20; i += 1) {
    repos.push(repo({ repo: `vendor/repo-${i}`, stars: 300 - i, isTrustedVendor: true }));
  }
  for (let i = 0; i < 40; i += 1) {
    repos.push(repo({ repo: `stars/repo-${i}`, stars: 200 - i }));
  }

  const result = buildDailyPriorityRepos(
    repoIndex(repos),
    discovered(...repos.filter((row) => row.repo.startsWith("official/")).map((row) => row.repo)),
  );
  const counts = countReasons(result.reasonByRepo);

  assert.equal(result.repos.length, DAILY_PRIORITY_REPO_LIMIT);
  assert.equal(counts.official, 12);
  assert.equal(counts.goldBasket, 10);
  assert.equal(counts.trustedVendor, 8);
  assert.equal(counts.creatorWatch, 0);
  assert.equal(counts.momentum, 0);
  assert.equal(counts.stars, 10);
});

test("earlier buckets beat higher-star fallback repos", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "official/selected", stars: 5 }),
      repo({ repo: "gold/selected", stars: 4, isGoldBasketRepo: true }),
      repo({ repo: "vendor/selected", stars: 3, isTrustedVendor: true }),
      repo({ repo: "plain/high-stars", stars: 999 }),
    ]),
    discovered("official/selected"),
  );

  assert.equal(result.reasonByRepo.get("official/selected"), "official");
  assert.equal(result.reasonByRepo.get("gold/selected"), "goldBasket");
  assert.equal(result.reasonByRepo.get("vendor/selected"), "trustedVendor");
  assert.equal(result.reasonByRepo.get("plain/high-stars"), "stars");
});

test("dedupes repos that match multiple buckets and keeps the first winning reason", () => {
  const dual = repo({
    repo: "dual/repo",
    stars: 100,
    isGoldBasketRepo: true,
    isTrustedVendor: true,
  });

  const result = buildDailyPriorityRepos(repoIndex([dual]), discovered("dual/repo"));

  assert.equal(result.repos.length, 1);
  assert.equal(result.reasonByRepo.get("dual/repo"), "official");
});

test("fills leftover slots by stars after earlier buckets", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "official/one", stars: 5 }),
      repo({ repo: "plain/low", stars: 1 }),
      repo({ repo: "plain/high", stars: 10 }),
      repo({ repo: "plain/mid", stars: 7 }),
    ]),
    discovered("official/one"),
  );

  assert.deepEqual(
    result.repos.map((row) => row.repo),
    ["official/one", "plain/high", "plain/mid", "plain/low"],
  );
  assert.equal(result.reasonByRepo.get("plain/high"), "stars");
  assert.equal(result.reasonByRepo.get("plain/mid"), "stars");
  assert.equal(result.reasonByRepo.get("plain/low"), "stars");
});

test("skipped monitored repo count matches total monitored minus selected", () => {
  const repos = Array.from({ length: 45 }, (_, index) => repo({ repo: `plain/repo-${index}`, stars: 100 - index }));
  repos.push(repo({ repo: "library/ignored", stars: 1, state: "library" }));
  repos[0] = repo({ repo: "official/one", stars: 500 });

  const result = buildDailyPriorityRepos(repoIndex(repos), discovered("official/one"));

  assert.equal(result.repos.length, DAILY_PRIORITY_REPO_LIMIT);
  assert.equal(result.skippedMonitoredRepoCount, 5);
});

test("priority reason counts and sample reasons stay valid for report output", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "official/one", stars: 10 }),
      repo({ repo: "gold/one", stars: 9, isGoldBasketRepo: true }),
      repo({ repo: "vendor/one", stars: 8, isTrustedVendor: true }),
      repo({ repo: "plain/one", stars: 7 }),
    ]),
    discovered("official/one"),
  );
  const counts = countReasons(result.reasonByRepo);
  const sample = result.repos.slice(0, 10).map((row) => ({
    repo: row.repo,
    reason: result.reasonByRepo.get(row.repo),
  }));

  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), result.repos.length);
  for (const row of sample) {
    assert.ok(row.reason);
    assert.ok(["official", "goldBasket", "trustedVendor", "creatorWatch", "momentum", "stars"].includes(row.reason));
  }
});

test("creator-watch is disabled unless options enable it", () => {
  const watched = repo({ repo: "watched/repo", stars: 1 });
  const highStars = repo({ repo: "plain/high", stars: 100 });

  const result = buildDailyPriorityRepos(
    repoIndex([watched, highStars]),
    new Map(),
    { watchedCreatorHandles: new Set(["watched"]) },
  );

  assert.deepEqual(result.repos.map((row) => row.repo), ["plain/high", "watched/repo"]);
  assert.equal(result.reasonByRepo.get("watched/repo"), "stars");
});

test("creator-watch selects monitored repos before stars fill", () => {
  const watched = repo({ repo: "watched/repo", stars: 1, lastRefreshedAt: "2026-05-01T00:00:00Z" });
  const highStars = repo({ repo: "plain/high", stars: 100, lastRefreshedAt: "2026-05-02T00:00:00Z" });

  const result = buildDailyPriorityRepos(
    repoIndex([highStars, watched]),
    new Map(),
    { creatorWatchEnabled: true, watchedCreatorHandles: new Set(["watched"]) },
  );

  assert.deepEqual(result.repos.map((row) => row.repo), ["watched/repo", "plain/high"]);
  assert.equal(result.reasonByRepo.get("watched/repo"), "creatorWatch");
  assert.equal(result.reasonByRepo.get("plain/high"), "stars");
});

test("creator-watch is capped and sorted by refresh age, stars, then repo", () => {
  const repos = [
    repo({ repo: "watched/newer", stars: 999, lastRefreshedAt: "2026-05-03T00:00:00Z" }),
    repo({ repo: "watched/old-high", stars: 20, lastRefreshedAt: "2026-05-01T00:00:00Z" }),
    repo({ repo: "watched/old-low", stars: 10, lastRefreshedAt: "2026-05-01T00:00:00Z" }),
    repo({ repo: "watched/old-alpha", stars: 10, lastRefreshedAt: "2026-05-01T00:00:00Z" }),
  ];

  const result = buildDailyPriorityRepos(
    repoIndex(repos),
    new Map(),
    {
      creatorWatchEnabled: true,
      watchedCreatorHandles: new Set(["watched"]),
      creatorWatchCap: 3,
    },
  );

  assert.deepEqual(
    result.repos.slice(0, 3).map((row) => row.repo),
    ["watched/old-high", "watched/old-alpha", "watched/old-low"],
  );
  assert.equal(result.reasonByRepo.get("watched/newer"), "stars");
});

test("earlier buckets keep priority over creator-watch", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "watched/official", stars: 1 }),
      repo({ repo: "watched/gold", stars: 2, isGoldBasketRepo: true }),
      repo({ repo: "watched/vendor", stars: 3, isTrustedVendor: true }),
      repo({ repo: "watched/plain", stars: 4 }),
    ]),
    discovered("watched/official"),
    { creatorWatchEnabled: true, watchedCreatorHandles: new Set(["watched"]) },
  );

  assert.equal(result.reasonByRepo.get("watched/official"), "official");
  assert.equal(result.reasonByRepo.get("watched/gold"), "goldBasket");
  assert.equal(result.reasonByRepo.get("watched/vendor"), "trustedVendor");
  assert.equal(result.reasonByRepo.get("watched/plain"), "creatorWatch");
});

test("creator-watch matches owner aliases and ignores library repos", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "oldhandle/repo", stars: 1 }),
      repo({ repo: "watched/library", stars: 100, state: "library" }),
      repo({ repo: "plain/repo", stars: 50 }),
    ]),
    new Map(),
    {
      creatorWatchEnabled: true,
      watchedCreatorHandles: new Set(["canonical"]),
      creatorAliasToCanonicalHandle: new Map([["oldhandle", "canonical"]]),
    },
  );

  assert.equal(result.reasonByRepo.get("oldhandle/repo"), "creatorWatch");
  assert.equal(result.reasonByRepo.get("watched/library"), undefined);
  assert.equal(result.reasonByRepo.get("plain/repo"), "stars");
});

test("momentum is disabled unless options enable it", () => {
  const moving = repo({ repo: "moving/repo", stars: 1 });
  const highStars = repo({ repo: "plain/high", stars: 100 });

  const result = buildDailyPriorityRepos(
    repoIndex([moving, highStars]),
    new Map(),
    { momentumByRepo: new Map([["moving/repo", new Set(["validatedX"])]]) },
  );

  assert.deepEqual(result.repos.map((row) => row.repo), ["plain/high", "moving/repo"]);
  assert.equal(result.reasonByRepo.get("moving/repo"), "stars");
});

test("momentum selects monitored repos before stars fill", () => {
  const moving = repo({ repo: "moving/repo", stars: 1 });
  const highStars = repo({ repo: "plain/high", stars: 100 });

  const result = buildDailyPriorityRepos(
    repoIndex([highStars, moving]),
    new Map(),
    { momentumEnabled: true, momentumByRepo: new Map([["moving/repo", new Set(["validatedX"])]]) },
  );

  assert.deepEqual(result.repos.map((row) => row.repo), ["moving/repo", "plain/high"]);
  assert.equal(result.reasonByRepo.get("moving/repo"), "momentum");
  assert.equal(result.reasonByRepo.get("plain/high"), "stars");
});

test("momentum is capped and sorted by source strength, stars, then repo", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "moving/both", stars: 1 }),
      repo({ repo: "moving/x-high", stars: 10 }),
      repo({ repo: "moving/x-low", stars: 2 }),
      repo({ repo: "moving/skillssh", stars: 999 }),
    ]),
    new Map(),
    {
      momentumEnabled: true,
      momentumCap: 3,
      momentumByRepo: new Map([
        ["moving/both", new Set(["skillssh", "validatedX"])],
        ["moving/x-high", new Set(["validatedX"])],
        ["moving/x-low", new Set(["validatedX"])],
        ["moving/skillssh", new Set(["skillssh"])],
      ]),
    },
  );

  assert.deepEqual(
    result.repos.slice(0, 3).map((row) => row.repo),
    ["moving/both", "moving/x-high", "moving/x-low"],
  );
  assert.equal(result.reasonByRepo.get("moving/skillssh"), "stars");
});

test("earlier buckets keep priority over momentum", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "moving/official", stars: 1 }),
      repo({ repo: "moving/gold", stars: 2, isGoldBasketRepo: true }),
      repo({ repo: "moving/vendor", stars: 3, isTrustedVendor: true }),
      repo({ repo: "moving/plain", stars: 4 }),
    ]),
    discovered("moving/official"),
    {
      momentumEnabled: true,
      momentumByRepo: new Map([
        ["moving/official", new Set(["validatedX"])],
        ["moving/gold", new Set(["validatedX"])],
        ["moving/vendor", new Set(["validatedX"])],
        ["moving/plain", new Set(["validatedX"])],
      ]),
    },
  );

  assert.equal(result.reasonByRepo.get("moving/official"), "official");
  assert.equal(result.reasonByRepo.get("moving/gold"), "goldBasket");
  assert.equal(result.reasonByRepo.get("moving/vendor"), "trustedVendor");
  assert.equal(result.reasonByRepo.get("moving/plain"), "momentum");
});

test("momentum daily priority ignores library repos", () => {
  const result = buildDailyPriorityRepos(
    repoIndex([
      repo({ repo: "moving/library", stars: 1000, state: "library" }),
      repo({ repo: "plain/repo", stars: 50 }),
    ]),
    new Map(),
    { momentumEnabled: true, momentumByRepo: new Map([["moving/library", new Set(["validatedX"])]]) },
  );

  assert.equal(result.reasonByRepo.get("moving/library"), undefined);
  assert.equal(result.reasonByRepo.get("plain/repo"), "stars");
});

test("already-selected daily repos are excluded from next promotion candidates", () => {
  const repos = repoIndex([
    repo({ repo: "daily/repo", stars: 100, isTrustedVendor: true, state: "library" }),
    repo({ repo: "next/repo", stars: 90, state: "library" }),
  ]);
  const daily = [repos.repos[0]];

  const result = buildNextPromotionCandidates(
    repos,
    candidateDiscovery([
      { repo: "daily/repo", lanes: ["periodic"] },
      { repo: "next/repo", lanes: ["periodic"] },
    ]),
    daily,
  );

  assert.deepEqual(result.map((row) => row.repo), ["next/repo"]);
});

test("periodic candidates rank ahead of background candidates", () => {
  const result = buildNextPromotionCandidates(
    repoIndex([
      repo({ repo: "periodic/repo", stars: 1, state: "library" }),
      repo({ repo: "background/repo", stars: 999, state: "library" }),
    ]),
    candidateDiscovery([
      { repo: "background/repo", lanes: ["background"] },
      { repo: "periodic/repo", lanes: ["periodic"] },
    ]),
    [],
  );

  assert.deepEqual(result.map((row) => row.repo), ["periodic/repo", "background/repo"]);
});

test("momentum library repos enter promotion candidates before periodic and background", () => {
  const result = buildNextPromotionCandidates(
    repoIndex([
      repo({ repo: "moving/repo", stars: 100, state: "library" }),
      repo({ repo: "periodic/repo", stars: 999, state: "library" }),
      repo({ repo: "background/repo", stars: 998, state: "library" }),
    ]),
    candidateDiscovery([
      { repo: "moving/repo", lanes: ["background"] },
      { repo: "periodic/repo", lanes: ["periodic"] },
      { repo: "background/repo", lanes: ["background"] },
    ]),
    [],
    new Set(),
    new Map([["moving/repo", new Set(["validatedX"])]]),
  );

  assert.deepEqual(result.map((row) => row.repo), ["moving/repo", "periodic/repo", "background/repo"]);
  assert.equal(result[0]?.reason, "momentum");
});

test("trusted vendor ranks ahead of plain periodic and background candidates", () => {
  const result = buildNextPromotionCandidates(
    repoIndex([
      repo({ repo: "vendor/repo", stars: 1, isTrustedVendor: true, state: "library" }),
      repo({ repo: "periodic/repo", stars: 999, state: "library" }),
      repo({ repo: "background/repo", stars: 998, state: "library" }),
    ]),
    candidateDiscovery([
      { repo: "vendor/repo", lanes: ["background"] },
      { repo: "periodic/repo", lanes: ["periodic"] },
      { repo: "background/repo", lanes: ["background"] },
    ]),
    [],
  );

  assert.equal(result[0]?.repo, "vendor/repo");
  assert.equal(result[0]?.reason, "trustedVendor");
});

test("gold basket ranks ahead of plain periodic and background candidates", () => {
  const result = buildNextPromotionCandidates(
    repoIndex([
      repo({ repo: "gold/repo", stars: 1, isGoldBasketRepo: true, state: "library" }),
      repo({ repo: "periodic/repo", stars: 999, state: "library" }),
      repo({ repo: "background/repo", stars: 998, state: "library" }),
    ]),
    candidateDiscovery([
      { repo: "gold/repo", lanes: ["background"] },
      { repo: "periodic/repo", lanes: ["periodic"] },
      { repo: "background/repo", lanes: ["background"] },
    ]),
    [],
  );

  assert.equal(result[0]?.repo, "gold/repo");
  assert.equal(result[0]?.reason, "goldBasket");
});

test("stars break ties within the same candidate reason bucket", () => {
  const result = buildNextPromotionCandidates(
    repoIndex([
      repo({ repo: "periodic/high", stars: 20, state: "library" }),
      repo({ repo: "periodic/low", stars: 10, state: "library" }),
      repo({ repo: "periodic/zero", stars: 0, state: "library" }),
    ]),
    candidateDiscovery([
      { repo: "periodic/low", lanes: ["periodic"] },
      { repo: "periodic/high", lanes: ["periodic"] },
      { repo: "periodic/zero", lanes: ["periodic"] },
    ]),
    [],
  );

  assert.deepEqual(result.map((row) => row.repo), ["periodic/high", "periodic/low", "periodic/zero"]);
});

test("excluded catalog repos are not proposed for promotion", () => {
  const result = buildNextPromotionCandidates(
    repoIndex([
      repo({ repo: "sickn33/antigravity-awesome-skills", stars: 50000, state: "library" }),
      repo({ repo: "periodic/kept", stars: 500, state: "library" }),
    ]),
    candidateDiscovery([
      { repo: "sickn33/antigravity-awesome-skills", lanes: ["periodic"] },
      { repo: "periodic/kept", lanes: ["periodic"] },
    ]),
    [],
    new Set(["sickn33/antigravity-awesome-skills"]),
  );

  assert.deepEqual(result.map((row) => row.repo), ["periodic/kept"]);
});

test("promotion shortlist respects total cap", () => {
  const candidates = [
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `vendor/${index}`, stars: 100 - index, reason: "trustedVendor" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `gold/${index}`, stars: 90 - index, reason: "goldBasket" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `momentum/${index}`, stars: 85 - index, reason: "momentum" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `periodic/${index}`, stars: 80 - index, reason: "periodic" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `background/${index}`, stars: 70 - index, reason: "background" as const })),
  ];

  const shortlist = buildNextPromotionShortlist(candidates);

  assert.equal(shortlist.length, NEXT_PROMOTION_SHORTLIST_LIMIT);
});

test("promotion shortlist respects per-reason caps", () => {
  const candidates = [
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `vendor/${index}`, stars: 100 - index, reason: "trustedVendor" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `gold/${index}`, stars: 90 - index, reason: "goldBasket" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `momentum/${index}`, stars: 85 - index, reason: "momentum" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `periodic/${index}`, stars: 80 - index, reason: "periodic" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `background/${index}`, stars: 70 - index, reason: "background" as const })),
  ];

  const shortlist = buildNextPromotionShortlist(candidates);
  const counts = shortlist.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});

  assert.equal(counts.trustedVendor, 5);
  assert.equal(counts.goldBasket, 3);
  assert.equal(counts.momentum, 5);
  assert.equal(counts.periodic, 7);
  assert.equal(counts.background ?? 0, 0);
});

test("promotion shortlist preserves ranked order within each reason bucket", () => {
  const shortlist = buildNextPromotionShortlist([
    { repo: "vendor/high", stars: 20, reason: "trustedVendor" },
    { repo: "vendor/mid", stars: 15, reason: "trustedVendor" },
    { repo: "vendor/low", stars: 10, reason: "trustedVendor" },
    { repo: "periodic/high", stars: 2, reason: "periodic" },
    { repo: "periodic/low", stars: 1, reason: "periodic" },
  ]);

  assert.deepEqual(
    shortlist.filter((row) => row.reason === "trustedVendor").map((row) => row.repo),
    ["vendor/high", "vendor/mid", "vendor/low"],
  );
  assert.deepEqual(
    shortlist.filter((row) => row.reason === "periodic").map((row) => row.repo),
    ["periodic/high", "periodic/low"],
  );
});

test("only top 3 shortlist repos are promoted", async () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 700, state: "library" }),
    repo({ repo: "library/two", stars: 650, state: "library" }),
    repo({ repo: "library/three", stars: 600, state: "library" }),
    repo({ repo: "library/four", stars: 550, state: "library" }),
  ]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [
      { repo: "library/one", stars: 700, reason: "periodic" },
      { repo: "library/two", stars: 650, reason: "periodic" },
      { repo: "library/three", stars: 600, reason: "goldBasket" },
      { repo: "library/four", stars: 550, reason: "trustedVendor" },
    ],
  });

  assert.equal(promoted.length, SHORTLIST_PROMOTION_LIMIT);
  assert.deepEqual(promoted.map((row) => row.repo), ["library/one", "library/two", "library/three"]);
});

test("only library repos are promoted and they become rising", async () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 700, state: "library" }),
    repo({ repo: "rising/one", stars: 9, state: "rising" }),
    repo({ repo: "core/one", stars: 8, state: "core" }),
  ]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [
      { repo: "library/one", stars: 700, reason: "periodic" },
      { repo: "rising/one", stars: 9, reason: "periodic" },
      { repo: "core/one", stars: 8, reason: "background" },
    ],
  });

  assert.equal(promoted.length, 1);
  assert.equal(promoted[0]?.repo, "library/one");
  assert.equal(promoted[0]?.priorState, "library");
  assert.equal(promoted[0]?.newState, "rising");
  assert.equal(promoted[0]?.promotionKind, "existing-library");
  const promotedRepo = index.repos.find((row) => row.repo === "library/one");
  assert.equal(promotedRepo?.state, "rising");
  assert.ok(promotedRepo?.promotionReasons.includes("shortlist-promotion"));
});

test("momentum promotion requires 100 stars", async () => {
  const index = repoIndex([
    repo({ repo: "moving/kept", stars: MOMENTUM_PROMOTION_MIN_STARS - 1, state: "library" }),
    repo({ repo: "moving/promoted", stars: MOMENTUM_PROMOTION_MIN_STARS, state: "library" }),
  ]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [
      { repo: "moving/kept", stars: MOMENTUM_PROMOTION_MIN_STARS - 1, reason: "momentum" },
      { repo: "moving/promoted", stars: MOMENTUM_PROMOTION_MIN_STARS, reason: "momentum" },
    ],
  });

  assert.deepEqual(promoted.map((row) => row.repo), ["moving/promoted"]);
  assert.equal(index.repos.find((row) => row.repo === "moving/kept")?.state, "library");
  assert.equal(index.repos.find((row) => row.repo === "moving/promoted")?.state, "rising");
});

test("promotion does not run on non-combined cadences", async () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 700, state: "library" }),
  ]);

  const promoted = await applyShortlistPromotions({
    cadence: "fast",
    repoIndex: index,
    shortlist: [{ repo: "library/one", stars: 700, reason: "periodic" }],
  });

  assert.equal(promoted.length, 0);
  assert.equal(index.repos[0]?.state, "library");
});

test("missing repo is not created by shortlist promotion", async () => {
  const index = repoIndex([]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [{ repo: "new/repo", stars: PERIODIC_PROMOTION_MIN_STARS, reason: "periodic" }],
  });

  assert.equal(promoted.length, 0);
  assert.equal(index.repoCount, 0);
});

test("missing repo below 100 stars is not created", async () => {
  const index = repoIndex([]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [{ repo: "small/repo", stars: 99, reason: "background" }],
  });

  assert.equal(promoted.length, 0);
  assert.equal(index.repoCount, 0);
});

test("background shortlist repos do not auto-promote", async () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 5000, state: "library" }),
  ]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [{ repo: "library/one", stars: 5000, reason: "background" }],
  });

  assert.equal(promoted.length, 0);
  assert.equal(index.repos[0]?.state, "library");
});

test("plain periodic shortlist repos below 500 stars do not auto-promote", async () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 499, state: "library" }),
  ]);

  const promoted = await applyShortlistPromotions({
    cadence: "combined",
    repoIndex: index,
    shortlist: [{ repo: "library/one", stars: 499, reason: "periodic" }],
  });

  assert.equal(promoted.length, 0);
  assert.equal(index.repos[0]?.state, "library");
});

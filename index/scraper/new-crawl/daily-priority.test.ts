import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShortlistPromotions,
  buildDailyPriorityRepos,
  buildNextPromotionCandidates,
  buildNextPromotionShortlist,
  DAILY_PRIORITY_REPO_LIMIT,
  NEXT_PROMOTION_SHORTLIST_LIMIT,
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

function discovered(...repos: string[]): Map<string, { repo: string; sources: Set<string>; lanes: Set<"fast"> }> {
  return new Map(repos.map((repo) => [repo, { repo, sources: new Set(["official"]), lanes: new Set(["fast"]) }]));
}

function candidateDiscovery(
  rows: Array<{ repo: string; lanes: Array<"periodic" | "background">; sources?: string[] }>,
): Map<string, { repo: string; sources: Set<string>; lanes: Set<"periodic" | "background"> }> {
  return new Map(
    rows.map((row) => [
      row.repo,
      {
        repo: row.repo,
        sources: new Set(row.sources ?? row.lanes),
        lanes: new Set(row.lanes),
      },
    ]),
  );
}

function countReasons(reasonByRepo: Map<string, PriorityReason>): PriorityReasonCounts {
  const counts: PriorityReasonCounts = {
    official: 0,
    goldBasket: 0,
    trustedVendor: 0,
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
    assert.ok(["official", "goldBasket", "trustedVendor", "stars"].includes(row.reason));
  }
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

test("promotion shortlist respects total cap", () => {
  const candidates = [
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `vendor/${index}`, stars: 100 - index, reason: "trustedVendor" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ repo: `gold/${index}`, stars: 90 - index, reason: "goldBasket" as const })),
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
  assert.equal(counts.periodic, 8);
  assert.equal(counts.background, 4);
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

test("only top 3 shortlist repos are promoted", () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 10, state: "library" }),
    repo({ repo: "library/two", stars: 9, state: "library" }),
    repo({ repo: "library/three", stars: 8, state: "library" }),
    repo({ repo: "library/four", stars: 7, state: "library" }),
  ]);

  const promoted = applyShortlistPromotions(
    index,
    [
      { repo: "library/one", stars: 10, reason: "periodic" },
      { repo: "library/two", stars: 9, reason: "periodic" },
      { repo: "library/three", stars: 8, reason: "background" },
      { repo: "library/four", stars: 7, reason: "background" },
    ],
    "combined",
  );

  assert.equal(promoted.length, SHORTLIST_PROMOTION_LIMIT);
  assert.deepEqual(promoted.map((row) => row.repo), ["library/one", "library/two", "library/three"]);
});

test("only library repos are promoted and they become rising", () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 10, state: "library" }),
    repo({ repo: "rising/one", stars: 9, state: "rising" }),
    repo({ repo: "core/one", stars: 8, state: "core" }),
  ]);

  const promoted = applyShortlistPromotions(
    index,
    [
      { repo: "library/one", stars: 10, reason: "periodic" },
      { repo: "rising/one", stars: 9, reason: "periodic" },
      { repo: "core/one", stars: 8, reason: "background" },
    ],
    "combined",
  );

  assert.equal(promoted.length, 1);
  assert.equal(promoted[0]?.repo, "library/one");
  assert.equal(promoted[0]?.priorState, "library");
  assert.equal(promoted[0]?.newState, "rising");
  assert.equal(index.repos[0]?.state, "rising");
  assert.ok(index.repos[0]?.promotionReasons.includes("shortlist-promotion"));
});

test("promotion does not run on non-combined cadences", () => {
  const index = repoIndex([
    repo({ repo: "library/one", stars: 10, state: "library" }),
  ]);

  const promoted = applyShortlistPromotions(
    index,
    [{ repo: "library/one", stars: 10, reason: "periodic" }],
    "fast",
  );

  assert.equal(promoted.length, 0);
  assert.equal(index.repos[0]?.state, "library");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildCrawl4Preview } from "./crawl4-preview.js";
import type { Crawl4Preview, ShadowRepoIndex, ShadowRepoIndexEntry, ShadowSkillRecord, TrustedSeeds } from "./types.js";

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
    lastSeenAt: "2026-06-02T00:00:00Z",
    lastRefreshedAt: "2026-06-02T00:00:00Z",
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

function skill(overrides: Partial<ShadowSkillRecord> & Pick<ShadowSkillRecord, "id" | "github_url" | "stars">): ShadowSkillRecord {
  const { id, github_url, stars, ...rest } = overrides;
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url,
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars,
    last_updated: "2026-06-02T00:00:00Z",
    first_seen: "2026-06-02",
    skill_md_sha: "sha",
    publisher_handle: "owner",
    publisher_repo: "owner/repo",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    ...rest,
  };
}

function seeds(partial: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...partial,
  };
}

function discovered(rows: Array<{ repo: string; sources: string[]; stars: number }>): Map<string, { repo: string; sources: Set<string>; lanes: Set<"fast" | "periodic" | "background">; stars: number }> {
  return new Map(rows.map((row) => [row.repo, { repo: row.repo, sources: new Set(row.sources), lanes: new Set(["periodic"]), stars: row.stars }]));
}

test("builds tier counts, missing tiers, and momentum summary", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "openai/codex", stars: 20, state: "core" }),
      repo({ repo: "plain/high", stars: 60_000, state: "core" }),
      repo({ repo: "plain/mid", stars: 20_000, state: "rising" }),
      repo({ repo: "plain/low", stars: 10, state: "rising" }),
    ]),
    shadowSkills: [
      skill({ id: "openai/codex:one", github_url: "https://github.com/openai/codex", stars: 20 }),
      skill({ id: "plain/high:one", github_url: "https://github.com/plain/high", stars: 60_000 }),
      skill({ id: "plain/mid:one", github_url: "https://github.com/plain/mid", stars: 20_000 }),
      skill({ id: "plain/low:one", github_url: "https://github.com/plain/low", stars: 10 }),
    ],
    unresolvedCatalogPublishers: [{ publisherRepo: "catalog/repo", count: 3 }],
    discovered: discovered([
      { repo: "openai/codex", sources: ["official", "skillssh"], stars: 20 },
      { repo: "plain/high", sources: ["skillssh"], stars: 60_000 },
      { repo: "plain/mid", sources: ["registry"], stars: 20_000 },
      { repo: "plain/low", sources: ["registry"], stars: 10 },
    ]),
    momentumByRepo: new Map([
      ["openai/codex", new Set(["skillssh", "validatedX"])],
      ["plain/high", new Set(["skillssh"])],
    ]),
    seeds: seeds({
      officialTier1Repos: new Set(["openai/codex", "missing/tier1"]),
      officialTier2Repos: new Set(["missing/tier2"]),
    }),
  });

  assert.deepEqual(preview.tierCounts, { tier1: 2, tier2: 1, longtail: 1 });
  assert.deepEqual(preview.missingTier1Repos, ["missing/tier1"]);
  assert.deepEqual(preview.missingTier2Repos, ["missing/tier2"]);
  assert.deepEqual(preview.unresolvedCatalogRepos, ["catalog/repo"]);
  assert.deepEqual(preview.momentumCounts, { skillssh: 1, validatedX: 0, both: 1 });
  assert.deepEqual(preview.momentumRepoSample, ["openai/codex", "plain/high"]);
});

test("daily priority preview diffs are stable and deterministic", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "plain/high", stars: 999, state: "core" }),
      repo({ repo: "tier2/official", stars: 5, state: "rising" }),
      repo({ repo: "momentum/repo", stars: 4, state: "rising" }),
    ]),
    shadowSkills: [
      skill({ id: "plain/high:one", github_url: "https://github.com/plain/high", stars: 999 }),
      skill({ id: "tier2/official:one", github_url: "https://github.com/tier2/official", stars: 5 }),
      skill({ id: "momentum/repo:one", github_url: "https://github.com/momentum/repo", stars: 4 }),
    ],
    unresolvedCatalogPublishers: [],
    discovered: discovered([
      { repo: "plain/high", sources: ["registry"], stars: 999 },
      { repo: "tier2/official", sources: ["registry"], stars: 5 },
      { repo: "momentum/repo", sources: ["skillssh"], stars: 4 },
    ]),
    momentumByRepo: new Map([["momentum/repo", new Set(["skillssh"])]]),
    seeds: seeds({
      officialTier2Repos: new Set(["tier2/official"]),
    }),
  });

  assert.equal(preview.currentDailyPriorityRepos.length, 3);
  assert.equal(preview.proposedDailyPriorityRepos.length, 3);
  assert.deepEqual(preview.dailyPriorityAdded, []);
  assert.deepEqual(preview.dailyPriorityRemoved, []);
  assert.equal(preview.currentDailyPriorityRepos[0], "plain/high");
  assert.equal(preview.proposedDailyPriorityRepos[0], "tier2/official");
});

test("shortlist previews exclude known catalog repos", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "sickn33/antigravity-awesome-skills", stars: 50_000, state: "library" }),
      repo({ repo: "owner/kept", stars: 500, state: "library" }),
    ]),
    shadowSkills: [
      skill({ id: "sickn33/antigravity-awesome-skills:docker-expert", github_url: "https://github.com/sickn33/antigravity-awesome-skills", stars: 50_000 }),
      skill({ id: "owner/kept:skill", github_url: "https://github.com/owner/kept", stars: 500 }),
    ],
    unresolvedCatalogPublishers: [{ publisherRepo: "sickn33/antigravity-awesome-skills", count: 1 }],
    discovered: discovered([
      { repo: "sickn33/antigravity-awesome-skills", sources: ["skillssh"], stars: 50_000 },
      { repo: "owner/kept", sources: ["skillssh"], stars: 500 },
    ]),
    momentumByRepo: new Map(),
    seeds: seeds({
      catalogRepoRules: [{ repo: "sickn33/antigravity-awesome-skills", defaultProvenanceType: "catalog" }],
    }),
  });

  assert.equal(preview.currentShortlistRepos.includes("sickn33/antigravity-awesome-skills"), false);
  assert.equal(preview.proposedShortlistRepos.includes("sickn33/antigravity-awesome-skills"), false);
  assert.ok(preview.currentShortlistRepos.includes("owner/kept"));
  assert.ok(preview.proposedShortlistRepos.includes("owner/kept"));
});

test("daily priority preview keeps a 50 repo recall cap", () => {
  const rows = Array.from({ length: 60 }, (_, index) =>
    repo({ repo: `plain/repo-${String(index).padStart(2, "0")}`, stars: 60 - index, state: "core" }),
  );
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex(rows),
    shadowSkills: [],
    unresolvedCatalogPublishers: [],
    discovered: discovered(rows.map((row) => ({ repo: row.repo, sources: ["registry"], stars: row.stars }))),
    momentumByRepo: new Map(),
    seeds: seeds(),
  });

  assert.equal(preview.proposedDailyPriorityRepos.length, 50);
});

test("daily priority preview scoring prefers official over plain stars", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "official/tier1", stars: 25, state: "core" }),
      repo({ repo: "plain/big", stars: 60_000, state: "core" }),
    ]),
    shadowSkills: [],
    unresolvedCatalogPublishers: [],
    discovered: discovered([
      { repo: "official/tier1", sources: ["official"], stars: 25 },
      { repo: "plain/big", sources: ["registry"], stars: 60_000 },
    ]),
    momentumByRepo: new Map(),
    seeds: seeds({
      officialTier1Repos: new Set(["official/tier1"]),
    }),
  });

  assert.deepEqual(preview.proposedDailyPriorityRepos.slice(0, 2), ["official/tier1", "plain/big"]);
  assert.deepEqual(preview.proposedDailyPriorityScoreSample.slice(0, 2).map((row) => row.repo), ["official/tier1", "plain/big"]);
  assert.ok(preview.proposedDailyPriorityScoreSample[0]?.reasons.some((reason) => reason.startsWith("official-tier1+")));
});

test("daily priority preview scoring prefers trusted gold tier1 over weaker trusted repo", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "trusted/plain-high", stars: 70_000, state: "core", isTrustedVendor: true }),
      repo({ repo: "trusted/gold-tier1", stars: 60_000, state: "core", isTrustedVendor: true, isGoldBasketRepo: true }),
    ]),
    shadowSkills: [],
    unresolvedCatalogPublishers: [],
    discovered: discovered([
      { repo: "trusted/plain-high", sources: ["registry"], stars: 70_000 },
      { repo: "trusted/gold-tier1", sources: ["registry"], stars: 60_000 },
    ]),
    momentumByRepo: new Map(),
    seeds: seeds(),
  });

  assert.deepEqual(preview.proposedDailyPriorityRepos.slice(0, 2), [
    "trusted/gold-tier1",
    "trusted/plain-high",
  ]);
});

test("daily priority preview scoring keeps strong non-official gold tier1 repo competitive", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "gold/tier1", stars: 65_000, state: "core", isGoldBasketRepo: true }),
      repo({ repo: "plain/tier1", stars: 90_000, state: "core" }),
      repo({ repo: "plain/tier2", stars: 2_000, state: "core" }),
    ]),
    shadowSkills: [],
    unresolvedCatalogPublishers: [],
    discovered: discovered([
      { repo: "gold/tier1", sources: ["registry"], stars: 65_000 },
      { repo: "plain/tier1", sources: ["registry"], stars: 90_000 },
      { repo: "plain/tier2", sources: ["registry"], stars: 2_000 },
    ]),
    momentumByRepo: new Map(),
    seeds: seeds(),
  });

  assert.deepEqual(preview.proposedDailyPriorityRepos.slice(0, 3), [
    "gold/tier1",
    "plain/tier1",
    "plain/tier2",
  ]);
});

test("daily priority preview scoring keeps relevant trusted and multi-skill repos competitive for recall", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "plain/high", stars: 40_000, state: "core" }),
      repo({
        repo: "browser-use/browser-use",
        stars: 20_000,
        state: "core",
        skillIds: ["browser-use/browser-use:browser-use", "browser-use/browser-use:automation"],
        skillCount: 2,
      }),
      repo({
        repo: "microsoft/playwright",
        stars: 15_000,
        state: "core",
        isTrustedVendor: true,
        skillIds: ["microsoft/playwright:playwright-dev", "microsoft/playwright:testing"],
        skillCount: 2,
      }),
    ]),
    shadowSkills: [],
    unresolvedCatalogPublishers: [],
    discovered: discovered([
      { repo: "plain/high", sources: ["registry"], stars: 40_000 },
      { repo: "browser-use/browser-use", sources: ["registry"], stars: 20_000 },
      { repo: "microsoft/playwright", sources: ["registry"], stars: 15_000 },
    ]),
    momentumByRepo: new Map(),
    seeds: seeds(),
  });

  assert.deepEqual(preview.proposedDailyPriorityRepos.slice(0, 3), [
    "microsoft/playwright",
    "browser-use/browser-use",
    "plain/high",
  ]);
  assert.ok(preview.proposedDailyPriorityScoreSample[0]?.reasons.includes("trusted-vendor+20"));
  assert.ok(preview.proposedDailyPriorityScoreSample[1]?.reasons.includes("relevant-skill-repo+12"));
});

test("shortlist preview favors official and momentum repos with simple thresholds", () => {
  const preview = buildCrawl4Preview({
    repoIndex: repoIndex([
      repo({ repo: "monitored/core", stars: 1000, state: "core" }),
      repo({ repo: "trusted/vendor", stars: 260, state: "library", isTrustedVendor: true }),
      repo({ repo: "gold/basket", stars: 260, state: "library", isGoldBasketRepo: true }),
      repo({ repo: "official/seed", stars: 10, state: "library" }),
      repo({ repo: "momentum/repo", stars: 150, state: "library" }),
      repo({ repo: "periodic/high", stars: 300, state: "library" }),
      repo({ repo: "background/high", stars: 280, state: "library" }),
      repo({ repo: "background/low", stars: 120, state: "library" }),
    ]),
    shadowSkills: [
      skill({ id: "monitored/core:one", github_url: "https://github.com/monitored/core", stars: 1000 }),
      skill({ id: "trusted/vendor:one", github_url: "https://github.com/trusted/vendor", stars: 260 }),
      skill({ id: "gold/basket:one", github_url: "https://github.com/gold/basket", stars: 260 }),
      skill({ id: "official/seed:one", github_url: "https://github.com/official/seed", stars: 10 }),
      skill({ id: "momentum/repo:one", github_url: "https://github.com/momentum/repo", stars: 150 }),
      skill({ id: "periodic/high:one", github_url: "https://github.com/periodic/high", stars: 300 }),
      skill({ id: "background/high:one", github_url: "https://github.com/background/high", stars: 280 }),
      skill({ id: "background/low:one", github_url: "https://github.com/background/low", stars: 120 }),
    ],
    unresolvedCatalogPublishers: [],
    discovered: new Map([
      ["monitored/core", { repo: "monitored/core", sources: new Set(["official"]), lanes: new Set(["fast"]), stars: 1000 }],
      ["trusted/vendor", { repo: "trusted/vendor", sources: new Set(["registry"]), lanes: new Set(["periodic"]), stars: 260 }],
      ["gold/basket", { repo: "gold/basket", sources: new Set(["registry"]), lanes: new Set(["periodic"]), stars: 260 }],
      ["official/seed", { repo: "official/seed", sources: new Set(["official"]), lanes: new Set(["periodic"]), stars: 10 }],
      ["momentum/repo", { repo: "momentum/repo", sources: new Set(["skillssh"]), lanes: new Set(["periodic"]), stars: 150 }],
      ["periodic/high", { repo: "periodic/high", sources: new Set(["registry"]), lanes: new Set(["periodic"]), stars: 300 }],
      ["background/high", { repo: "background/high", sources: new Set(["social"]), lanes: new Set(["background"]), stars: 280 }],
      ["background/low", { repo: "background/low", sources: new Set(["social"]), lanes: new Set(["background"]), stars: 120 }],
    ]),
    momentumByRepo: new Map([["momentum/repo", new Set(["skillssh"])]]),
    seeds: seeds({
      officialTier2Repos: new Set(["official/seed"]),
    }),
  });

  assert.ok(preview.proposedShortlistRepos.includes("official/seed"));
  assert.ok(preview.proposedShortlistRepos.includes("momentum/repo"));
  assert.ok(preview.proposedShortlistRepos.includes("periodic/high"));
  assert.ok(preview.proposedShortlistRepos.includes("background/high"));
  assert.ok(!preview.proposedShortlistRepos.includes("background/low"));
  assert.deepEqual(preview.shortlistAdded, []);
  assert.deepEqual(preview.shortlistRemoved, ["background/low"]);
});

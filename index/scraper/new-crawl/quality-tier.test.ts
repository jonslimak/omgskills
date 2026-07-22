import test from "node:test";
import assert from "node:assert/strict";
import { applyQualityTiers, classifySkillQualityTier, summarizeQualityTiers } from "./quality-tier.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, ShadowSkillRecord, TrustedSeeds } from "./types.js";

function seeds(overrides: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    watchedCreatorHandles: new Set(),
    featuredCreatorHandles: new Set(),
    creatorAliasToCanonicalHandle: new Map(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...overrides,
  };
}

function skill(overrides: Partial<ShadowSkillRecord> = {}): ShadowSkillRecord {
  return {
    id: "owner/repo:skill",
    name: "skill",
    description: "description",
    github_url: "https://github.com/owner/repo",
    skill_md_path: "skills/skill/SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 10,
    last_updated: "2026-07-01T00:00:00Z",
    first_seen: "2026-07-01",
    publisher_handle: "owner",
    publisher_repo: "owner/repo",
    upstream_repo: "owner/repo",
    provenance_type: "original",
    author_confidence: "high",
    ...overrides,
  };
}

function repo(overrides: Partial<ShadowRepoIndexEntry> = {}): ShadowRepoIndexEntry {
  return {
    repo: "owner/repo",
    repoUrl: "https://github.com/owner/repo",
    state: "library",
    discoveredSources: ["baseline"],
    skillIds: ["owner/repo:skill"],
    skillCount: 1,
    stars: 10,
    lastSeenAt: "2026-07-01T00:00:00Z",
    lastRefreshedAt: "2026-07-01T00:00:00Z",
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: "owner/repo:skill",
    topSkillStars: 10,
    ...overrides,
  };
}

test("gold, manual, and featured original skills are curated", () => {
  const baseSkill = skill();
  assert.equal(classifySkillQualityTier({ skill: baseSkill, repo: repo(), seeds: seeds(), goldBasketSkillIds: new Set([baseSkill.id]) }), "curated");
  assert.equal(classifySkillQualityTier({ skill: baseSkill, repo: repo({ discoveredSources: ["manual-curation"] }), seeds: seeds(), goldBasketSkillIds: new Set() }), "curated");
  assert.equal(classifySkillQualityTier({ skill: baseSkill, repo: repo(), seeds: seeds({ featuredCreatorHandles: new Set(["owner"]) }), goldBasketSkillIds: new Set() }), "curated");
});

test("watched, vendor, and official original skills are creator tier", () => {
  const baseSkill = skill();
  assert.equal(classifySkillQualityTier({ skill: baseSkill, repo: repo(), seeds: seeds({ watchedCreatorHandles: new Set(["owner"]) }), goldBasketSkillIds: new Set() }), "creator");
  assert.equal(classifySkillQualityTier({ skill: baseSkill, repo: repo(), seeds: seeds({ trustedVendorHandles: new Set(["owner"]) }), goldBasketSkillIds: new Set() }), "creator");
  assert.equal(classifySkillQualityTier({ skill: baseSkill, repo: repo(), seeds: seeds({ officialTier1Repos: new Set(["owner/repo"]) }), goldBasketSkillIds: new Set() }), "creator");
});

test("creator aliases resolve case-insensitively", () => {
  const result = classifySkillQualityTier({
    skill: skill({ author_handle: "Old-Owner" }),
    repo: repo(),
    seeds: seeds({
      watchedCreatorHandles: new Set(["new-owner"]),
      creatorAliasToCanonicalHandle: new Map([["old-owner", "new-owner"]]),
    }),
    goldBasketSkillIds: new Set(),
  });
  assert.equal(result, "creator");
});

test("collection-like copies do not inherit creator trust", () => {
  const trustedSeeds = seeds({ featuredCreatorHandles: new Set(["owner"]), watchedCreatorHandles: new Set(["owner"]) });
  for (const provenance_type of ["catalog", "repackaged", "mirrored"] as const) {
    assert.equal(classifySkillQualityTier({ skill: skill({ provenance_type }), repo: repo(), seeds: trustedSeeds, goldBasketSkillIds: new Set() }), "validated");
  }
});

test("enforced precedence prevents non-original gold skills from becoming curated", () => {
  const copied = skill({ provenance_type: "repackaged" });
  assert.equal(classifySkillQualityTier({
    skill: copied,
    repo: repo({ isGoldBasketRepo: true }),
    seeds: seeds(),
    goldBasketSkillIds: new Set([copied.id]),
  }), "curated");
  assert.equal(classifySkillQualityTier({
    skill: copied,
    repo: repo({ isGoldBasketRepo: true }),
    seeds: seeds(),
    goldBasketSkillIds: new Set([copied.id]),
    enforcePolicyPrecedence: true,
  }), "validated");
});

test("known catalog repo policy overrides gold and creator trust", () => {
  const catalogSeeds = seeds({
    featuredCreatorHandles: new Set(["owner"]),
    watchedCreatorHandles: new Set(["owner"]),
    catalogRepoRules: [{ repo: "owner/repo", defaultProvenanceType: "catalog" }],
  });
  assert.equal(
    classifySkillQualityTier({
      skill: skill(),
      repo: repo({ discoveredSources: ["manual-curation"] }),
      seeds: catalogSeeds,
      goldBasketSkillIds: new Set(["owner/repo:skill"]),
    }),
    "validated",
  );
});

test("ordinary maintained skills are validated", () => {
  assert.equal(classifySkillQualityTier({ skill: skill(), repo: repo(), seeds: seeds(), goldBasketSkillIds: new Set() }), "validated");
});

test("flag off removes carried tiers and flag on tiers every skill", () => {
  const tieredSkill = skill({ quality_tier: "curated" });
  const repoIndex: ShadowRepoIndex = { generatedAt: "2026-07-01T00:00:00Z", repoCount: 1, repos: [repo()] };
  assert.equal(applyQualityTiers([tieredSkill], repoIndex, seeds(), new Set(), false)[0]?.quality_tier, undefined);
  assert.equal(applyQualityTiers([tieredSkill], repoIndex, seeds(), new Set(), true)[0]?.quality_tier, "validated");
});

test("tier samples include at most one skill per publisher repo", () => {
  const summary = summarizeQualityTiers([
    skill({ id: "owner/repo:first", quality_tier: "curated" }),
    skill({ id: "owner/repo:second", quality_tier: "curated" }),
    skill({ id: "other/repo:third", publisher_repo: "other/repo", quality_tier: "curated" }),
  ]);

  assert.equal(summary.counts.curated, 3);
  assert.deepEqual(summary.samples.curated, ["owner/repo:first", "other/repo:third"]);
});

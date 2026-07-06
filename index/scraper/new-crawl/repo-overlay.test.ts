import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShadowRepoOverlay,
  buildShadowRepoOverlay,
  shouldReadShadowRepoOverlay,
  shouldWriteShadowRepoOverlay,
} from "./repo-overlay.js";
import {
  applyShadowSkillOverlay,
  buildShadowSkillOverlay,
} from "./skill-overlay.js";
import type { ShadowCutoverSkillSignal, ShadowRepoIndex, ShadowRepoIndexEntry, ShadowRepoOverlay, ShadowSkillRecord, TrustedSeeds } from "./types.js";
import { buildCutoverShadowSkills, buildCutoverSkillSignals, buildFinalShadowSkills, buildSkillFileMissingSample, reconcileRepoIndexSkillIds, removeFilteredCatalogOnlyRepos, shouldSuppressStableCheapRetry } from "./build-shadow.js";
import { removeDoNotCrawlState } from "./do-not-crawl.js";
import { filterSuppressedSkills } from "./suppressed-skills.js";

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

function shadowSkill(overrides: Partial<ShadowSkillRecord> & Pick<ShadowSkillRecord, "id" | "github_url">): ShadowSkillRecord {
  return {
    name: "skill",
    description: "Desc",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 1,
    last_updated: "2026-05-01T00:00:00Z",
    first_seen: "2026-05-01",
    skill_md_sha: "sha",
    publisher_handle: "owner",
    publisher_repo: "owner/repo",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    ...overrides,
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

test("shouldSuppressStableCheapRetry only suppresses matching stable failures", () => {
  assert.equal(
    shouldSuppressStableCheapRetry(true, { reason: "skillFileMissing", observedRepoUpdatedAt: "2026-06-04T00:00:00Z" }, "2026-06-04T00:00:00Z"),
    true,
  );
  assert.equal(
    shouldSuppressStableCheapRetry(true, { reason: "repoMissing", observedRepoUpdatedAt: "2026-06-04T00:00:00Z" }, "2026-06-05T00:00:00Z"),
    false,
  );
  assert.equal(
    shouldSuppressStableCheapRetry(false, { reason: "repoMissing", observedRepoUpdatedAt: "2026-06-04T00:00:00Z" }, "2026-06-04T00:00:00Z"),
    false,
  );
  assert.equal(shouldSuppressStableCheapRetry(true, null, "2026-06-04T00:00:00Z"), false);
});

test("removeDoNotCrawlState removes blocked repos and owners from Crawl 4 state", () => {
  const index = repoIndex([
    repo({ repo: "blocked/repo", stars: 10 }),
    repo({ repo: "blocked-owner/repo", stars: 9 }),
    repo({ repo: "kept/repo", stars: 8 }),
  ]);
  const skills = [
    shadowSkill({ id: "blocked/repo:skill", github_url: "https://github.com/blocked/repo" }),
    shadowSkill({ id: "upstream/repo:skill", github_url: "https://github.com/blocked/repo" }),
    shadowSkill({ id: "blocked-owner/repo:skill", github_url: "https://github.com/blocked-owner/repo" }),
    shadowSkill({ id: "kept/repo:skill", github_url: "https://github.com/kept/repo" }),
  ];

  const filtered = removeDoNotCrawlState(index, skills, {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    doNotCrawlRepos: new Set(["blocked/repo"]),
    doNotCrawlOwners: new Set(["blocked-owner"]),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
  });

  assert.deepEqual(index.repos.map((entry) => entry.repo), ["kept/repo"]);
  assert.equal(index.repoCount, 1);
  assert.deepEqual(filtered.map((skill) => skill.id), ["kept/repo:skill"]);
});

test("buildSkillFileMissingSample reports current-run path failures with repo context", () => {
  const index = repoIndex([
    repo({
      repo: "owner/one",
      stars: 10,
      skillIds: ["owner/one:a", "owner/one:b"],
      skillCount: 2,
      topSkillId: "owner/one:b",
      lastObservedRepoUpdatedAt: "2026-06-04T00:00:00Z",
    }),
    repo({ repo: "owner/two", stars: 5 }),
  ]);
  const candidates = [
    { id: "owner/one:b", repo: "owner/one", reason: "skillFileMissing" as const },
    { id: "owner/two:skill", repo: "owner/two", reason: "repoMissing" as const },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `owner/extra-${i}:skill`,
      repo: `owner/extra-${i}`,
      reason: "skillFileMissing" as const,
    })),
  ];

  const sample = buildSkillFileMissingSample(candidates, index);

  assert.equal(sample.length, 10);
  assert.deepEqual(sample[0], {
    repo: "owner/one",
    failedSkillId: "owner/one:b",
    skillCount: 2,
    topSkillId: "owner/one:b",
    lastObservedRepoUpdatedAt: "2026-06-04T00:00:00Z",
  });
  assert.equal(sample.some((row) => row.repo === "owner/two"), false);
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

test("bootstrapped skill records survive with repo and skill overlays", () => {
  const baselineSkills = [shadowSkill({ id: "owner/repo:base", github_url: "https://github.com/owner/repo" })];
  const bootstrappedSkill = shadowSkill({ id: "owner/repo:bootstrapped", github_url: "https://github.com/owner/repo" });
  const currentIndex = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 10,
      skillIds: ["owner/repo:bootstrapped"],
      skillCount: 1,
      topSkillId: "owner/repo:bootstrapped",
    }),
  ]);
  const repoOverlay = buildShadowRepoOverlay(currentIndex, repoIndex([repo({ repo: "owner/repo", stars: 10 })]), "2026-05-22T02:00:00Z");
  const skillOverlay = buildShadowSkillOverlay(
    [bootstrappedSkill],
    new Set(baselineSkills.map((skill) => skill.id)),
    currentIndex,
    "2026-05-22T02:00:00Z",
  );

  const nextIndex = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  applyShadowRepoOverlay("combined", nextIndex, repoOverlay);
  const merged = applyShadowSkillOverlay("combined", baselineSkills, nextIndex, skillOverlay);
  reconcileRepoIndexSkillIds(nextIndex, merged.shadowSkills);

  assert.deepEqual(merged.shadowSkills.map((skill) => skill.id), ["owner/repo:base", "owner/repo:bootstrapped"]);
  assert.deepEqual(nextIndex.repos[0]?.skillIds, ["owner/repo:base", "owner/repo:bootstrapped"]);
});

test("final shadow skill assembly carries forward overlay-only skills", () => {
  const baselineSkill = shadowSkill({ id: "owner/repo:base", github_url: "https://github.com/owner/repo" });
  const overlaySkill = shadowSkill({ id: "owner/repo:bootstrapped", github_url: "https://github.com/owner/repo" });
  const result = buildFinalShadowSkills(
    [baselineSkill],
    new Map([
      [baselineSkill.id, baselineSkill],
      [overlaySkill.id, overlaySkill],
    ]),
    [],
  );

  assert.deepEqual(result.map((skill) => skill.id), ["owner/repo:base", "owner/repo:bootstrapped"]);
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

test("reconciliation rewrites stale overlay skill ids to current shadow skill ids", () => {
  const index = repoIndex([
    repo({
      repo: "orcaqubits/agentic-commerce-skills-plugins",
      stars: 31,
      skillIds: [
        "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
        "OrcaQubits/agentic-commerce-skills-plugins:acp-checkout-mcp",
        "OrcaQubits/agentic-commerce-skills-plugins:medusa-payments",
      ],
      skillCount: 3,
      topSkillId: "OrcaQubits/agentic-commerce-skills-plugins:medusa-payments",
      topSkillStars: 31,
    }),
  ]);

  const shadowSkills: ShadowSkillRecord[] = [
    {
      id: "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
      name: "acp-checkout-mcp",
      description: "Desc",
      github_url: "https://github.com/OrcaQubits/agentic-commerce-skills-plugins",
      skill_md_path: "acp-agentic-commerce/skills/acp-checkout-mcp/SKILL.md",
      install_cmd: "install",
      author_handle: "orcaqubits",
      tags: [],
      stars: 23,
      last_updated: "2026-05-01T00:00:00Z",
      first_seen: "2026-05-01",
      skill_md_sha: "sha-a",
      publisher_handle: "orcaqubits",
      publisher_repo: "orcaqubits/agentic-commerce-skills-plugins",
      upstream_repo: "orcaqubits/agentic-commerce-claude-plugins",
      provenance_type: "repackaged",
      author_confidence: "high",
    },
    {
      id: "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-setup",
      name: "acp-setup",
      description: "Desc",
      github_url: "https://github.com/OrcaQubits/agentic-commerce-skills-plugins",
      skill_md_path: "acp-agentic-commerce/skills/acp-setup/SKILL.md",
      install_cmd: "install",
      author_handle: "orcaqubits",
      tags: [],
      stars: 23,
      last_updated: "2026-05-01T00:00:00Z",
      first_seen: "2026-05-01",
      skill_md_sha: "sha-b",
      publisher_handle: "orcaqubits",
      publisher_repo: "orcaqubits/agentic-commerce-skills-plugins",
      upstream_repo: "orcaqubits/agentic-commerce-claude-plugins",
      provenance_type: "repackaged",
      author_confidence: "high",
    },
  ];

  reconcileRepoIndexSkillIds(index, shadowSkills);

  assert.deepEqual(index.repos[0]?.skillIds, [
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-setup",
  ]);
  assert.equal(index.repos[0]?.skillCount, 2);
  assert.equal(index.repos[0]?.topSkillId, "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp");
  assert.equal(index.repos[0]?.topSkillStars, 23);

  const signals: ShadowCutoverSkillSignal[] = buildCutoverSkillSignals(shadowSkills, index);
  assert.deepEqual(signals.map((row) => row.id), [
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-setup",
  ]);
});

test("reconciliation clears repo skill ids when no current shadow skills remain", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 10,
      skillIds: ["owner/repo:stale"],
      skillCount: 1,
      topSkillId: "owner/repo:stale",
      topSkillStars: 10,
    }),
  ]);

  reconcileRepoIndexSkillIds(index, []);

  assert.deepEqual(index.repos[0]?.skillIds, []);
  assert.equal(index.repos[0]?.skillCount, 0);
  assert.equal(index.repos[0]?.topSkillId, null);
  assert.equal(index.repos[0]?.topSkillStars, 0);
});

test("cutover skills exclude unresolved catalog-like skills but keep resolved ones", () => {
  const cutover = buildCutoverShadowSkills([
    shadowSkill({
      id: "catalog/repo:drop",
      github_url: "https://github.com/catalog/repo",
      author_handle: "",
      provenance_type: "catalog",
    }),
    shadowSkill({
      id: "repackaged/repo:drop",
      github_url: "https://github.com/repackaged/repo",
      author_handle: "",
      provenance_type: "repackaged",
    }),
    shadowSkill({
      id: "catalog/repo:keep",
      github_url: "https://github.com/catalog/repo",
      author_handle: "creator",
      provenance_type: "catalog",
    }),
  ]);

  assert.deepEqual(cutover.map((skill) => skill.id), ["catalog/repo:keep"]);
});

test("repo index removes entries whose only skills were filtered catalog-like skills", () => {
  const index = repoIndex([
    repo({
      repo: "sickn33/antigravity-awesome-skills",
      stars: 41394,
      state: "rising",
      skillIds: ["sickn33/antigravity-awesome-skills:docker-expert"],
      skillCount: 1,
      topSkillId: "sickn33/antigravity-awesome-skills:docker-expert",
    }),
    repo({
      repo: "owner/kept",
      stars: 5,
      skillIds: ["owner/kept:skill"],
      skillCount: 1,
      topSkillId: "owner/kept:skill",
    }),
  ]);
  const allSkills = [
    shadowSkill({
      id: "sickn33/antigravity-awesome-skills:docker-expert",
      github_url: "https://github.com/sickn33/antigravity-awesome-skills",
      author_handle: "",
      provenance_type: "catalog",
      publisher_repo: "sickn33/antigravity-awesome-skills",
    }),
    shadowSkill({
      id: "owner/kept:skill",
      github_url: "https://github.com/owner/kept",
    }),
  ];
  const cutover = buildCutoverShadowSkills(allSkills);

  removeFilteredCatalogOnlyRepos(index, allSkills, cutover);
  reconcileRepoIndexSkillIds(index, cutover);

  assert.deepEqual(index.repos.map((row) => row.repo), ["owner/kept"]);
  assert.equal(index.repoCount, 1);
});

test("suppressed skills are removed before repo index reconciliation", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 10,
      skillIds: ["owner/repo:keep", "owner/repo:drop"],
      skillCount: 2,
      topSkillId: "owner/repo:drop",
      topSkillStars: 10,
    }),
  ]);
  const skills = [
    shadowSkill({ id: "owner/repo:keep", github_url: "https://github.com/owner/repo" }),
    shadowSkill({ id: "owner/repo:drop", github_url: "https://github.com/owner/repo" }),
  ];
  const filtered = filterSuppressedSkills(skills, {
    suppressedSkillIds: new Set(["owner/repo:drop"]),
  } as TrustedSeeds);

  reconcileRepoIndexSkillIds(index, filtered);

  assert.deepEqual(filtered.map((skill) => skill.id), ["owner/repo:keep"]);
  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:keep"]);
  assert.equal(index.repos[0]?.skillCount, 1);
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:keep");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShadowSkillOverlay,
  buildShadowSkillOverlay,
  shouldReadShadowSkillOverlay,
  shouldWriteShadowSkillOverlay,
} from "./skill-overlay.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, ShadowSkillOverlay, ShadowSkillRecord } from "./types.js";

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "skillIds">): ShadowRepoIndexEntry {
  const { repo: repoName, skillIds, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "library",
    discoveredSources: ["baseline"],
    skillIds,
    skillCount: skillIds.length,
    stars: 1,
    lastSeenAt: "2026-06-22T00:00:00Z",
    lastRefreshedAt: "2026-06-22T00:00:00Z",
    lastCheapCheckedAt: null,
    lastObservedRepoUpdatedAt: null,
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: skillIds[0] ?? null,
    topSkillStars: 1,
    ...rest,
  };
}

function repoIndex(repos: ShadowRepoIndexEntry[]): ShadowRepoIndex {
  return {
    generatedAt: "2026-06-22T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

function skill(overrides: Partial<ShadowSkillRecord> & Pick<ShadowSkillRecord, "id" | "github_url">): ShadowSkillRecord {
  return {
    name: "skill",
    description: "desc",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 1,
    last_updated: "2026-06-22T00:00:00Z",
    first_seen: "2026-06-22",
    skill_md_sha: "sha",
    publisher_handle: "owner",
    publisher_repo: "owner/repo",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    ...overrides,
  };
}

function overlay(skills: ShadowSkillRecord[]): ShadowSkillOverlay {
  return {
    generatedAt: "2026-06-22T01:00:00Z",
    skillCount: skills.length,
    skills,
  };
}

test("skill overlay read and write cadence matches repo overlay", () => {
  assert.equal(shouldReadShadowSkillOverlay("fast"), true);
  assert.equal(shouldReadShadowSkillOverlay("combined"), true);
  assert.equal(shouldReadShadowSkillOverlay("periodic"), false);
  assert.equal(shouldReadShadowSkillOverlay("background"), false);

  assert.equal(shouldWriteShadowSkillOverlay("combined"), true);
  assert.equal(shouldWriteShadowSkillOverlay("fast"), false);
});

test("applies referenced overlay skills and ignores unreferenced ones", () => {
  const baseline = [skill({ id: "owner/repo:base", github_url: "https://github.com/owner/repo" })];
  const index = repoIndex([repo({ repo: "owner/repo", skillIds: ["owner/repo:base", "owner/repo:new"] })]);
  const result = applyShadowSkillOverlay(
    "combined",
    baseline,
    index,
    overlay([
      skill({ id: "owner/repo:new", github_url: "https://github.com/owner/repo" }),
      skill({ id: "owner/repo:orphan", github_url: "https://github.com/owner/repo" }),
    ]),
  );

  assert.equal(result.overlayLoaded, true);
  assert.equal(result.overlayEntryCount, 2);
  assert.deepEqual(result.shadowSkills.map((row) => row.id), ["owner/repo:base", "owner/repo:new"]);
});

test("baseline skill wins over duplicate overlay skill id", () => {
  const baseline = [skill({ id: "owner/repo:base", github_url: "https://github.com/owner/repo", name: "baseline" })];
  const index = repoIndex([repo({ repo: "owner/repo", skillIds: ["owner/repo:base"] })]);
  const result = applyShadowSkillOverlay(
    "combined",
    baseline,
    index,
    overlay([skill({ id: "owner/repo:base", github_url: "https://github.com/owner/repo", name: "overlay" })]),
  );

  assert.equal(result.shadowSkills[0]?.name, "baseline");
});

test("builds overlay from non-baseline maintained skills only", () => {
  const baselineSkill = skill({ id: "owner/repo:base", github_url: "https://github.com/owner/repo" });
  const newSkill = skill({ id: "owner/repo:new", github_url: "https://github.com/owner/repo" });
  const orphanSkill = skill({ id: "owner/repo:orphan", github_url: "https://github.com/owner/repo" });
  const result = buildShadowSkillOverlay(
    [baselineSkill, newSkill, orphanSkill],
    new Set([baselineSkill.id]),
    repoIndex([repo({ repo: "owner/repo", skillIds: ["owner/repo:base", "owner/repo:new"] })]),
    "2026-06-22T02:00:00Z",
  );

  assert.equal(result.skillCount, 1);
  assert.deepEqual(result.skills.map((row) => row.id), ["owner/repo:new"]);
});

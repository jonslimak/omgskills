import assert from "node:assert/strict";
import test from "node:test";
import type { ShadowRepoIndex, ShadowSkillOverlay, ShadowSkillRecord } from "./types.js";
import { removeRepoFromShadowState, upsertDoNotCrawlRepo } from "./remove-repo.js";

function skill(id: string, name = id): ShadowSkillRecord {
  return {
    id,
    name,
    description: "Useful test skill",
    github_url: `https://github.com/${id.split(":")[0]}`,
    skill_md_path: "skills/example/SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 1,
    last_updated: "2026-07-01T00:00:00Z",
    first_seen: "2026-07-01",
    publisher_handle: "owner",
    publisher_repo: id.split(":")[0] ?? "owner/repo",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
  };
}

function repoIndex(): ShadowRepoIndex {
  return {
    generatedAt: "now",
    repoCount: 2,
    repos: [
      {
        repo: "davila7/claude-code-templates",
        repoUrl: "https://github.com/davila7/claude-code-templates",
        state: "library",
        discoveredSources: ["manual-curation"],
        skillIds: ["davila7/claude-code-templates:one"],
        skillCount: 1,
        stars: 28000,
        lastSeenAt: "now",
        lastRefreshedAt: "now",
        lastCheapCheckedAt: "now",
        lastObservedRepoUpdatedAt: "now",
        trustSignals: [],
        promotionReasons: [],
        staleOrInvalidState: null,
        isTrustedVendor: false,
        isTrustedCreator: false,
        isGoldBasketRepo: false,
        topSkillId: "davila7/claude-code-templates:one",
        topSkillStars: 28000,
      },
      {
        repo: "good/repo",
        repoUrl: "https://github.com/good/repo",
        state: "library",
        discoveredSources: ["baseline"],
        skillIds: ["good/repo:two"],
        skillCount: 1,
        stars: 10,
        lastSeenAt: "now",
        lastRefreshedAt: "now",
        lastCheapCheckedAt: "now",
        lastObservedRepoUpdatedAt: "now",
        trustSignals: [],
        promotionReasons: [],
        staleOrInvalidState: null,
        isTrustedVendor: false,
        isTrustedCreator: false,
        isGoldBasketRepo: false,
        topSkillId: "good/repo:two",
        topSkillStars: 10,
      },
    ],
  };
}

test("upsertDoNotCrawlRepo normalizes and is idempotent", () => {
  const next = upsertDoNotCrawlRepo(
    { repos: [{ repo: "Davila7/Claude-Code-Templates.git", reason: "other" }], owners: [] },
    "https://github.com/davila7/claude-code-templates",
    "catalog",
  );

  assert.deepEqual(next.repos, [{ repo: "davila7/claude-code-templates", reason: "catalog" }]);
});

test("removeRepoFromShadowState removes repo skills and keeps unrelated state", () => {
  const skillOverlay: ShadowSkillOverlay = {
    generatedAt: "now",
    skillCount: 2,
    skills: [skill("davila7/claude-code-templates:one", "Remove me"), skill("good/repo:two", "Keep me")],
  };
  const state = removeRepoFromShadowState(
    {
      repoIndex: repoIndex(),
      repoOverlay: repoIndex(),
      skillOverlay,
      cutoverSkills: [...skillOverlay.skills],
      shadowSkills: [...skillOverlay.skills],
      signals: [
        { id: "davila7/claude-code-templates:one" },
        { id: "good/repo:two" },
      ],
    },
    "davila7/claude-code-templates",
  );

  assert.deepEqual(state.repoIndex.repos.map((repo) => repo.repo), ["good/repo"]);
  assert.deepEqual(state.repoOverlay.repos.map((repo) => repo.repo), ["good/repo"]);
  assert.deepEqual(state.skillOverlay.skills.map((entry) => entry.id), ["good/repo:two"]);
  assert.deepEqual(state.cutoverSkills.map((entry) => entry.id), ["good/repo:two"]);
  assert.deepEqual(state.shadowSkills.map((entry) => entry.id), ["good/repo:two"]);
  assert.deepEqual(state.signals.map((entry) => entry.id), ["good/repo:two"]);
  assert.deepEqual(state.removedSkills.map((entry) => entry.id), ["davila7/claude-code-templates:one"]);
});

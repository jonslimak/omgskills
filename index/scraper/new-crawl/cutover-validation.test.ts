import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import { validateCutoverOutputs } from "./cutover-validation.js";
import type { ShadowCutoverSkillSignal, ShadowRepoIndex, ShadowRepoIndexEntry } from "./types.js";

function skill(id: string, repo = "owner/repo"): Skill {
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url: `https://github.com/${repo}`,
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 123,
    last_updated: "2026-05-22T00:00:00Z",
    first_seen: "2026-05-22",
    skill_md_sha: "sha",
  };
}

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "stars">): ShadowRepoIndexEntry {
  const { repo: repoName, stars, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "rising",
    discoveredSources: ["baseline"],
    skillIds: [],
    skillCount: 0,
    stars,
    lastSeenAt: "2026-05-22T00:00:00Z",
    lastRefreshedAt: "2026-05-22T00:00:00Z",
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: null,
    topSkillStars: 0,
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

test("repo with valid skillIds passes validation", () => {
  const failures = validateCutoverOutputs(
    [skill("owner/repo:skill")],
    [{ id: "owner/repo:skill", isRising: true }],
    repoIndex([repo({ repo: "owner/repo", stars: 10, skillIds: ["owner/repo:skill"], skillCount: 1 })]),
  );

  assert.deepEqual(failures, []);
});

test("repo with missing skillIds entry fails with repoSkillIdMissing", () => {
  const failures = validateCutoverOutputs(
    [],
    [],
    repoIndex([repo({ repo: "owner/repo", stars: 10, skillIds: ["owner/repo:missing"], skillCount: 1 })]),
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, "repoSkillIdMissing");
  assert.equal(failures[0]?.repo, "owner/repo");
  assert.equal(failures[0]?.id, "owner/repo:missing");
});

test("duplicate cutover skill ids fail with duplicateCutoverSkillId", () => {
  const failures = validateCutoverOutputs(
    [skill("owner/repo:dup"), skill("owner/repo:dup")],
    [],
    repoIndex([]),
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, "duplicateCutoverSkillId");
  assert.equal(failures[0]?.id, "owner/repo:dup");
});

test("signal id missing from cutover skill set fails with cutoverSignalMissingSkill", () => {
  const failures = validateCutoverOutputs(
    [skill("owner/repo:skill")],
    [{ id: "owner/repo:missing", isCore: true }],
    repoIndex([]),
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, "cutoverSignalMissingSkill");
  assert.equal(failures[0]?.id, "owner/repo:missing");
});

test("empty-skill rising repo does not fail by itself", () => {
  const failures = validateCutoverOutputs(
    [],
    [],
    repoIndex([repo({ repo: "owner/repo", stars: 10, skillIds: [], skillCount: 0 })]),
  );

  assert.deepEqual(failures, []);
});

test("lum1104/understand-anything style mismatch is caught", () => {
  const failures = validateCutoverOutputs(
    [],
    [],
    repoIndex([
      repo({
        repo: "lum1104/understand-anything",
        stars: 18258,
        skillIds: ["Lum1104/Understand-Anything:understand-anything"],
        skillCount: 1,
        topSkillId: "Lum1104/Understand-Anything:understand-anything",
      }),
    ]),
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, "repoSkillIdMissing");
  assert.equal(failures[0]?.repo, "lum1104/understand-anything");
});

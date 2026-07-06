import test from "node:test";
import assert from "node:assert/strict";
import { searchCreatorWatchRepos, type CreatorWatchRepo } from "./creator-watch.js";

function repo(overrides: Partial<CreatorWatchRepo> & Pick<CreatorWatchRepo, "repo">): CreatorWatchRepo {
  return {
    repo: overrides.repo,
    repoUrl: `https://github.com/${overrides.repo}`,
    stars: overrides.stars ?? 0,
    defaultBranch: overrides.defaultBranch ?? "main",
    archived: overrides.archived,
    disabled: overrides.disabled,
    fork: overrides.fork,
  };
}

test("creator watch does nothing for an empty watchlist", async () => {
  let called = false;
  const result = await searchCreatorWatchRepos({
    watchedHandles: [],
    listReposForOwnerFn: async () => {
      called = true;
      return [];
    },
    listSkillPathsForRepoFn: async () => [],
  });

  assert.equal(called, false);
  assert.equal(result.checkedOwnerCount, 0);
  assert.equal(result.discoveredRepoCount, 0);
  assert.deepEqual(result.hits, []);
});

test("creator watch finds repos with allowed SKILL.md paths", async () => {
  const result = await searchCreatorWatchRepos({
    watchedHandles: ["Creator"],
    listReposForOwnerFn: async () => [repo({ repo: "creator/new-skill", stars: 42 })],
    listSkillPathsForRepoFn: async () => ["README.md", "skills/demo/SKILL.md"],
  });

  assert.equal(result.checkedOwnerCount, 1);
  assert.equal(result.discoveredRepoCount, 1);
  assert.equal(result.hits[0]?.repo, "creator/new-skill");
  assert.equal(result.hits[0]?.path, "skills/demo/SKILL.md");
  assert.equal(result.hits[0]?.stars, 42);
});

test("creator watch skips existing archived disabled and forked repos", async () => {
  const result = await searchCreatorWatchRepos({
    watchedHandles: ["creator"],
    existingRepos: new Set(["creator/existing"]),
    listReposForOwnerFn: async () => [
      repo({ repo: "creator/existing" }),
      repo({ repo: "creator/archived", archived: true }),
      repo({ repo: "creator/disabled", disabled: true }),
      repo({ repo: "creator/forked", fork: true }),
      repo({ repo: "creator/kept" }),
    ],
    listSkillPathsForRepoFn: async () => ["SKILL.md"],
  });

  assert.deepEqual(result.hits.map((hit) => hit.repo), ["creator/kept"]);
});

test("creator watch only accepts high-quality direct skill paths", async () => {
  const result = await searchCreatorWatchRepos({
    watchedHandles: ["creator"],
    listReposForOwnerFn: async () => [
      repo({ repo: "creator/catalog" }),
      repo({ repo: "creator/direct" }),
    ],
    listSkillPathsForRepoFn: async (item) =>
      item.repo === "creator/catalog"
        ? ["benchmarks/skills/demo/SKILL.md", "plugins/foo/skills/bar/SKILL.md"]
        : [".claude/skills/demo/SKILL.md"],
  });

  assert.deepEqual(result.hits.map((hit) => hit.repo), ["creator/direct"]);
});

test("creator watch skips repos whose tree cannot be read", async () => {
  const result = await searchCreatorWatchRepos({
    watchedHandles: ["creator"],
    listReposForOwnerFn: async () => [
      repo({ repo: "creator/bad-tree" }),
      repo({ repo: "creator/good-tree" }),
    ],
    listSkillPathsForRepoFn: async (item) => {
      if (item.repo === "creator/bad-tree") throw new Error("tree unavailable");
      return ["SKILL.md"];
    },
  });

  assert.deepEqual(result.hits.map((hit) => hit.repo), ["creator/good-tree"]);
});

test("creator watch sorts and caps owners deterministically", async () => {
  const owners: string[] = [];
  const result = await searchCreatorWatchRepos({
    watchedHandles: ["zeta", "Alpha", "alpha", "beta"],
    maxOwners: 2,
    listReposForOwnerFn: async (owner) => {
      owners.push(owner);
      return [repo({ repo: `${owner}/skill` })];
    },
    listSkillPathsForRepoFn: async () => ["SKILL.md"],
  });

  assert.deepEqual(owners, ["alpha", "beta"]);
  assert.deepEqual(result.hits.map((hit) => hit.repo), ["alpha/skill", "beta/skill"]);
});

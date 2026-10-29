import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import {
  classifySkillRefresh,
  mergeSkillRefreshState,
  parseSkillRefreshArguments,
  selectSkillRefreshBatch,
  type SkillRefreshState,
} from "./refresh-unpinned-skills.js";

const sha = (character: string) => character.repeat(40);
const checkedAt = "2026-10-28T00:00:00.000Z";

function skill(id: string, overrides: Partial<Skill> = {}): Skill {
  const repo = id.split(":")[0];
  return {
    id,
    name: "example",
    description: "Example",
    github_url: `https://github.com/${repo}`,
    install_cmd: "install",
    author_handle: repo.split("/")[0],
    tags: [],
    stars: 1,
    last_updated: "2026-09-17T00:00:00Z",
    first_seen: "2026-09-17",
    skill_md_sha: sha("a"),
    ...overrides,
  };
}

const pinned = {
  repo_slug: "a/one",
  skill_md_path: "skills/x/SKILL.md",
  repo_commit_sha: sha("b"),
  skill_tree_sha: sha("c"),
  skill_md_sha: sha("d"),
  install_target_name: "x",
};
const empty: SkillRefreshState = { version: 1, updatedAt: "", entries: [] };

test("refresh arguments need a mode and default to bounded batches", () => {
  assert.deepEqual(parseSkillRefreshArguments(["--apply"]), { mode: "apply", maxRepos: 100, maxSkills: 500, retryErrors: false });
  assert.throws(() => parseSkillRefreshArguments([]));
  assert.throws(() => parseSkillRefreshArguments(["--plan", "--max-repos=0"]));
  assert.throws(() => parseSkillRefreshArguments(["--plan", "--after-repo=a/b"]));
});

test("batches skip pinned and already-settled skills, keeping whole repos in order", () => {
  const skills = [
    skill("c/three:z"),
    skill("a/one:x", pinned),
    skill("a/one:y"),
    skill("b/two:w"),
    skill("b/two:v"),
  ];
  const state = mergeSkillRefreshState(empty, [{ id: "a/one:y", outcome: "repo-missing", checkedAt }], checkedAt);
  const batch = selectSkillRefreshBatch(skills, state, { maxRepos: 1, maxSkills: 10, retryErrors: false });
  assert.deepEqual(batch.selectedSkills.map((row) => row.id), ["b/two:v", "b/two:w"]);
  assert.equal(batch.candidateSkillCount, 3);
  assert.equal(batch.remainingSkillCount, 1);
});

test("errors are retried only on request", () => {
  const state = mergeSkillRefreshState(empty, [{ id: "a/one:y", outcome: "error", checkedAt }], checkedAt);
  const args = { maxRepos: 10, maxSkills: 10 };
  assert.equal(selectSkillRefreshBatch([skill("a/one:y")], state, { ...args, retryErrors: false }).selectedSkills.length, 0);
  assert.equal(selectSkillRefreshBatch([skill("a/one:y")], state, { ...args, retryErrors: true }).selectedSkills.length, 1);
});

test("refresh outcomes follow the crawler's failure reasons and the pin", () => {
  const before = skill("a/one:x");
  const fresh = { ...before, description: "Updated", skill_md_sha: sha("d"), skill_md_path: "skills/x/SKILL.md" };
  assert.equal(classifySkillRefresh(before, { skill: null, failure: { scope: "repo", key: "a/one", reason: "repo-404" } }, null, checkedAt).outcome, "repo-missing");
  assert.equal(classifySkillRefresh(before, { skill: null, failure: { scope: "candidate", key: before.id, reason: "skill-path-unresolved" } }, null, checkedAt).outcome, "skill-file-missing");
  assert.equal(classifySkillRefresh(before, { skill: null, failure: { scope: "candidate", key: before.id, reason: "missing-frontmatter" } }, null, checkedAt).outcome, "invalid-frontmatter");
  assert.equal(classifySkillRefresh(before, { skill: null }, null, checkedAt).outcome, "error");

  const pinnedEntry = classifySkillRefresh(before, { skill: fresh }, pinned, checkedAt);
  assert.equal(pinnedEntry.outcome, "refreshed-pinned");
  assert.equal(pinnedEntry.record?.description, "Updated");
  assert.equal(pinnedEntry.record?.repo_commit_sha, sha("b"));
  assert.equal(classifySkillRefresh(before, { skill: fresh }, null, checkedAt).outcome, "refreshed-unpinned");

  const moved = classifySkillRefresh(before, { skill: { ...fresh, github_url: "https://github.com/new-owner/one" } }, null, checkedAt);
  assert.deepEqual([moved.outcome, moved.movedTo, moved.record], ["repo-moved", "new-owner/one", undefined]);
});

test("a refresh that resolves a different folder is held for review", () => {
  const stored = skill("a/one:plugins/p/skills/call", { skill_md_path: "plugins/p/skills/call/SKILL.md" });
  const elsewhere = { ...stored, name: "deepvariant-caller", skill_md_path: "library/skills/deepvariant-caller/SKILL.md" };
  const changed = classifySkillRefresh(stored, { skill: elsewhere }, pinned, checkedAt);
  assert.deepEqual([changed.outcome, changed.resolvedPath, changed.record], ["path-changed", "library/skills/deepvariant-caller/SKILL.md", undefined]);

  const unstored = skill("a/one:update");
  assert.equal(classifySkillRefresh(unstored, { skill: { ...unstored, skill_md_path: "gsd/skills/update/SKILL.md" } }, null, checkedAt).outcome, "refreshed-unpinned");
  assert.equal(classifySkillRefresh(unstored, { skill: { ...unstored, skill_md_path: "skills/other/SKILL.md" } }, null, checkedAt).outcome, "path-changed");

  const root = skill("a/one");
  assert.equal(classifySkillRefresh(root, { skill: { ...root, skill_md_path: "skills/one/SKILL.md" } }, null, checkedAt).outcome, "refreshed-unpinned");
  assert.equal(classifySkillRefresh(root, { skill: { ...root, name: "renamed", skill_md_path: "skills/x/SKILL.md" } }, null, checkedAt).outcome, "path-changed");
});

test("later state entries replace earlier ones", () => {
  const first = mergeSkillRefreshState(empty, [{ id: "a/one:x", outcome: "error", checkedAt }], checkedAt);
  const second = mergeSkillRefreshState(first, [{ id: "a/one:x", outcome: "repo-missing", checkedAt }], checkedAt);
  assert.deepEqual(second.entries.map((entry) => entry.outcome), ["repo-missing"]);
});

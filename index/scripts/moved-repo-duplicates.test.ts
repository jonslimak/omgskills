import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../scraper/types.js";
import { planMovedRepoDuplicates } from "./moved-repo-duplicates.js";

type Fixture = Pick<Skill, "id" | "github_url" | "skill_md_path" | "skill_md_sha" | "first_seen">;
const skill = (id: string, overrides: Partial<Fixture> = {}): Fixture => ({ id, github_url: "https://github.com/new/repo",
  skill_md_sha: "a".repeat(40), first_seen: "2026-01-01", ...overrides });

test("root-level IDs without stored paths match a listed destination root", () => {
  const rows = [skill("old/repo", { skill_md_path: "SKILL.md" }), skill("new/repo")];
  const before = structuredClone(rows);
  for (const input of [rows, [...rows].reverse()]) {
    assert.deepEqual(planMovedRepoDuplicates(input, new Set(["old/repo"])), [{
      id: "old/repo", replacementId: "new/repo", from: "old/repo", to: "new/repo", sameContent: true,
    }]);
  }
  assert.deepEqual(rows, before);
});

test("nested files match by exact path, not leaf names, content alone or guessed missing paths", () => {
  const moved = skill("old/repo:review", { skill_md_path: "skills/review/SKILL.md" });
  for (const path of [undefined, "other/review/SKILL.md", "skills/Review/SKILL.md"]) {
    assert.deepEqual(planMovedRepoDuplicates([moved, skill("new/repo:review", { skill_md_path: path })],
      new Set([moved.id])), []);
  }
  assert.equal(planMovedRepoDuplicates([moved, skill("new/repo:review", { skill_md_path: moved.skill_md_path })],
    new Set([moved.id])).length, 1);
});

test("repository casing and .git normalize, while different repositories remain distinct", () => {
  const moved = skill("old/repo");
  assert.equal(planMovedRepoDuplicates([moved, skill("new/repo", { github_url: "https://github.com/New/Repo.git" })],
    new Set([moved.id])).length, 1);
  for (const github_url of ["https://github.com/other/repo", "https://example.test/new/repo"]) {
    assert.deepEqual(planMovedRepoDuplicates([moved, skill("new/repo", { github_url })], new Set([moved.id])), []);
  }
});

test("already-listed destination survives even if its content is older than the moved alias", () => {
  const rows = [skill("old/repo"), skill("new/repo", { skill_md_sha: "b".repeat(40) })];
  assert.equal(planMovedRepoDuplicates(rows, new Set(["old/repo"]))[0].sameContent, false);
  assert.deepEqual(planMovedRepoDuplicates(rows, new Set()), []);
});

test("all-moved aliases retain one stable destination ID without replacement chains", () => {
  const rows = [skill("old/repo"), skill("new/repo", { first_seen: "2026-02-01" }), skill("alias/repo")];
  const ids = new Set(rows.map(row => row.id));
  for (const input of [rows, [...rows].reverse()]) {
    const plan = planMovedRepoDuplicates(input, ids);
    assert.deepEqual(plan.map(row => row.replacementId), ["new/repo", "new/repo"]);
    const removed = new Set(plan.map(row => row.id));
    assert.deepEqual(planMovedRepoDuplicates(input.filter(row => !removed.has(row.id)), ids), []);
  }
});

test("without a destination ID all-moved aliases retain the earliest existing ID", () => {
  const rows = [skill("old/repo", { first_seen: "2026-02-01" }), skill("alias/repo")];
  assert.equal(planMovedRepoDuplicates(rows, new Set(rows.map(row => row.id)))[0].replacementId, "alias/repo");
});

import assert from "node:assert/strict";
import test from "node:test";
import { validateRemovals, type RemovalsSource } from "./editool-validation.js";

function source(ids: string[]): RemovalsSource {
  return {
    suppressedSkills: {
      skills: ids.map((id) => ({ id, reason: "duplicate", stagedAt: "2026-07-15" })),
    },
    doNotCrawl: { repos: [], owners: [] },
  };
}

test("allows an existing suppression after it has disappeared from the library", () => {
  const errors = validateRemovals(source(["owner/repo:already-suppressed"]), {
    librarySkillIds: new Set(),
    existingSuppressedSkillIds: new Set(["owner/repo:already-suppressed"]),
  });

  assert.deepEqual(errors, []);
});

test("allows a newly suppressed skill that exists in the library", () => {
  const errors = validateRemovals(source(["owner/repo:new"]), {
    librarySkillIds: new Set(["owner/repo:new"]),
    existingSuppressedSkillIds: new Set(),
  });

  assert.deepEqual(errors, []);
});

test("rejects a newly suppressed skill that does not exist in the library", () => {
  const errors = validateRemovals(source(["owner/repo:unknown"]), {
    librarySkillIds: new Set(),
    existingSuppressedSkillIds: new Set(),
  });

  assert.deepEqual(errors, ["new suppressed skill does not exist in library: owner/repo:unknown"]);
});

test("keeps repo, owner, and reason validation", () => {
  const value = source([]);
  value.doNotCrawl.repos.push({ repo: "owner/repo/extra", reason: "" });
  value.doNotCrawl.owners.push({ owner: "owner/repo", reason: "" });

  const errors = validateRemovals(value, {
    librarySkillIds: new Set(),
    existingSuppressedSkillIds: new Set(),
  });

  assert.equal(errors.length, 4);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import {
  assertExplicitPackageMetadataBatchComplete,
  buildPackageMetadataBackfillCandidates,
  parsePackageMetadataBackfillArguments,
  selectPackageMetadataBackfillBatch,
} from "./backfill-package-metadata.js";

const sha = (character: string) => character.repeat(40);

function skill(id: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id,
    name: "example",
    description: "Example",
    github_url: "https://github.com/owner/repo",
    skill_md_path: "skills/example/SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 1,
    last_updated: "2026-09-17T00:00:00Z",
    first_seen: "2026-09-17",
    skill_md_sha: sha("a"),
    ...overrides,
  };
}

test("backfill arguments default to a bounded 100 repo apply", () => {
  assert.deepEqual(parsePackageMetadataBackfillArguments(["--apply"]), {
    mode: "apply",
    maxRepos: 100,
    maxSkills: 125,
    afterRepo: null,
    skillIds: [],
    commitRefs: new Map(),
  });
});

test("backfill arguments accept exact skills and historical commit refs", () => {
  const commit = sha("b");
  const parsed = parsePackageMetadataBackfillArguments([
    "--apply",
    "--skill-id=owner/repo:nested",
    `--commit-ref=owner/repo:nested=${commit.toUpperCase()}`,
  ]);
  assert.deepEqual(parsed.skillIds, ["owner/repo:nested"]);
  assert.deepEqual(parsed.commitRefs, new Map([["owner/repo:nested", commit]]));
});

test("exact selection rejects unsafe or ambiguous operator input", () => {
  assert.throws(
    () => parsePackageMetadataBackfillArguments(["--apply", "--skill-id=owner/repo:one", "--skill-id=owner/repo:one"]),
    /Duplicate --skill-id/,
  );
  assert.throws(
    () => parsePackageMetadataBackfillArguments(["--apply", `--commit-ref=owner/repo:one=${sha("a")}`]),
    /matching --skill-id/,
  );
  assert.throws(
    () => parsePackageMetadataBackfillArguments(["--apply", "--skill-id=owner/repo:one", "--after-repo=owner/repo"]),
    /cannot be combined/,
  );
});

test("backfill candidates exclude complete pinned rows", () => {
  const pending = skill("owner/repo:pending");
  const complete = skill("owner/repo:complete", {
    repo_slug: "owner/repo",
    repo_commit_sha: sha("b"),
    skill_tree_sha: sha("c"),
    install_target_name: "complete",
  });
  const candidates = buildPackageMetadataBackfillCandidates([complete, pending]);
  assert.deepEqual([...candidates.values()].flat().map((row) => row.id), [pending.id]);
});

test("exact selection includes only requested incomplete skills", () => {
  const first = skill("owner/repo:first");
  const second = skill("owner/repo:second");
  const unrequested = skill("other/repo:third", { github_url: "https://github.com/other/repo" });
  const selection = selectPackageMetadataBackfillBatch([unrequested, second, first], {
    maxRepos: 2,
    maxSkills: 2,
    afterRepo: null,
    skillIds: [second.id, first.id],
  });
  assert.deepEqual(selection.selectedSkills.map((row) => row.id), [first.id, second.id]);
  assert.deepEqual(selection.selectedRepos, ["owner/repo"]);
});

test("exact selection rejects unknown and already-complete skills", () => {
  const complete = skill("owner/repo:complete", {
    repo_slug: "owner/repo",
    repo_commit_sha: sha("b"),
    skill_tree_sha: sha("c"),
    install_target_name: "complete",
  });
  assert.throws(
    () => selectPackageMetadataBackfillBatch([complete], {
      maxRepos: 1,
      maxSkills: 1,
      afterRepo: null,
      skillIds: ["owner/repo:missing"],
    }),
    /Unknown --skill-id/,
  );
  assert.throws(
    () => selectPackageMetadataBackfillBatch([complete], {
      maxRepos: 1,
      maxSkills: 1,
      afterRepo: null,
      skillIds: [complete.id],
    }),
    /already has complete pinned metadata/,
  );
});

test("exact batches fail atomically when any selected skill is unresolved", () => {
  assert.doesNotThrow(() => assertExplicitPackageMetadataBatchComplete([], [], [{ id: "legacy", reason: "ignored" }]));
  assert.throws(
    () => assertExplicitPackageMetadataBatchComplete(
      ["owner/repo:one", "owner/repo:two"],
      ["owner/repo:one"],
      [{ id: "owner/repo:two", reason: "blob mismatch" }],
    ),
    /failed atomically.*blob mismatch/,
  );
});

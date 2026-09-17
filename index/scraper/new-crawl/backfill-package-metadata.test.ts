import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import {
  buildPackageMetadataBackfillCandidates,
  parsePackageMetadataBackfillArguments,
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
  });
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

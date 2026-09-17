import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import {
  applyPinnedPackageMetadataOverlay,
  buildPinnedPackageMetadataOverlay,
} from "./package-metadata-overlay.js";
import type { PinnedPackageMetadataOverlay } from "./types.js";

const sha = (character: string) => character.repeat(40);

function skill(id: string): Skill {
  return {
    id,
    name: "example",
    description: "Example skill",
    github_url: "https://github.com/owner/repo",
    skill_md_path: "skills/example/SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 1,
    last_updated: "2026-09-17T00:00:00Z",
    first_seen: "2026-09-17",
    skill_md_sha: sha("a"),
  };
}

function overlay(): PinnedPackageMetadataOverlay {
  return {
    generatedAt: "2026-09-17T00:00:00Z",
    entryCount: 1,
    entries: [{
      id: "owner/repo:example",
      repo_slug: "owner/repo",
      skill_md_path: "skills/example/SKILL.md",
      repo_commit_sha: sha("b"),
      skill_tree_sha: sha("c"),
      skill_md_sha: sha("a"),
      install_target_name: "example",
    }],
  };
}

test("metadata overlay changes only package coordinates", () => {
  const original = skill("owner/repo:example");
  const result = applyPinnedPackageMetadataOverlay("combined", [original], overlay());

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skills[0]?.name, original.name);
  assert.equal(result.skills[0]?.description, original.description);
  assert.equal(result.skills[0]?.repo_commit_sha, sha("b"));
});

test("metadata overlay ignores unknown skill IDs", () => {
  const result = applyPinnedPackageMetadataOverlay("combined", [skill("owner/repo:other")], overlay());
  assert.equal(result.appliedCount, 0);
  assert.equal(result.skills[0]?.repo_slug, undefined);
});

test("generated metadata overlay includes only complete tuples and sorts by id", () => {
  const complete = {
    ...skill("owner/repo:z"),
    repo_slug: "owner/repo",
    repo_commit_sha: sha("b"),
    skill_tree_sha: sha("c"),
    install_target_name: "z",
  };
  const partial = { ...skill("owner/repo:a"), repo_slug: "owner/repo" };
  const built = buildPinnedPackageMetadataOverlay([complete, partial], "2026-09-17T00:00:00Z");

  assert.equal(built.entryCount, 1);
  assert.equal(built.entries[0]?.id, complete.id);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreatorRegistry, creatorSkillPathsForRepo, isCreatorSkillPathApproved,
  type CreatorRegistryEntry,
} from "./creator-registry.js";

function entry(overrides: Partial<CreatorRegistryEntry> = {}): CreatorRegistryEntry {
  return { handle: "creator", watch: true, skillCoverage: "selected", skillRepos: ["Creator/Skills"],
    skillPaths: ["Creator/Skills#skills/one/SKILL.md"], ...overrides };
}

test("exact coverage allows only the listed path, not new skills or sibling files", () => {
  const creator = entry();
  buildCreatorRegistry({ creators: [creator] });
  assert.equal(isCreatorSkillPathApproved(creator, "creator/skills", "skills/one/SKILL.md"), true);
  for (const path of ["SKILL.md", "skills/two/SKILL.md", "skills/one/nested/SKILL.md", "skills/One/SKILL.md"]) {
    assert.equal(isCreatorSkillPathApproved(creator, "creator/skills", path), false);
  }
  assert.equal(isCreatorSkillPathApproved(creator, "creator/other", "skills/one/SKILL.md"), false);
});

test("coverage matches repo aliases while preserving exact Git path casing", () => {
  assert.deepEqual(creatorSkillPathsForRepo(entry(), "creator/renamed", ["CREATOR/SKILLS"]), ["skills/one/SKILL.md"]);
  assert.equal(isCreatorSkillPathApproved(entry(), "creator/renamed", "skills/one/SKILL.md", ["CREATOR/SKILLS"]), true);
  assert.deepEqual(creatorSkillPathsForRepo(entry(), "creator/other"), []);
});

test("absent allowlist preserves all and selected repo coverage; exclusions still win", () => {
  assert.equal(isCreatorSkillPathApproved(entry({ skillPaths: undefined }), "creator/skills", "new/SKILL.md"), true);
  assert.equal(isCreatorSkillPathApproved(entry({ skillPaths: undefined, skillCoverage: "all", skillRepos: undefined }), "creator/other", "SKILL.md"), true);
  assert.equal(isCreatorSkillPathApproved(entry({ skillPathExclusions: ["creator/skills#skills/one/"] }), "creator/skills", "skills/one/SKILL.md"), false);
  assert.equal(isCreatorSkillPathApproved(entry({ watch: false }), "creator/skills", "skills/one/SKILL.md"), false);
});

test("registry rejects unsafe, malformed, duplicate or uncovered exact paths", () => {
  for (const value of ["creator/skills#../SKILL.md", "creator/skills#/SKILL.md", "creator/skills#skills/../SKILL.md",
    "creator/skills#skills//SKILL.md", "creator/skills#skills\\SKILL.md", "creator/skills#README.md",
    "creator/skills#skills/SKILL.md#other", "creator/skills#skills/SKILL.md?ref=main",
    "creator/other#SKILL.md", "creator/skills#skills/\u0000/SKILL.md"]) {
    assert.throws(() => buildCreatorRegistry({ creators: [entry({ skillPaths: [value] })] }));
  }
  for (const overrides of [{ skillPaths: [] }, { skillCoverage: "all" as const }, { watch: false },
    { skillPaths: ["Creator/Skills#SKILL.md", "creator/skills#SKILL.md"] }]) {
    assert.throws(() => buildCreatorRegistry({ creators: [entry(overrides)] }));
  }
});

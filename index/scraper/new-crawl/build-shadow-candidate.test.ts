import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import { buildCandidateFromSkill, deriveSkillIdFromPath, deriveSkillPathFromId } from "./candidate-path.js";

function skill(overrides: Partial<Skill> & Pick<Skill, "id" | "name" | "description" | "github_url" | "install_cmd" | "author_handle" | "tags" | "stars" | "last_updated" | "first_seen">): Skill {
  return {
    skill_md_sha: "sha",
    ...overrides,
  };
}

test("candidate builder uses stored skill_md_path when present", () => {
  const candidate = buildCandidateFromSkill(skill({
    id: "owner/repo:skill-name",
    name: "skill-name",
    description: "desc",
    github_url: "https://github.com/owner/repo",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 1,
    last_updated: "2026-06-02T00:00:00Z",
    first_seen: "2026-06-02",
    skill_md_path: "skills/skill-name/SKILL.md",
  }));

  assert.equal(candidate.skill_md_path, "skills/skill-name/SKILL.md");
});

test("deriveSkillPathFromId derives repo-relative path when id suffix is path-like", () => {
  assert.equal(
    deriveSkillPathFromId("facebook/react:.claude/skills/extract-errors"),
    ".claude/skills/extract-errors/SKILL.md",
  );
  assert.equal(
    deriveSkillPathFromId("pytorch/pytorch:.claude/skills/add-uint-support"),
    ".claude/skills/add-uint-support/SKILL.md",
  );
});

test("deriveSkillIdFromPath preserves nested paths and root IDs", () => {
  assert.equal(deriveSkillIdFromPath("owner/repo", "SKILL.md"), "owner/repo");
  assert.equal(
    deriveSkillIdFromPath("owner/repo", "skills/scientific-writing/SKILL.md"),
    "owner/repo:skills/scientific-writing",
  );
  assert.throws(() => deriveSkillIdFromPath("owner/repo", "README.md"), /Invalid SKILL\.md path/);
});

test("candidate builder uses __RESOLVE__ when path is missing and not derivable", () => {
  const candidate = buildCandidateFromSkill(skill({
    id: "fastapi/fastapi:fastapi",
    name: "fastapi",
    description: "desc",
    github_url: "https://github.com/fastapi/fastapi",
    install_cmd: "install",
    author_handle: "fastapi",
    tags: [],
    stars: 1,
    last_updated: "2026-06-02T00:00:00Z",
    first_seen: "2026-06-02",
  }));

  assert.equal(candidate.skill_md_path, "__RESOLVE__");
});

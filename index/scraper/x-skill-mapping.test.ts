import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "./types.js";
import {
  buildSkillLookup,
  extractExactSkillRefs,
  matchValidatedRepoToSkill,
  type ValidSkillRepo,
} from "./x-skill-mapping.js";

function skill(id: string, githubUrl: string, skillPath: string, name: string): Skill {
  return {
    id,
    name,
    description: "Desc",
    github_url: githubUrl,
    skill_md_path: skillPath,
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 100,
    last_updated: "2026-05-26T00:00:00Z",
    first_seen: "2026-05-26",
  };
}

function validatedRepo(githubUrl: string, skillPath: string, name: string): ValidSkillRepo {
  return {
    id: githubUrl.replace("https://github.com/", ""),
    github_url: githubUrl,
    skill_md_path: skillPath,
    name,
    description: "Desc",
    stars: 100,
  };
}

test("extracts exact blob SKILL.md refs", () => {
  const refs = extractExactSkillRefs(
    "see https://github.com/steipete/agent-scripts/blob/main/skills/skill-cleaner/SKILL.md",
  );

  assert.deepEqual(refs, [
    {
      repoId: "steipete/agent-scripts",
      githubUrl: "https://github.com/steipete/agent-scripts",
      skillPath: "skills/skill-cleaner/SKILL.md",
      sourceUrl: "https://github.com/steipete/agent-scripts/blob/main/skills/skill-cleaner/SKILL.md",
    },
  ]);
});

test("extracts exact tree SKILL.md refs", () => {
  const refs = extractExactSkillRefs(
    "see https://github.com/openai/skills/tree/main/skills/.curated/playwright-interactive/SKILL.md",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.repoId, "openai/skills");
  assert.equal(refs[0]?.skillPath, "skills/.curated/playwright-interactive/SKILL.md");
});

test("ignores LANGUAGE.md and repo-only links", () => {
  const refs = extractExactSkillRefs(
    "https://github.com/mattpocock/skills/blob/main/improve-codebase-architecture/LANGUAGE.md https://github.com/openai/skills",
  );

  assert.deepEqual(refs, []);
});

test("matches exact skill-cleaner path instead of another repo skill", () => {
  const lookup = buildSkillLookup([
    skill(
      "steipete/agent-scripts:skills/1password",
      "https://github.com/steipete/agent-scripts",
      "skills/1password/SKILL.md",
      "1password",
    ),
    skill(
      "steipete/agent-scripts:skills/skill-cleaner",
      "https://github.com/steipete/agent-scripts",
      "skills/skill-cleaner/SKILL.md",
      "skill-cleaner",
    ),
  ]);

  const matched = matchValidatedRepoToSkill(
    validatedRepo(
      "https://github.com/steipete/agent-scripts",
      "skills/skill-cleaner/SKILL.md",
      "skill-cleaner",
    ),
    lookup,
  );

  assert.equal(matched?.id, "steipete/agent-scripts:skills/skill-cleaner");
});

test("matches exact playwright-interactive path instead of pdf", () => {
  const lookup = buildSkillLookup([
    skill("openai/skills:pdf", "https://github.com/openai/skills", "skills/.curated/pdf/SKILL.md", "pdf"),
    skill(
      "openai/skills:playwright-interactive",
      "https://github.com/openai/skills",
      "skills/.curated/playwright-interactive/SKILL.md",
      "playwright-interactive",
    ),
  ]);

  const matched = matchValidatedRepoToSkill(
    validatedRepo(
      "https://github.com/openai/skills",
      "skills/.curated/playwright-interactive/SKILL.md",
      "playwright-interactive",
    ),
    lookup,
  );

  assert.equal(matched?.id, "openai/skills:playwright-interactive");
});

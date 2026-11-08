import assert from "node:assert/strict";
import test from "node:test";
import { catalogSkillsForGithubLink, GITHUB_LINK_LIMIT, parseGithubLink } from "./github-link-catalog.js";

test("a GitHub link reads as owner/repo and a folder", () => {
  assert.deepEqual(parseGithubLink("https://github.com/Anthropics/Skills"), { repo: "anthropics/skills", paths: [""] });
  assert.deepEqual(parseGithubLink("github.com/anthropics/skills.git"), { repo: "anthropics/skills", paths: [""] });
  assert.deepEqual(parseGithubLink("https://github.com/anthropics/skills/tree/main/skills/PDF/"),
    { repo: "anthropics/skills", paths: ["skills/pdf", "pdf", ""] });
  assert.deepEqual(parseGithubLink("https://github.com/anthropics/skills/blob/v2/skills/pdf/SKILL.md?plain=1#L3"),
    { repo: "anthropics/skills", paths: ["skills/pdf", "pdf", ""] });
  assert.deepEqual(parseGithubLink("https://www.github.com/a/b/tree/main/my%20skill"), { repo: "a/b", paths: ["my skill", ""] });
  assert.deepEqual(parseGithubLink("https://github.com/a/b/blob/main/SKILL.md"), { repo: "a/b", paths: [""] });
  for (const bad of ["", "https://gitlab.com/a/b", "https://github.com/a", "https://github.com/a/b/issues/3",
    "https://github.com/a/b/blob/main/README.md", "https://user:pw@github.com/a/b", "https://github.com:8443/a/b",
    "https://github.com/a/b/tree", "javascript:alert(1)"]) {
    assert.equal(parseGithubLink(bad), null, bad);
  }
});

const skill = (id: string, path: string | undefined, repo = "anthropics/skills", name = id.split(":").at(-1)) =>
  ({ id, name, description: `${name} skill`, github_url: `https://github.com/${repo}`, skill_md_path: path });
const catalog = [
  skill("anthropics/skills:pdf", "skills/pdf/SKILL.md"),
  skill("anthropics/skills:docx", "skills/docx/SKILL.md"),
  skill("anthropics/skills:xlsx-helper", "skills/xlsx/helper/SKILL.md"),
  skill("other/repo:pdf", "skills/pdf/SKILL.md", "other/repo"),
  { id: "solo/tool", name: "tool", github_url: "https://github.com/solo/tool" },
  skill("mixed/repo:root", "SKILL.md", "mixed/repo"),
  skill("mixed/repo:b", "skills/b/SKILL.md", "mixed/repo"),
  skill("mixed/repo:a", "skills/a/SKILL.md", "mixed/repo"),
  { id: "broken/x:y", name: "y", github_url: "https://github.com/broken/x" },
];

test("a folder link finds the skill in that folder", () => {
  const found = catalogSkillsForGithubLink(parseGithubLink("https://github.com/anthropics/skills/tree/main/skills/pdf")!, catalog);
  assert.deepEqual(found.skills.map(item => item.id), ["anthropics/skills:pdf"]);
  assert.equal(found.skills[0].githubUrl, "https://github.com/anthropics/skills");
});

test("a repo or parent folder link lists every skill under it, by name", () => {
  const ids = (url: string) => catalogSkillsForGithubLink(parseGithubLink(url)!, catalog).skills.map(item => item.id);
  assert.deepEqual(ids("https://github.com/anthropics/skills"), ["anthropics/skills:docx", "anthropics/skills:pdf", "anthropics/skills:xlsx-helper"]);
  assert.deepEqual(ids("https://github.com/anthropics/skills/tree/main/skills/xlsx"), ["anthropics/skills:xlsx-helper"]);
  assert.deepEqual(ids("https://github.com/anthropics/skills/tree/main/skill"), [], "folder names match whole, not as a prefix");
  assert.deepEqual(ids("https://github.com/solo/tool"), ["solo/tool"], "a repo that is one skill");
  assert.deepEqual(ids("https://github.com/broken/x"), [], "skills without a known folder are left out");
});

test("a big repo lists a capped number and says there are more", () => {
  const many = Array.from({ length: GITHUB_LINK_LIMIT + 1 }, (_, i) => skill(`big/repo:s${String(i).padStart(3, "0")}`, `s${i}/SKILL.md`, "big/repo"));
  const found = catalogSkillsForGithubLink({ repo: "big/repo", paths: [""] }, many);
  assert.equal(found.skills.length, GITHUB_LINK_LIMIT);
  assert.equal(found.more, true);
});

test("a skill at the linked folder comes first, with the skills under it after", () => {
  const ids = (url: string) => catalogSkillsForGithubLink(parseGithubLink(url)!, catalog).skills.map(item => item.id);
  assert.deepEqual(ids("https://github.com/mixed/repo"), ["mixed/repo:root", "mixed/repo:a", "mixed/repo:b"]);
  assert.deepEqual(ids("https://github.com/mixed/repo/blob/main/SKILL.md"), ["mixed/repo:root", "mixed/repo:a", "mixed/repo:b"]);
});

test("a branch name with slashes still finds the folder", () => {
  const ids = (url: string) => catalogSkillsForGithubLink(parseGithubLink(url)!, catalog).skills.map(item => item.id);
  assert.deepEqual(ids("https://github.com/anthropics/skills/tree/release/v2/skills/pdf"), ["anthropics/skills:pdf"]);
  assert.deepEqual(ids("https://github.com/anthropics/skills/tree/main/nothing/here"), [], "a folder with no skills isn't the whole repo");
});

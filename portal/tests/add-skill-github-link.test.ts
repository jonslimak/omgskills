import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addGithubSkill, findSkillsAtGithubLink, looksLikeGithubLink, previewGithubSkill } from "../src/app/my-skills-additions";
import type { PortalApi } from "../src/portal-api";

test("search offers Add skill only for GitHub links", () => {
  for (const link of ["https://github.com/anthropics/skills", "github.com/a/b/tree/main/x", " http://www.github.com/a/b "]) {
    assert.equal(looksLikeGithubLink(link), true, link);
  }
  assert.equal(looksLikeGithubLink("https://github.com/a/b/blob/main/skills/x/SKILL.md"), true);
  for (const text of ["pdf", "github", "github.com/anthropics", "https://gitlab.com/a/b", "see github.com/a/b",
    "github.com/a/b/issues/3", "https://github.com/a/b/blob/main/README.md", "https://github.com/a/b/tree/"]) {
    assert.equal(looksLikeGithubLink(text), false, text);
  }
});

test("a GitHub link asks the library which skills live there", async () => {
  let asked = "";
  const api = (async (path: string) => {
    asked = path;
    return { more: true, skills: [{ id: "anthropics/skills:pdf", name: "pdf", description: "PDFs", githubUrl: "https://github.com/anthropics/skills" },
      { id: "", name: "nameless" }] };
  }) as PortalApi;
  const found = await findSkillsAtGithubLink(api, " https://github.com/anthropics/skills/tree/main/skills ");
  assert.equal(asked, "/api/portal/catalog-search?github=https%3A%2F%2Fgithub.com%2Fanthropics%2Fskills%2Ftree%2Fmain%2Fskills");
  assert.deepEqual(found, { more: true, skills: [{ catalogId: "anthropics/skills:pdf", name: "pdf", description: "PDFs",
    author: "anthropics", githubUrl: "https://github.com/anthropics/skills" }] });
  // The server answers a failed catalog load with a warning, not an empty result.
  await assert.rejects(findSkillsAtGithubLink((async () => ({ skills: [], warning: "Catalog lookup unavailable" })) as PortalApi, "github.com/a/b"));
});

test("Add skill is on your own My skills only, beside Edit", () => {
  const source = readFileSync(new URL("../src/app/unified/UnifiedApp.tsx", import.meta.url), "utf8");
  assert.match(source, /const findByGithubLink = signedIn && \(!readOnlyAccount \|\| !!management\) \? additions\?\.findByGithubLink : undefined;/);
  assert.match(source, /\{findByGithubLink && nav\.view === "all" && !nav\.id && !editing && <button/);
  assert.match(source, /\{githubLinkSearch \? \(/);
  const dialog = readFileSync(new URL("../src/app/unified/AddSkillDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /<input autoFocus type="text"/, "a link without https:// can be submitted");
  assert.match(dialog, /found\.link\.trim\(\) === link\.trim\(\)/, "results hide once the link is edited");
});

test("a GitHub skill outside the library is previewed, then that exact version is added", async () => {
  const asked: [string, RequestInit | undefined][] = [];
  const api = (async (path: string, init?: RequestInit) => {
    asked.push([path, init]);
    return init?.method === "POST" ? { skill: { key: "notes", name: "Notes" } }
      : { repo: "o/r", commitSha: "c".repeat(40), folder: "notes", name: "Notes", description: null, skillMd: "", skillMdTruncated: false,
        labels: [], fileCount: 1, totalBytes: 10, files: [{ path: "SKILL.md", bytes: 10 }], blocker: null };
  }) as PortalApi;
  const preview = await previewGithubSkill(api, " github.com/o/r/tree/main/notes ");
  assert.equal(asked[0][0], "/api/portal/github-skill?link=github.com%2Fo%2Fr%2Ftree%2Fmain%2Fnotes");
  assert.equal(preview.link, "github.com/o/r/tree/main/notes");
  assert.deepEqual(await addGithubSkill(api, preview), { key: "notes", name: "Notes" });
  assert.deepEqual(JSON.parse(String(asked[1][1]?.body)), { link: "github.com/o/r/tree/main/notes", commitSha: "c".repeat(40), folder: "notes" });
});

test("Add skill shows why a GitHub skill can't be added", () => {
  const dialog = readFileSync(new URL("../src/app/unified/AddSkillDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /<strong>Can't add this skill\.<\/strong> \{result\.message\}/);
  assert.match(dialog, /<strong>Can't add this skill\.<\/strong> \{preview\.blocker\}/);
  assert.match(dialog, /<strong>Not added\.<\/strong> \{result\.error\}/);
});

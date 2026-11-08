import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findSkillsAtGithubLink, looksLikeGithubLink } from "../src/app/my-skills-additions";
import type { PortalApi } from "../src/portal-api";

test("search offers Add skill only for GitHub links", () => {
  for (const link of ["https://github.com/anthropics/skills", "github.com/a/b/tree/main/x", " http://www.github.com/a/b "]) {
    assert.equal(looksLikeGithubLink(link), true, link);
  }
  for (const text of ["pdf", "github", "github.com/anthropics", "https://gitlab.com/a/b", "see github.com/a/b"]) {
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
  assert.match(source, /const findByGithubLink = signedIn && !readOnlyAccount && !management \? additions\?\.findByGithubLink : undefined;/);
  assert.match(source, /\{findByGithubLink && nav\.view === "all" && !nav\.id && !editing && <button/);
  assert.match(source, /\{githubLinkSearch \? \(/);
});

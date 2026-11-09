import test from "node:test";
import assert from "node:assert/strict";
import { checkTrendingSourceAttribution, compareTrendingSourceContent, findTrendingSelfInstallRepos,
  checkReviewedTrendingContent, type TrendingAttributionDependencies } from "./trending-attribution.js";
import type { ProvenanceOverride } from "./types.js";

const body = "# Useful skill\n\nPerform the task, check the result, and report any limitations.\n";
const skill = (name = "demo", description = "Useful guidance") => `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\n---\n\n${body}`;
const install = (command: string, title = "Install this skill") => `## ${title}\n\n\`\`\`bash\n${command}\n\`\`\`\n`;
const reviewedSha = "a".repeat(40);
const reviewedRules: ProvenanceOverride[] = [{ id: "reviewed/copy:demo", upstreamRepo: "original/repo",
  provenanceType: "repackaged", reviewedSkillMdSha: reviewedSha }];

test("reviewed full-content fingerprints identify copies under a new repository name", async () => {
  const result = await checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: reviewedSha }, reviewedRules, async repo => repo);
  assert.equal(result?.status, "copy");
  assert.equal(result?.reason, "reviewed-copy-content");
  assert.equal(result?.reviewedSkillId, "reviewed/copy:demo");
  assert.equal(result?.upstreamRepo, "original/repo");
});

test("the recorded original and its verified rename remain allowed", async () => {
  const original = await checkReviewedTrendingContent({ repo: "ORIGINAL/Repo", skillMdSha: reviewedSha }, reviewedRules,
    async () => { throw new Error("canonical source needs no lookup"); });
  assert.equal(original?.status, "clear");
  const renamed = await checkReviewedTrendingContent({ repo: "new-owner/repo", skillMdSha: reviewedSha }, reviewedRules, async () => "new-owner/repo");
  assert.equal(renamed?.status, "clear");
});

test("changed or unreviewed content is not rejected, and ordinary policy rules are not fingerprints", async () => {
  const noFetch = async () => { throw new Error("must not fetch for an unmatched hash"); };
  assert.equal(await checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: "b".repeat(40) }, reviewedRules, noFetch), null);
  assert.equal(await checkReviewedTrendingContent({ repo: "new/copy" }, reviewedRules, noFetch), null);
  assert.equal(await checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: "short" }, reviewedRules, noFetch), null);
  assert.equal(await checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: reviewedSha }, [{ ...reviewedRules[0]!, reviewedSkillMdSha: undefined }], noFetch), null);
  assert.equal(await checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: reviewedSha }, [{ ...reviewedRules[0]!, provenanceType: "original" }], noFetch), null);
});

test("conflicting reviewed origins stay advisory, and network failure does not fabricate a verdict", async () => {
  const rules = [...reviewedRules, { ...reviewedRules[0]!, id: "other/copy:demo", upstreamRepo: "another/origin" }];
  assert.equal((await checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: reviewedSha }, rules, async repo => repo))?.status, "advisory");
  await assert.rejects(checkReviewedTrendingContent({ repo: "new/copy", skillMdSha: reviewedSha }, reviewedRules,
    async () => { throw new Error("upstream unavailable"); }), /unavailable/);
});

function dependencies(overrides: Partial<TrendingAttributionDependencies> = {}): TrendingAttributionDependencies {
  return { canonicalRepo: async repo => repo,
    upstreamSkill: async () => ({ content: skill(), path: "skills/demo/SKILL.md", commit: "1".repeat(40) }), ...overrides };
}

test("own install commands support selectors, versioned npx, and GitHub URLs", () => {
  for (const command of ["npx skills add original/repo --skill demo -g", "npx -y skills@latest add original/repo@demo",
    "npx skills add https://github.com/Original/Repo.git -s demo", "npx skills add original/repo --skill=demo"]) {
    assert.deepEqual(findTrendingSelfInstallRepos(install(command), null, ["demo"]), ["original/repo"]);
  }
});

test("README fallback requires an unambiguous install section; links and dependencies do not qualify", () => {
  assert.deepEqual(findTrendingSelfInstallRepos(skill(), install("npx skills add original/repo", "Installation"), ["demo"]), ["original/repo"]);
  for (const document of ["See https://github.com/original/repo", install("npx skills add original/repo", "Related skills"),
    install("npx skills add original/repo", "Examples"), install("npx skills add original/repo", "Prerequisites"),
    "npx skills add original/repo", install("npm install @original/cli"), install("npx skills add original/repo --skill dependency")]) {
    assert.deepEqual(findTrendingSelfInstallRepos(skill(), document, ["demo"]), [], document);
  }
  assert.deepEqual(findTrendingSelfInstallRepos(`${skill()}\n> Install the CLI skill: \`npx skills add belt-sh/cli\``, null, ["demo"]), []);
  assert.deepEqual(findTrendingSelfInstallRepos(`${install("npx skills add source/repo")}\n### Requirements\n\n\`\`\`bash\nnpx skills add other/dependency\n\`\`\``, null, ["demo"]), ["source/repo"]);
});

test("the skill's own install section takes priority over a generic README", () => {
  assert.deepEqual(findTrendingSelfInstallRepos(install("npx skills add own/repo --skill demo"), install("npx skills add generic/repo"), ["demo"]), ["own/repo"]);
});

test("content confirmation allows exact copies or only a frontmatter-name change, not fuzzy matching", () => {
  assert.equal(compareTrendingSourceContent(skill(), skill()), "identical-content");
  assert.equal(compareTrendingSourceContent(skill("copy-name"), skill("original-name")), "name-only-change");
  assert.equal(compareTrendingSourceContent(skill("copy-name"), skill("original-name", "Different guidance")), null);
  assert.equal(compareTrendingSourceContent(skill("copy-name") + "Additional original guidance", skill("original-name")), null);
  assert.equal(compareTrendingSourceContent(skill().replace("license: MIT", "license: Apache-2.0"), skill()), null);
  assert.equal(compareTrendingSourceContent("", ""), null);
  assert.equal(compareTrendingSourceContent("---\nname: [bad\n---\nBody", skill()), null);
});

test("missing source hints remain eligible without upstream calls", async () => {
  const result = await checkTrendingSourceAttribution({ repo: "own/repo", names: ["demo"], content: skill(), readme: null },
    dependencies({ canonicalRepo: async () => { throw new Error("should not fetch"); } }));
  assert.equal(result.status, "clear");
});

test("a real rename resolves to the same canonical repository and is not a copy", async () => {
  const result = await checkTrendingSourceAttribution({ repo: "new/repo", names: ["demo"], content: skill(), readme: install("npx skills add old/repo") },
    dependencies({ canonicalRepo: async () => "New/Repo", upstreamSkill: async () => { throw new Error("same repo must not compare content"); } }));
  assert.deepEqual(result, { status: "clear", reason: "same-canonical-repository" });
});

test("self-install consistency is not authorship proof; an ordinary upstream link alone does not block", async () => {
  const result = await checkTrendingSourceAttribution({ repo: "copy/repo", names: ["demo"],
    content: `${skill()}\n[GitHub](https://github.com/original/repo)`, readme: install("npx skills add copy/repo --skill demo") },
    dependencies({ upstreamSkill: async () => { throw new Error("do not infer origins from ordinary links"); } }));
  assert.deepEqual(result, { status: "clear", reason: "same-canonical-repository" });
});

test("matching self-install and upstream content confirms a copy even when upstream is not indexed", async () => {
  const content = skill() + install("npx skills add original/repo --skill demo");
  const result = await checkTrendingSourceAttribution({ repo: "copy/repo", names: ["demo"], content, readme: null },
    dependencies({ upstreamSkill: async () => ({ content, path: "demo/SKILL.md", commit: "1".repeat(40) }) }));
  assert.equal(result.status, "copy");
  assert.equal(result.match, "identical-content");
  assert.equal(result.upstreamRepo, "original/repo");
});

test("a name-only copy is confirmed using README evidence", async () => {
  const result = await checkTrendingSourceAttribution({ repo: "copy/repo", names: ["copy-name"], content: skill("copy-name"),
    readme: install("npx skills add original/repo") }, dependencies({ upstreamSkill: async () => ({ content: skill("original-name"), path: "SKILL.md", commit: "1".repeat(40) }) }));
  assert.equal(result.status, "copy");
  assert.equal(result.match, "name-only-change");
});

test("ambiguous and unconfirmed hints are advisory, not blanket rejections", async () => {
  const ambiguous = await checkTrendingSourceAttribution({ repo: "own/repo", names: ["demo"], content: skill(),
    readme: install("npx skills add other/a\nnpx skills add other/b") }, dependencies({ canonicalRepo: async () => { throw new Error("ambiguous hint must not fetch"); } }));
  assert.equal(ambiguous.status, "advisory");
  const changed = await checkTrendingSourceAttribution({ repo: "own/repo", names: ["demo"], content: skill() + "More original content",
    readme: install("npx skills add other/a") }, dependencies());
  assert.equal(changed.status, "advisory");
  assert.equal(changed.reason, "unconfirmed-source-hint");
});

test("missing upstream is advisory; temporary outages propagate without a fake clear result", async () => {
  const input = { repo: "own/repo", names: ["demo"], content: skill(), readme: install("npx skills add other/a") };
  assert.equal((await checkTrendingSourceAttribution(input, dependencies({ canonicalRepo: async () => { throw Object.assign(new Error("missing"), { status: 404 }); } }))).status, "advisory");
  assert.equal((await checkTrendingSourceAttribution(input, dependencies({ upstreamSkill: async () => null }))).status, "advisory");
  await assert.rejects(checkTrendingSourceAttribution(input, dependencies({ canonicalRepo: async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); } })), /unavailable/);
});

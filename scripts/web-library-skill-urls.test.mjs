import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogSkillUrlsAsset,
  buildLegacySkillUrlMap,
  buildSkillUrlMap,
  catalogSkillUrlEntries,
  legacySkillPathForId,
  legacySkillRedirectLines,
  skillPathForId,
  urlPathToFilePath,
} from "./web-library-skill-urls.mjs";

test("builds lower-case /library/ skill paths for normal and repository-root skills", () => {
  assert.equal(skillPathForId("owner/repo:skills/example"), "/library/owner/repo/skills/example/");
  assert.equal(skillPathForId("owner/repo"), "/library/owner/repo/");
  assert.equal(
    skillPathForId("AgriciDaniel/claude-seo:extensions/ahrefs/skills/seo-ahrefs"),
    "/library/agricidaniel/claude-seo/extensions/ahrefs/skills/seo-ahrefs/",
  );
  assert.equal(skillPathForId("trending/repo:skill"), null, "reserved library names have no address");
});

test("dot folders get dot-safe segments and odd characters are encoded", () => {
  assert.equal(
    skillPathForId("disler/claude-code-damage-control:.claude/skills/damage-control"),
    "/library/disler/claude-code-damage-control/dot-claude/skills/damage-control/",
  );
  assert.equal(
    skillPathForId("n8n-io/n8n:packages/@n8n/instance-ai/skills/agent-builder"),
    "/library/n8n-io/n8n/packages/%40n8n/instance-ai/skills/agent-builder/",
  );
  assert.equal(urlPathToFilePath("/library/n8n-io/n8n/packages/%40n8n/x/"), "/library/n8n-io/n8n/packages/@n8n/x/");
});

test("old /skills/ addresses are rebuilt exactly, including hash suffixes for colliding slugs", () => {
  assert.equal(legacySkillPathForId("owner/repo:.github/skills/example"), "/skills/owner/repo/dot-github/skills/example/");
  const urls = buildLegacySkillUrlMap([
    { id: "Owner/Repo:skills/Foo Bar" },
    { id: "owner/repo:skills/foo-bar" },
  ]);
  assert.match(urls.get("Owner/Repo:skills/Foo Bar"), /^\/skills\/owner\/repo\/skills\/foo-bar--[a-f0-9]{8}\/$/);
  assert.match(urls.get("owner/repo:skills/foo-bar"), /^\/skills\/owner\/repo\/skills\/foo-bar--[a-f0-9]{8}\/$/);
  assert.notEqual(urls.get("Owner/Repo:skills/Foo Bar"), urls.get("owner/repo:skills/foo-bar"));
});

test("a case twin gets no page of its own; the first in catalog order keeps the address", () => {
  const urls = buildSkillUrlMap([
    { id: "othmanadi/planning-with-files:planning-with-files" },
    { id: "OthmanAdi/planning-with-files:planning-with-files" },
    { id: "trending/repo:skill" },
  ]);
  assert.deepEqual([...urls], [
    ["othmanadi/planning-with-files:planning-with-files", "/library/othmanadi/planning-with-files/planning-with-files/"],
  ]);
});

test("redirects: exact rules only where the address changed beyond the prefix; twins go to the kept page", () => {
  const skills = [
    { id: "owner/repo:skills/plain" },
    { id: "n8n-io/n8n:packages/@n8n/x" },
    { id: "a/r:x" },
    { id: "A/r:x" },
  ];
  const lines = legacySkillRedirectLines(buildSkillUrlMap(skills), buildLegacySkillUrlMap(skills));
  assert.deepEqual(lines.slice(0, 2), [
    "/skills/n8n-io/n8n/packages/n8n/x/  /library/n8n-io/n8n/packages/%40n8n/x/  301",
    "/skills/n8n-io/n8n/packages/n8n/x/index.md  /library/n8n-io/n8n/packages/%40n8n/x/index.md  301",
  ]);
  for (const line of lines.slice(2)) assert.match(line, /^\/skills\/a\/r\/x--[a-f0-9]{8}\/(?:index\.md)?  \/library\/a\/r\/x\/(?:index\.md)?  301$/);
  assert.equal(lines.length, 6, "both case twins' old hashed pages redirect");
});

test("publishes only pages actually generated and sorts IDs", () => {
  const asset = buildCatalogSkillUrlsAsset(new Map([
    ["z/repo:skill", "/library/z/repo/skill/"],
    ["a/repo", "/library/a/repo/"],
  ]));

  assert.deepEqual(asset, {
    version: 1,
    skills: {
      "a/repo": "/library/a/repo/",
      "z/repo:skill": "/library/z/repo/skill/",
    },
  });
  assert.deepEqual(catalogSkillUrlEntries(asset), [
    ["a/repo", "/library/a/repo/"],
    ["z/repo:skill", "/library/z/repo/skill/"],
  ]);
});

test("rejects old /skills/ addresses, creator pages and capitals in published URLs", () => {
  for (const urlPath of ["/skills/a/repo/", "/library/a/", "/library/A/repo/"]) {
    assert.throws(() => catalogSkillUrlEntries({ version: 1, skills: { "a/repo": urlPath } }), /invalid entry/, urlPath);
  }
});

test("rejects malformed published URL entries", () => {
  assert.throws(
    () => catalogSkillUrlEntries({
      version: 1,
      skills: { "owner/repo": "https://example.com/skills/owner/repo/" },
    }),
    /invalid entry/,
  );
});

test("rejects published URLs containing hidden path segments", () => {
  assert.throws(
    () => catalogSkillUrlEntries({
      version: 1,
      skills: {
        "owner/repo:.claude/skills/example": "/library/owner/repo/.claude/skills/example/",
      },
    }),
    /invalid entry/,
  );
});

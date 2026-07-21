import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogSkillUrlsAsset,
  buildSkillUrlMap,
  catalogSkillUrlEntries,
  skillPathForId,
} from "./web-library-skill-urls.mjs";

test("builds normal and repository-root skill paths", () => {
  assert.equal(
    skillPathForId("owner/repo:skills/example"),
    "/skills/owner/repo/skills/example/",
  );
  assert.equal(skillPathForId("owner/repo"), "/skills/owner/repo/");
});

test("converts hidden skill path segments into public URL segments", () => {
  assert.equal(
    skillPathForId("disler/claude-code-damage-control:.claude/skills/damage-control"),
    "/skills/disler/claude-code-damage-control/dot-claude/skills/damage-control/",
  );
  assert.equal(
    skillPathForId("owner/repo:.github/skills/example"),
    "/skills/owner/repo/dot-github/skills/example/",
  );
});

test("disambiguates catalog IDs whose normalized paths collide", () => {
  const urls = buildSkillUrlMap([
    { id: "Owner/Repo:skills/Foo Bar" },
    { id: "owner/repo:skills/foo-bar" },
  ]);
  const first = urls.get("Owner/Repo:skills/Foo Bar");
  const second = urls.get("owner/repo:skills/foo-bar");

  assert.match(first, /^\/skills\/owner\/repo\/skills\/foo-bar--[a-f0-9]{8}\/$/);
  assert.match(second, /^\/skills\/owner\/repo\/skills\/foo-bar--[a-f0-9]{8}\/$/);
  assert.notEqual(first, second);
});

test("publishes only pages actually generated and sorts IDs", () => {
  const asset = buildCatalogSkillUrlsAsset(new Map([
    ["z/repo:skill", "/skills/z/repo/skill/"],
    ["a/repo", "/skills/a/repo/"],
  ]));

  assert.deepEqual(asset, {
    version: 1,
    skills: {
      "a/repo": "/skills/a/repo/",
      "z/repo:skill": "/skills/z/repo/skill/",
    },
  });
  assert.deepEqual(catalogSkillUrlEntries(asset), [
    ["a/repo", "/skills/a/repo/"],
    ["z/repo:skill", "/skills/z/repo/skill/"],
  ]);
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
        "owner/repo:.claude/skills/example": "/skills/owner/repo/.claude/skills/example/",
      },
    }),
    /invalid entry/,
  );
});

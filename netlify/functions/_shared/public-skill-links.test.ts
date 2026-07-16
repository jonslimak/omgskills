import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCatalogSkillUrlsAsset,
  resolvePublicSkillLink,
} from "./public-skill-links.js";

const paths = parseCatalogSkillUrlsAsset({
  version: 1,
  skills: {
    "owner/repo": "/skills/owner/repo/",
    "owner/repo:skills/collision": "/skills/owner/repo/skills/collision--1234abcd/",
  },
});

test("uses exact generated paths for normal, root, and collision-safe catalog IDs", () => {
  assert.deepEqual(
    resolvePublicSkillLink({ catalogSkillId: "owner/repo" }, paths),
    { kind: "skillPage", url: "/skills/owner/repo/" },
  );
  assert.deepEqual(
    resolvePublicSkillLink({ catalogSkillId: "owner/repo:skills/collision" }, paths),
    { kind: "skillPage", url: "/skills/owner/repo/skills/collision--1234abcd/" },
  );
});

test("falls back to a validated GitHub URL when no static page was generated", () => {
  assert.deepEqual(
    resolvePublicSkillLink({
      catalogSkillId: "owner/repo:unpublished",
      githubUrl: "https://github.com/owner/repo",
    }, paths),
    { kind: "github", url: "https://github.com/owner/repo" },
  );
});

test("fails closed to metadata for invalid URLs and local-only skills", () => {
  assert.deepEqual(
    resolvePublicSkillLink({ githubUrl: "https://example.com/owner/repo" }, paths),
    { kind: "metadata" },
  );
  assert.deepEqual(
    resolvePublicSkillLink({ githubUrl: "https://user@github.com/owner/repo" }, paths),
    { kind: "metadata" },
  );
  assert.deepEqual(
    resolvePublicSkillLink({
      catalogSkillId: "owner/repo",
      githubUrl: "https://github.com/owner/repo",
      isLocalOnly: true,
    }, paths),
    { kind: "metadata" },
  );
});

test("rejects malformed generated URL assets", () => {
  assert.throws(
    () => parseCatalogSkillUrlsAsset({
      version: 1,
      skills: { "owner/repo": "https://example.com/skills/owner/repo/" },
    }),
    /invalid entry/,
  );
  assert.throws(
    () => parseCatalogSkillUrlsAsset({ version: 2, skills: {} }),
    /invalid shape/,
  );
});

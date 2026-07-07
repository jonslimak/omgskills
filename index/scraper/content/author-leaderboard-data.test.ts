import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorProfiles } from "./author-leaderboard-data.js";
import type { Skill } from "../types.js";

function skill(overrides: Partial<Skill> & Pick<Skill, "id" | "author_handle">): Skill {
  const { id, author_handle: authorHandle, ...rest } = overrides;
  return {
    id,
    name: overrides.name ?? "Skill",
    description: overrides.description ?? "Description",
    github_url: overrides.github_url ?? "https://github.com/owner/repo",
    install_cmd: overrides.install_cmd ?? "install",
    author_handle: authorHandle,
    tags: overrides.tags ?? [],
    stars: overrides.stars ?? 0,
    last_updated: overrides.last_updated ?? "2026-07-07",
    first_seen: overrides.first_seen ?? "2026-07-07",
    ...rest,
  };
}

test("buildAuthorProfiles skips empty author handles", () => {
  const authors = buildAuthorProfiles(
    [
      skill({ id: "owner/repo:keep", author_handle: "owner", stars: 10 }),
      skill({ id: "unknown/repo:drop", author_handle: "", stars: 100 }),
      skill({ id: "blank/repo:drop", author_handle: "   ", stars: 100 }),
    ],
    [{ id: "owner/repo:keep", installs: 5 }],
  );

  assert.deepEqual(authors.map((author) => author.handle), ["owner"]);
  assert.equal(authors[0]?.skillCount, 1);
  assert.equal(authors[0]?.totalStars, 10);
  assert.equal(authors[0]?.totalInstalls, 5);
});

test("buildAuthorProfiles computes editorial score from deduped repo-level signals", () => {
  const authors = buildAuthorProfiles(
    [
      skill({
        id: "bulk/a:first",
        author_handle: "bulk",
        stars: 10_000,
        skill_md_sha: "same",
      }),
      skill({
        id: "bulk/b:copy",
        author_handle: "bulk",
        stars: 10_000,
        skill_md_sha: "same",
      }),
      skill({
        id: "quality/tool:main",
        author_handle: "quality",
        stars: 800,
        skill_md_sha: "quality",
      }),
    ],
    [{ id: "quality/tool:main", installs: 12_000 }],
    [{ author_handle: "quality" }],
  );

  const bulk = authors.find((author) => author.handle === "bulk");
  const quality = authors.find((author) => author.handle === "quality");

  assert.equal(bulk?.skillCount, 2);
  assert.equal(bulk?.distinctRepoCount, 1);
  assert.equal(bulk?.medianRepoStars, 10_000);
  assert.equal(quality?.goldBasketCount, 1);
  assert.equal(quality?.totalInstalls, 12_000);
  assert.ok((quality?.editorialScore ?? 0) > (bulk?.editorialScore ?? 0));
  assert.deepEqual(quality?.editorialScoreReasons, [
    "1 gold-basket skill",
    "10k+ installs",
    "500+ best repo stars",
    "100+ median repo stars",
  ]);
});

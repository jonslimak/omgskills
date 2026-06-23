import test from "node:test";
import assert from "node:assert/strict";
import { searchHighStarSkillMdRepos } from "./code.js";

test("high-star SKILL.md search dedupes repos and respects sample cap", async () => {
  const seenQueries: string[] = [];
  const metaCalls: string[] = [];

  const result = await searchHighStarSkillMdRepos({
    queries: ["q1", "q2"],
    maxPagesPerQuery: 1,
    maxSampledRepos: 2,
    requestDelayMs: 0,
    sleepFn: async () => {},
    searchCodeFn: async (query) => {
      seenQueries.push(query);
      return query === "q1"
        ? [
            { repo: "Owner/One", path: "skills/a/SKILL.md", url: "https://github.com/Owner/One/blob/main/skills/a/SKILL.md" },
            { repo: "owner/two", path: "SKILL.md", url: "https://github.com/owner/two/blob/main/SKILL.md" },
          ]
        : [
            { repo: "owner/one", path: "other/SKILL.md", url: "https://github.com/owner/one/blob/main/other/SKILL.md" },
            { repo: "owner/three", path: "SKILL.md", url: "https://github.com/owner/three/blob/main/SKILL.md" },
          ];
    },
    getRepoMetaFn: async (repo) => {
      metaCalls.push(repo);
      return { stars: repo === "owner/one" ? 1000 : 600 };
    },
  });

  assert.deepEqual(seenQueries, ["q1", "q2"]);
  assert.deepEqual(metaCalls, ["owner/one", "owner/two"]);
  assert.deepEqual(
    result.hits.map((hit) => ({ repo: hit.repo, query: hit.query, path: hit.path, stars: hit.stars })),
    [
      { repo: "owner/one", query: "q1", path: "skills/a/SKILL.md", stars: 1000 },
      { repo: "owner/two", query: "q1", path: "SKILL.md", stars: 600 },
    ],
  );
});

test("high-star SKILL.md search preserves low-star and errored rows for audit summaries", async () => {
  const result = await searchHighStarSkillMdRepos({
    minStars: 500,
    queries: ["q"],
    maxPagesPerQuery: 1,
    maxSampledRepos: 3,
    requestDelayMs: 0,
    sleepFn: async () => {},
    searchCodeFn: async () => [
      { repo: "owner/high", path: "SKILL.md", url: "https://github.com/owner/high/blob/main/SKILL.md" },
      { repo: "owner/low", path: "SKILL.md", url: "https://github.com/owner/low/blob/main/SKILL.md" },
      { repo: "owner/missing", path: "SKILL.md", url: "https://github.com/owner/missing/blob/main/SKILL.md" },
    ],
    getRepoMetaFn: async (repo) => {
      if (repo === "owner/missing") throw new Error("not found");
      return { stars: repo === "owner/high" ? 500 : 499, archived: false, disabled: false };
    },
  });

  assert.deepEqual(
    result.hits.map((hit) => ({ repo: hit.repo, stars: hit.stars, error: hit.error })),
    [
      { repo: "owner/high", stars: 500, error: undefined },
      { repo: "owner/low", stars: 499, error: undefined },
      { repo: "owner/missing", stars: null, error: "not found" },
    ],
  );
});

test("high-star SKILL.md search ignores non-canonical skill filename casing", async () => {
  const result = await searchHighStarSkillMdRepos({
    queries: ["q"],
    maxPagesPerQuery: 1,
    maxSampledRepos: 10,
    requestDelayMs: 0,
    sleepFn: async () => {},
    searchCodeFn: async () => [
      { repo: "owner/lower", path: "skills/a/skill.md", url: "https://github.com/owner/lower/blob/main/skills/a/skill.md" },
      { repo: "owner/valid", path: "skills/a/SKILL.md", url: "https://github.com/owner/valid/blob/main/skills/a/SKILL.md" },
    ],
    getRepoMetaFn: async () => ({ stars: 1000 }),
  });

  assert.deepEqual(result.hits.map((hit) => hit.repo), ["owner/valid"]);
});

test("high-star SKILL.md search reuses cached repo metadata before fetching", async () => {
  const fetchedRepos: string[] = [];

  const result = await searchHighStarSkillMdRepos({
    queries: ["q"],
    maxPagesPerQuery: 1,
    maxSampledRepos: 2,
    requestDelayMs: 0,
    sleepFn: async () => {},
    cachedRepoMetaByRepo: new Map([["owner/cached", { stars: 900 }]]),
    searchCodeFn: async () => [
      { repo: "owner/cached", path: "SKILL.md", url: "https://github.com/owner/cached/blob/main/SKILL.md" },
      { repo: "owner/live", path: "SKILL.md", url: "https://github.com/owner/live/blob/main/SKILL.md" },
    ],
    getRepoMetaFn: async (repo) => {
      fetchedRepos.push(repo);
      return { stars: 800 };
    },
  });

  assert.deepEqual(fetchedRepos, ["owner/live"]);
  assert.deepEqual(
    result.hits.map((hit) => ({ repo: hit.repo, stars: hit.stars })),
    [
      { repo: "owner/cached", stars: 900 },
      { repo: "owner/live", stars: 800 },
    ],
  );
});

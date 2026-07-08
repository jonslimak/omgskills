import test from "node:test";
import assert from "node:assert/strict";
import { searchSkillsSh } from "./skillssh.js";
import { octokit } from "../client.js";

function skill(source: string, skillId: string, installs: number) {
  return { source, skillId, name: skillId, installs };
}

test("skills.sh preserves board rank install metadata and stable source label", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/skills/hot/1")) {
      return new Response(JSON.stringify({ total: 2, page: 1, hasMore: false, skills: [
        skill("owner/one", "alpha", 30),
        skill("owner/two", "beta", 20),
      ] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  octokit.rest.repos.get = (async ({ owner, repo }: { owner: string; repo: string }) => ({
    data: {
      stargazers_count: repo === "one" ? 100 : 50,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [owner, repo],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({ board: "hot", topLimit: 2, pageConcurrency: 1, repoConcurrency: 1 });
    assert.deepEqual(hits.map((hit) => ({ id: hit.id, board: hit.board, rank: hit.trending_rank, installs: hit.installs, source: hit.trending_source })), [
      { id: "owner/one:alpha", board: "hot", rank: 1, installs: 30, source: "skills.sh" },
      { id: "owner/two:beta", board: "hot", rank: 2, installs: 20, source: "skills.sh" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

test("skills.sh all-time respects configured top limit", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/skills/all-time/1")) {
      return new Response(JSON.stringify({ total: 3, page: 1, hasMore: false, skills: [
        skill("owner/one", "alpha", 30),
        skill("owner/two", "beta", 20),
        skill("owner/three", "gamma", 10),
      ] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  octokit.rest.repos.get = (async () => ({
    data: {
      stargazers_count: 100,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({ board: "all-time", topLimit: 2, pageConcurrency: 1, repoConcurrency: 1 });
    assert.deepEqual(hits.map((hit) => hit.id), ["owner/one:alpha", "owner/two:beta"]);
    assert.deepEqual(hits.map((hit) => hit.board), ["all-time", "all-time"]);
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

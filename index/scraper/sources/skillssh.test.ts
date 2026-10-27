import test from "node:test";
import assert from "node:assert/strict";
import {
  canKeepLastGoodSkillsShData,
  fetchSkillsShInstallTotals,
  isSkillsShUnavailableError,
  searchSkillsSh,
  SkillsShUnavailableError,
} from "./skillssh.js";
import { octokit } from "../client.js";

function skill(source: string, skillId: string, installs: number) {
  return { source, skillId, name: skillId, installs };
}

for (const board of ["trending", "all-time", "hot"] as const) {
  for (const scenario of [
    { topLimit: 200, crawlAll: false, expectedCount: 200, pages: [0] },
    { topLimit: 205, crawlAll: false, expectedCount: 205, pages: [0, 1] },
    { topLimit: 1, crawlAll: true, expectedCount: 450, pages: [0, 1, 2] },
  ]) {
    test(`skills.sh ${board} reads zero-based pages for limit=${scenario.topLimit}, crawlAll=${scenario.crawlAll}`, async () => {
      const originalFetch = globalThis.fetch;
      const originalGet = octokit.rest.repos.get;
      const pages: number[] = [];
      const rows = Array.from({ length: 450 }, (_, index) =>
        skill(`pagination/${board}`, `skill-${index}`, 10_000 - index),
      );
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const match = url.pathname.match(new RegExp(`^/api/skills/${board}/(\\d+)$`));
        assert.ok(match, `unexpected fetch: ${url}`);
        const page = Number(match[1]);
        assert.ok(scenario.pages.includes(page), `unexpected page: ${page}`);
        pages.push(page);
        return Response.json({
          total: rows.length,
          page,
          hasMore: (page + 1) * 200 < rows.length,
          skills: rows.slice(page * 200, (page + 1) * 200),
        });
      }) as typeof fetch;
      octokit.rest.repos.get = (async () => ({ data: {
        full_name: `pagination/${board}`,
        stargazers_count: 100,
        pushed_at: "2026-10-27T00:00:00Z",
        topics: [],
      } })) as unknown as typeof octokit.rest.repos.get;

      try {
        const hits = await searchSkillsSh({ board, ...scenario, pageConcurrency: 2, pageRetryBaseDelayMs: 0 });
        assert.deepEqual(pages.sort((a, b) => a - b), scenario.pages);
        assert.deepEqual(hits.map(hit => hit.id), rows.slice(0, scenario.expectedCount)
          .map(row => `${row.source}:${row.skillId}`));
        assert.deepEqual(hits.map(hit => hit.trending_rank),
          Array.from({ length: scenario.expectedCount }, (_, index) => index + 1));
        if (board === "all-time" && !scenario.crawlAll) {
          pages.length = 0;
          octokit.rest.repos.get = (async () => {
            throw new Error("install totals must not call GitHub");
          }) as unknown as typeof octokit.rest.repos.get;
          const totals = await fetchSkillsShInstallTotals({ topLimit: scenario.topLimit, pageRetryBaseDelayMs: 0 });
          assert.deepEqual(pages.sort((a, b) => a - b), scenario.pages);
          assert.deepEqual([...totals], rows.slice(0, scenario.expectedCount)
            .map(row => [`${row.source}:${row.skillId}`, row.installs]));
        }
      } finally {
        globalThis.fetch = originalFetch;
        octokit.rest.repos.get = originalGet;
      }
    });
  }
}

test("skills.sh preserves board rank install metadata and stable source label", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/skills/hot/0")) {
      return new Response(JSON.stringify({ total: 2, page: 0, hasMore: false, skills: [
        skill("owner/one", "alpha", 30),
        skill("owner/two", "beta", 20),
      ] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  octokit.rest.repos.get = (async ({ owner, repo }: { owner: string; repo: string }) => ({
    data: {
      stargazers_count: repo === "one" ? 100 : 50,
      full_name: `${owner}/${repo}`,
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
    if (url.endsWith("/api/skills/all-time/0")) {
      return new Response(JSON.stringify({ total: 3, page: 0, hasMore: false, skills: [
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
      full_name: "owner/repo",
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

test("skills.sh canonicalizes redirected repos from GitHub metadata", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/skills/all-time/0")) {
      return new Response(JSON.stringify({ total: 1, page: 0, hasMore: false, skills: [
        skill("alias/repo", "alpha", 30),
      ] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  octokit.rest.repos.get = (async () => ({
    data: {
      full_name: "canonical/repo",
      stargazers_count: 100,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({ board: "all-time", topLimit: 1, pageConcurrency: 1, repoConcurrency: 1 });
    assert.deepEqual(hits.map((hit) => ({
      id: hit.id,
      github_url: hit.github_url,
      author_handle: hit.author_handle,
    })), [
      {
        id: "canonical/repo:alpha",
        github_url: "https://github.com/canonical/repo",
        author_handle: "canonical",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

test("skills.sh collapses alias and canonical rows after metadata resolution", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/skills/all-time/0")) {
      return new Response(JSON.stringify({ total: 2, page: 0, hasMore: false, skills: [
        skill("alias/repo", "alpha", 30),
        skill("canonical/repo", "alpha", 10),
      ] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  octokit.rest.repos.get = (async ({ owner, repo }: { owner: string; repo: string }) => ({
    data: {
      full_name: owner === "alias" ? "canonical/repo" : `${owner}/${repo}`,
      stargazers_count: 100,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({ board: "all-time", topLimit: 2, pageConcurrency: 1, repoConcurrency: 1 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, "canonical/repo:alpha");
    assert.equal(hits[0]?.installs, 30);
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

test("skills.sh retries temporary server errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts < 3) return new Response("temporary", { status: 500 });
    return new Response(JSON.stringify({
      total: 1,
      page: 0,
      hasMore: false,
      skills: [skill("retry/server", "alpha", 30)],
    }), { status: 200 });
  }) as typeof fetch;
  octokit.rest.repos.get = (async () => ({
    data: {
      full_name: "retry/server",
      stargazers_count: 100,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({
      board: "all-time",
      topLimit: 1,
      pageConcurrency: 1,
      repoConcurrency: 1,
      pageRetryBaseDelayMs: 0,
    });
    assert.equal(attempts, 3);
    assert.equal(hits[0]?.id, "retry/server:alpha");
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

test("skills.sh retries temporary network errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({
      total: 1,
      page: 0,
      hasMore: false,
      skills: [skill("retry/network", "alpha", 30)],
    }), { status: 200 });
  }) as typeof fetch;
  octokit.rest.repos.get = (async () => ({
    data: {
      full_name: "retry/network",
      stargazers_count: 100,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({
      board: "all-time",
      topLimit: 1,
      pageConcurrency: 1,
      repoConcurrency: 1,
      pageRetryBaseDelayMs: 0,
    });
    assert.equal(attempts, 2);
    assert.equal(hits[0]?.id, "retry/network:alpha");
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

test("skills.sh does not retry permanent client errors", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response("missing", { status: 404 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      searchSkillsSh({
        board: "all-time",
        topLimit: 1,
        pageConcurrency: 1,
        repoConcurrency: 1,
        pageRetryBaseDelayMs: 0,
      }),
      /skills\.sh page 0 failed \(404\)/,
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skills.sh bounds timed-out page requests and marks the source unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    attempts += 1;
    assert.ok(init?.signal, "skills.sh request must include a timeout signal");
    throw new DOMException("request timed out", "TimeoutError");
  }) as typeof fetch;

  try {
    await assert.rejects(
      searchSkillsSh({
        board: "all-time",
        topLimit: 1,
        pageConcurrency: 1,
        repoConcurrency: 1,
        pageRetryBaseDelayMs: 0,
        requestTimeoutMs: 1,
      }),
      (error) => isSkillsShUnavailableError(error),
    );
    assert.equal(attempts, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skills.sh availability failures can reuse only a real last-good dataset", () => {
  const unavailable = new SkillsShUnavailableError("unavailable");
  assert.equal(canKeepLastGoodSkillsShData(unavailable, 10), true);
  assert.equal(canKeepLastGoodSkillsShData(unavailable, 0), false);
  assert.equal(canKeepLastGoodSkillsShData(new Error("bad response shape"), 10), false);
});

test("skills.sh marks exhausted server retries as unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response("temporary", { status: 503 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      searchSkillsSh({
        board: "all-time",
        topLimit: 1,
        pageConcurrency: 1,
        repoConcurrency: 1,
        pageRetryBaseDelayMs: 0,
      }),
      (error) => isSkillsShUnavailableError(error),
    );
    assert.equal(attempts, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skills.sh keeps malformed successful responses fatal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;

  try {
    await assert.rejects(
      searchSkillsSh({
        board: "all-time",
        topLimit: 1,
        pageConcurrency: 1,
        repoConcurrency: 1,
        pageRetryBaseDelayMs: 0,
      }),
      (error) => !isSkillsShUnavailableError(error),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skills.sh install totals read only all-time board pages and key by lowercased id", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input); urls.push(url);
    if (url.endsWith("/api/skills/all-time/0")) {
      return new Response(JSON.stringify({ total: 4, page: 0, hasMore: false, skills: [
        skill("Owner/Repo", "Alpha", 1_200_000),
        skill("owner/repo", "alpha", 900),
        skill("other/repo", "beta", 50),
        skill("not a repo", "gamma", 10),
      ] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  octokit.rest.repos.get = (async () => { throw new Error("install totals must not call GitHub"); }) as unknown as typeof octokit.rest.repos.get;

  try {
    const totals = await fetchSkillsShInstallTotals({ topLimit: 10, pageConcurrency: 1 });
    assert.deepEqual([...totals.entries()], [["owner/repo:alpha", 1_200_000], ["other/repo:beta", 50]]);
    assert.ok(urls.every((url) => url.includes("/api/skills/all-time/")));
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

test("skills.sh install totals reuse cached canonical repo identity", async () => {
  const originalFetch = globalThis.fetch;
  const originalGet = octokit.rest.repos.get;
  let board: "trending" | "all-time" = "trending";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    total: 1,
    page: 0,
    hasMore: false,
    skills: [skill("redirect-test/old-repo", "alpha", board === "trending" ? 25 : 5_000)],
  }), { status: 200 })) as typeof fetch;
  octokit.rest.repos.get = (async () => ({
    data: {
      full_name: "redirect-test/new-repo",
      stargazers_count: 100,
      pushed_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      topics: [],
    },
  })) as unknown as typeof octokit.rest.repos.get;

  try {
    const hits = await searchSkillsSh({ board, topLimit: 1, pageConcurrency: 1, repoConcurrency: 1 });
    board = "all-time";
    const totals = await fetchSkillsShInstallTotals({ topLimit: 1, pageConcurrency: 1 });

    assert.equal(hits[0]?.id, "redirect-test/new-repo:alpha");
    assert.equal(totals.get("redirect-test/new-repo:alpha"), 5_000);
  } finally {
    globalThis.fetch = originalFetch;
    octokit.rest.repos.get = originalGet;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { verifyMcpEndpoint } from "./verify-mcp-endpoint.mjs";

const tools = ["search_skills", "get_skill", "get_skills", "list_trending", "list_gold_basket", "list_by_author",
  "related_skills", "get_install_plan", "get_skill_content"]
  .map((name) => ({
    name,
    annotations: { readOnlyHint: true, openWorldHint: name === "get_skill_content", destructiveHint: false }
  }));

function mockFetch({ badTools = false, nullAuthorRank = false, badBatch = false } = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/mcp/health") return Response.json({ ok: true, skillCount: 46_000 });
    const request = JSON.parse(options.body);
    if (request.method === "initialize") return Response.json({ jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "omgskills" } } });
    if (request.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: request.id, result: { tools: badTools ? tools.slice(1) : tools } });
    if (request.params?.name === "list_by_author" && nullAuthorRank) {
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { structuredContent: { count: 1, skills: [{ trending_rank: null }] } } });
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { structuredContent: { count: 1, skills: [{ id: badBatch && request.params?.name === "get_skills" ? "wrong" : "author/repo:skill" }] } } });
  };
}

test("verifies health, tool metadata, search, author listing, and batch lookup", async () => {
  await verifyMcpEndpoint({ origin: "https://example.test/", fetchImpl: mockFetch() });
});

test("fails when batch lookup returns a different skill", async () => {
  await assert.rejects(verifyMcpEndpoint({ origin: "https://example.test", fetchImpl: mockFetch({ badBatch: true }) }), /invalid skills/);
});

test("fails when the public tool set changes", async () => {
  await assert.rejects(
    verifyMcpEndpoint({ origin: "https://example.test", fetchImpl: mockFetch({ badTools: true }) }),
    /unexpected tool set/
  );
});

test("fails when an author listing exposes a null rank", async () => {
  await assert.rejects(
    verifyMcpEndpoint({ origin: "https://example.test", fetchImpl: mockFetch({ nullAuthorRank: true }) }),
    /invalid trending rank/
  );
});

function activeFetch({ full = false, missingCapability = false, duplicate = false, mixed = false, toolError = false } = {}) {
  const old = mockFetch();
  return async (url, options = {}) => {
    if (url.endsWith("/health")) return Response.json({ ok: true, skillCount: 46000, sourceTrack: "crawl4", catalog: { mode: full ? "full" : "compact", rankingBytes: 100 } });
    const request = JSON.parse(options.body);
    if (request.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: request.id, result: { tools: tools.map(tool => ({ ...tool,
      inputSchema: { properties: { ...(missingCapability ? {} : { page: { type: "object" } }), ...(tool.name === "search_skills" ? { ranking: { const: "web-v1" } } : {}) } },
    })) } });
    const args = request.params?.arguments;
    if (!args?.page) return old(url, options);
    const next = !!args.page.cursor;
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { ...(toolError ? { isError: true } : {}), structuredContent: {
      count: 1, skills: [{ id: next && !duplicate ? "example/second" : "example/first" }],
      page: { total: 2, hasMore: !next, nextCursor: next ? null : "next", sort: args.sort, snapshot: (next && mixed ? "b" : "a").repeat(64) },
    } } });
  };
}

test("active verification requires actual compact ranking and two pages under all six sorts", async () => {
  await verifyMcpEndpoint({ origin: "https://example.test", fetchImpl: activeFetch(), requireCatalogSearch: true });
});
test("active verification rejects full fallback, missing capabilities, mixed snapshots and duplicate results", async () => {
  for (const options of [{ full: true }, { missingCapability: true }, { duplicate: true }, { mixed: true }, { toolError: true }]) {
    await assert.rejects(verifyMcpEndpoint({ origin: "https://example.test", fetchImpl: activeFetch(options), requireCatalogSearch: true }));
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { OmgskillsLibrary } from "../../../mcp/src/library.js";
import type { McpLibraryLoader } from "./mcp-library.js";
import { config, createMcpHandler } from "../omgskills-mcp.mjs";

const loadedAt = Date.now();
const testLibrary = OmgskillsLibrary.fromData({
  skills: [{
    id: "example/skills:swift-review",
    name: "swift-review",
    description: "Review Swift code.",
    github_url: "https://github.com/example/skills",
    install_cmd: "npx skills add example/skills --skill swift-review",
    author_handle: "example",
    tags: ["swift"],
    stars: 100
  }],
  trending: [],
  goldBasket: []
});

function loader(overrides: Partial<McpLibraryLoader> = {}): McpLibraryLoader {
  return {
    get: async () => ({
      library: testLibrary,
      sourceTrack: "crawl4",
      loadedAt,
      skillCount: 1,
      trendingCount: 0,
      goldBasketCount: 0
    }),
    refresh: async () => { throw new Error("unused"); },
    pendingRefresh: () => null,
    status: () => ({ hasSnapshot: true, refreshing: false, lastRefreshFailed: false, maxAgeMs: 600_000 }),
    ...overrides
  };
}

function context() {
  const work: Promise<unknown>[] = [];
  return {
    value: { waitUntil: (promise: Promise<unknown>) => { work.push(promise); } },
    finish: () => Promise.allSettled(work)
  };
}

function rpcRequest(body: unknown) {
  return new Request("https://example.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

test("serves MCP initialization, tools, and structured results", async () => {
  const handler = createMcpHandler(loader());

  const initContext = context();
  const initialize = await handler(rpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" }
    }
  }), initContext.value);
  assert.equal(initialize.status, 200);
  assert.equal((await initialize.json()).result.serverInfo.name, "omgskills");
  await initContext.finish();

  const toolsContext = context();
  const toolsResponse = await handler(rpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), toolsContext.value);
  const tools = (await toolsResponse.json()).result.tools;
  assert.deepEqual(tools.map((tool: { name: string }) => tool.name), [
    "search_skills",
    "get_skill",
    "list_trending",
    "list_gold_basket",
    "list_by_author"
  ]);
  await toolsContext.finish();

  const callContext = context();
  const callResponse = await handler(rpcRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_skills", arguments: { query: "swift", limit: 5 } }
  }), callContext.value);
  const result = (await callResponse.json()).result;
  assert.equal(result.structuredContent.count, 1);
  assert.equal(result.structuredContent.skills[0].id, "example/skills:swift-review");
  await callContext.finish();
});

test("exposes health and rejects unsafe request shapes", async () => {
  const handler = createMcpHandler(loader());
  const healthContext = context();
  const health = await handler(new Request("https://example.test/mcp/health"), healthContext.value);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).skillCount, 1);

  assert.equal((await handler(new Request("https://example.test/mcp"), context().value)).status, 405);
  assert.equal((await handler(new Request("https://example.test/mcp", { method: "POST" }), context().value)).status, 415);
  assert.equal((await handler(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "65537" }
  }), context().value)).status, 413);
});

test("returns 503 when the catalog has never loaded", async () => {
  const unavailable = loader({ get: async () => { throw new Error("unavailable"); } });
  const handler = createMcpHandler(unavailable);
  assert.equal((await handler(rpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), context().value)).status, 503);
  assert.equal((await handler(new Request("https://example.test/mcp/health"), context().value)).status, 503);
});

test("binds only the public MCP routes with a rate limit", () => {
  assert.deepEqual(config.path, ["/mcp", "/mcp/health"]);
  assert.deepEqual(config.rateLimit, {
    windowLimit: 600,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  });
});

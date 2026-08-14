import assert from "node:assert/strict";
import test from "node:test";
import { verifyMcpEndpoint } from "./verify-mcp-endpoint.mjs";

const tools = ["search_skills", "get_skill", "list_trending", "list_gold_basket", "list_by_author"]
  .map((name) => ({
    name,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
  }));

function mockFetch({ badTools = false } = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/mcp/health") return Response.json({ ok: true, skillCount: 46_000 });
    const request = JSON.parse(options.body);
    if (request.method === "initialize") return Response.json({ jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "omgskills" } } });
    if (request.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: request.id, result: { tools: badTools ? tools.slice(1) : tools } });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { structuredContent: { count: 1, skills: [{}] } } });
  };
}

test("verifies health, tool metadata, and a structured search", async () => {
  await verifyMcpEndpoint({ origin: "https://example.test/", fetchImpl: mockFetch() });
});

test("fails when the public tool set changes", async () => {
  await assert.rejects(
    verifyMcpEndpoint({ origin: "https://example.test", fetchImpl: mockFetch({ badTools: true }) }),
    /unexpected tool set/
  );
});

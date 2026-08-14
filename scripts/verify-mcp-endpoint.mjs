#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const expectedTools = [
  "search_skills",
  "get_skill",
  "list_trending",
  "list_gold_basket",
  "list_by_author"
];

export async function verifyMcpEndpoint({
  origin = process.env.MCP_ORIGIN || process.env.PRODUCTION_ORIGIN || "https://omgskills.com",
  fetchImpl = fetch
} = {}) {
  const normalizedOrigin = origin.replace(/\/$/, "");
  const health = await fetchImpl(`${normalizedOrigin}/mcp/health`, {
    signal: AbortSignal.timeout(20_000)
  });
  if (health.status !== 200) throw new Error(`${normalizedOrigin}/mcp/health returned ${health.status}`);
  const healthBody = await health.json();
  if (healthBody?.ok !== true || !Number.isInteger(healthBody?.skillCount) || healthBody.skillCount < 1) {
    throw new Error(`${normalizedOrigin}/mcp/health returned invalid catalog status`);
  }

  const initialize = await rpc(fetchImpl, normalizedOrigin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "omgskills-deploy-verifier", version: "1.0.0" }
    }
  });
  if (initialize?.result?.serverInfo?.name !== "omgskills") {
    throw new Error(`${normalizedOrigin}/mcp returned unexpected server metadata`);
  }

  const listed = await rpc(fetchImpl, normalizedOrigin, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });
  const tools = listed?.result?.tools;
  if (!Array.isArray(tools) || tools.map((tool) => tool.name).join(",") !== expectedTools.join(",")) {
    throw new Error(`${normalizedOrigin}/mcp returned an unexpected tool set`);
  }
  for (const tool of tools) {
    if (tool.annotations?.readOnlyHint !== true || tool.annotations?.openWorldHint !== false || tool.annotations?.destructiveHint !== false) {
      throw new Error(`${normalizedOrigin}/mcp tool ${tool.name} has unsafe annotations`);
    }
  }

  const searched = await rpc(fetchImpl, normalizedOrigin, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_skills", arguments: { query: "swift", limit: 1 } }
  });
  if (!Number.isInteger(searched?.result?.structuredContent?.count) || !Array.isArray(searched?.result?.structuredContent?.skills)) {
    throw new Error(`${normalizedOrigin}/mcp search returned invalid structured content`);
  }

  console.log(`MCP verified: ${normalizedOrigin}/mcp (${healthBody.skillCount} skills)`);
}

async function rpc(fetchImpl, origin, body) {
  const response = await fetchImpl(`${origin}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  if (response.status !== 200) throw new Error(`${origin}/mcp returned ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`${origin}/mcp returned ${payload.error.message || "an RPC error"}`);
  return payload;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyMcpEndpoint().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

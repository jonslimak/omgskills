#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { loadProductionFeatures } from "./production-features.mjs";

const expectedTools = [
  "search_skills",
  "get_skill",
  "get_skills",
  "list_trending",
  "list_gold_basket",
  "list_by_author",
  "related_skills",
  "get_install_plan",
  "get_skill_content"
];
// Only get_skill_content reads beyond the catalog (SKILL.md from GitHub).
const openWorldTools = new Set(["get_skill_content"]);

export async function verifyMcpEndpoint({
  origin = process.env.MCP_ORIGIN || process.env.PRODUCTION_ORIGIN || "https://omgskills.com",
  fetchImpl = fetch,
  requireCatalogSearch = false,
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
  if (requireCatalogSearch && (healthBody.catalog?.mode !== "compact" || !(healthBody.catalog.rankingBytes > 0) || healthBody.sourceTrack !== "crawl4")) {
    throw new Error(`${normalizedOrigin}/mcp is not using the ready ranked compact catalog`);
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
    if (tool.annotations?.readOnlyHint !== true || tool.annotations?.openWorldHint !== openWorldTools.has(tool.name) || tool.annotations?.destructiveHint !== false) {
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

  const byAuthor = await rpc(fetchImpl, normalizedOrigin, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "list_by_author", arguments: { author: "anthropics", limit: 100 } }
  });
  const authorSkills = byAuthor?.result?.structuredContent?.skills;
  if (!Number.isInteger(byAuthor?.result?.structuredContent?.count) || !Array.isArray(authorSkills) || authorSkills.length < 1) {
    throw new Error(`${normalizedOrigin}/mcp author listing returned invalid structured content`);
  }
  if (authorSkills.some((skill) => skill.trending_rank !== undefined && typeof skill.trending_rank !== "number")) {
    throw new Error(`${normalizedOrigin}/mcp author listing returned an invalid trending rank`);
  }

  const id = authorSkills[0]?.id;
  if (typeof id !== "string" || !id) throw new Error(`${normalizedOrigin}/mcp author listing returned no skill ID`);
  const batch = await rpc(fetchImpl, normalizedOrigin, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "get_skills", arguments: { ids: [id] } }
  });
  const batchData = batch?.result?.structuredContent;
  if (batchData?.count !== 1 || batchData?.skills?.length !== 1 || batchData.skills[0]?.id !== id) {
    throw new Error(`${normalizedOrigin}/mcp batch lookup returned invalid skills`);
  }

  if (requireCatalogSearch) {
    for (const name of ["search_skills", "list_by_author", "list_trending"]) {
      const properties = tools.find(tool => tool.name === name)?.inputSchema?.properties;
      const ranking = properties?.ranking;
      if (properties?.page?.type !== "object" || (name === "search_skills" && ranking?.const !== "web-v1" && !(ranking?.enum?.length === 1 && ranking.enum[0] === "web-v1"))) {
        throw new Error(`${normalizedOrigin}/mcp is missing the advertised search upgrade`);
      }
    }
    const page = async (sort, cursor) => {
      const data = await rpc(fetchImpl, normalizedOrigin, { jsonrpc: "2.0", id: 6, method: "tools/call", params: {
        name: "search_skills", arguments: { query: "design", ranking: "web-v1", sort, limit: 1, page: cursor ? { cursor } : {} },
      } });
      const value = data?.result?.structuredContent;
      if (data?.result?.isError || value?.count !== value?.skills?.length || !Array.isArray(value?.skills) || value.skills.length > 1
        || !Number.isSafeInteger(value?.page?.total) || value.page.total < value.skills.length || value.page.sort !== sort
        || typeof value.page.hasMore !== "boolean" || !/^[a-f0-9]{64}$/.test(value.page.snapshot)
        || value.page.hasMore !== (typeof value.page.nextCursor === "string")
        || (value.page.nextCursor !== null && !/^[A-Za-z0-9_-]{1,1024}$/.test(value.page.nextCursor))) {
        throw new Error(`${normalizedOrigin}/mcp returned invalid ranked paging`);
      }
      return value;
    };
    for (const sort of ["relevance", "trending", "stars", "updated", "added", "name"]) {
      const first = await page(sort);
      if (!first.page.hasMore || first.skills.length !== 1) throw new Error("Ranked search did not provide a second page");
      const next = await page(sort, first.page.nextCursor);
      if (next.page.snapshot !== first.page.snapshot || next.page.total !== first.page.total || next.skills.length !== 1
        || next.skills[0].id === first.skills[0].id || (next.page.nextCursor !== null && next.page.nextCursor === first.page.nextCursor)) {
        throw new Error(`${normalizedOrigin}/mcp returned an inconsistent ranked page chain`);
      }
    }
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
  loadProductionFeatures().then(features => verifyMcpEndpoint({ requireCatalogSearch: features.catalogSearchEnabled })).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

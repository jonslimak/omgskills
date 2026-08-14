import assert from "node:assert/strict";
import test from "node:test";
import { verifyProductionDeploy } from "./verify-production-deploy.mjs";

const origin = "https://example.test";
const appcast = '<enclosure url="https://omgskills.com/updates/omgskills-1.0.0.zip"/>';

function responseFor(path, options = {}) {
  if (path === "/download") {
    return new Response(null, {
      status: 302,
      headers: { location: "/downloads/omgskills-mac.dmg" },
    });
  }
  if (path === "/appcast.xml") return new Response(appcast, { status: 200 });
  if (path.startsWith("/data/")) {
    return Response.json({ skills: { path: "skills.json" } });
  }
  if (path === "/api/portal/sync-upload" && options.method === "POST") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (path === "/mcp/health") {
    return Response.json({ ok: true, skillCount: 46_000 });
  }
  if (path === "/mcp" && options.method === "POST") {
    const request = JSON.parse(options.body);
    if (request.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { serverInfo: { name: "omgskills" } } });
    }
    if (request.method === "tools/list") {
      const annotations = { readOnlyHint: true, openWorldHint: false, destructiveHint: false };
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: ["search_skills", "get_skill", "list_trending", "list_gold_basket", "list_by_author"]
            .map((name) => ({ name, annotations }))
        }
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: { structuredContent: { count: 1, skills: [{}] } }
    });
  }
  return new Response(null, { status: 200 });
}

test("verifies the complete production deploy surface", async () => {
  const requests = [];
  await verifyProductionDeploy({
    origin,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push({ path, method: options.method || "GET" });
      return responseFor(path, options);
    },
  });

  assert.deepEqual(requests, [
    { path: "/app/", method: "GET" },
    { path: "/support/", method: "GET" },
    { path: "/api/portal/sync-upload", method: "POST" },
    { path: "/data/manifest.json", method: "GET" },
    { path: "/data/v2/manifest.json", method: "GET" },
    { path: "/data/crawl4/manifest.json", method: "GET" },
    { path: "/download", method: "GET" },
    { path: "/appcast.xml", method: "GET" },
    { path: "/downloads/omgskills-mac.dmg", method: "HEAD" },
    { path: "/downloads/omgskills-mac.dmg.sha256", method: "HEAD" },
    { path: "/updates/omgskills-1.0.0.zip", method: "HEAD" },
    { path: "/mcp/health", method: "GET" },
    { path: "/mcp", method: "POST" },
    { path: "/mcp", method: "POST" },
    { path: "/mcp", method: "POST" },
    { path: "/mcp", method: "POST" },
  ]);
});

test("fails when a required release asset is missing", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        if (path === "/downloads/omgskills-mac.dmg") {
          return new Response(null, { status: 404 });
        }
        return responseFor(path, options);
      },
    }),
    /downloads\/omgskills-mac\.dmg returned 404, expected 200/,
  );
});

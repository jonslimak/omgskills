import assert from "node:assert/strict";
import test from "node:test";
import { verifyProductionDeploy } from "./verify-production-deploy.mjs";

const origin = "https://example.test";
const appcast = '<enclosure url="https://omgskills.com/updates/omgskills-1.0.0.zip"/>';
const disabledFeatures = { skillGroupsAuthEnabled: false };

function responseFor(path, options = {}, features = disabledFeatures) {
  if (path === "/app/release-config.json") {
    return Response.json({ version: 1, ...features });
  }
  if (path === "/download") {
    return new Response(null, {
      status: 302,
      headers: { location: "/downloads/omgskills-mac.dmg" },
    });
  }
  if (path === "/appcast.xml") return new Response(appcast, { status: 200 });
  if (path === "/health/" || path === "/data/health.json") {
    return new Response("Authentication required", { status: 401 });
  }
  if (path.startsWith("/data/")) {
    return Response.json({ skills: { path: "skills.json" } });
  }
  if (path === "/api/portal/sync-upload" && options.method === "POST") {
    return Response.json(
      { error: features.skillGroupsAuthEnabled ? "Unauthorized" : "Skill Groups are temporarily unavailable" },
      { status: features.skillGroupsAuthEnabled ? 401 : 503 },
    );
  }
  if (path === "/api/public/groups/jonslimak/my-faves/manifest") {
    return Response.json({
      type: "omgskills.skill_group",
      version: 2,
      group: { id: "group-id", name: "My Faves", slug: "my-faves", revision: 1 },
      items: [],
    });
  }
  if (path === "/mcp/health") {
    return Response.json({ ok: true, skillCount: 46_000 });
  }
  if (path === "/.well-known/ai-catalog.json") {
    return Response.json(
      {
        specVersion: "1.0",
        entries: [
          {
            identifier: "urn:air:omgskills.com:mcp:catalog",
            data: { endpoint: `${origin}/mcp` },
          },
        ],
      },
      { headers: { "Access-Control-Allow-Origin": "*" } },
    );
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
    expectedFeatures: disabledFeatures,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push({ path, method: options.method || "GET" });
      return responseFor(path, options);
    },
  });

  assert.deepEqual(requests, [
    { path: "/app/", method: "GET" },
    { path: "/app/release-config.json", method: "GET" },
    { path: "/about/", method: "GET" },
    { path: "/support/", method: "GET" },
    { path: "/health/", method: "GET" },
    { path: "/data/health.json", method: "GET" },
    { path: "/banner.webp", method: "HEAD" },
    { path: "/api/portal/sync-upload", method: "POST" },
    { path: "/u/jonslimak/sets/my-faves", method: "GET" },
    { path: "/api/public/groups/jonslimak/my-faves/manifest", method: "GET" },
    { path: "/data/manifest.json", method: "GET" },
    { path: "/data/v2/manifest.json", method: "GET" },
    { path: "/data/crawl4/manifest.json", method: "GET" },
    { path: "/download", method: "GET" },
    { path: "/appcast.xml", method: "GET" },
    { path: "/downloads/omgskills-mac.dmg", method: "HEAD" },
    { path: "/downloads/omgskills-mac.dmg.sha256", method: "HEAD" },
    { path: "/updates/omgskills-1.0.0.zip", method: "HEAD" },
    { path: "/.well-known/ai-catalog.json", method: "GET" },
    { path: "/mcp/health", method: "GET" },
    { path: "/mcp", method: "POST" },
    { path: "/mcp", method: "POST" },
    { path: "/mcp", method: "POST" },
    { path: "/mcp", method: "POST" },
  ]);
});

test("rollback verification skips candidate-only public group checks", async () => {
  const requests = [];
  await verifyProductionDeploy({
    origin,
    expectedFeatures: disabledFeatures,
    verifyCandidateFeatures: false,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push(path);
      return responseFor(path, options);
    },
  });

  assert.equal(requests.some((path) => path.includes("/my-faves")), false);
});

test("fails when a required release asset is missing", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: disabledFeatures,
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

test("accepts an enabled reviewed production feature state", async () => {
  const enabledFeatures = { skillGroupsAuthEnabled: true };
  await verifyProductionDeploy({
    origin,
    expectedFeatures: enabledFeatures,
    fetchImpl: async (url, options) => (
      responseFor(new URL(url).pathname, options, enabledFeatures)
    ),
  });
});

test("fails when the private portal does not honor the reviewed kill-switch state", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: disabledFeatures,
      fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        if (path === "/api/portal/sync-upload") {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        return responseFor(path, options);
      },
    }),
    /sync-upload returned 401, expected 503/,
  );
});

test("fails when the public group manifest read path is unhealthy", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: disabledFeatures,
      fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        if (path === "/api/public/groups/jonslimak/my-faves/manifest") {
          return Response.json({ error: "Manifest failed" }, { status: 500 });
        }
        return responseFor(path, options);
      },
    }),
    /public\/groups\/jonslimak\/my-faves\/manifest returned 500, expected 200/,
  );
});

test("fails when the deployed feature receipt does not match the reviewed state", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: { skillGroupsAuthEnabled: true },
      fetchImpl: async (url, options) => responseFor(new URL(url).pathname, options),
    }),
    /does not match the reviewed production feature state/,
  );
});

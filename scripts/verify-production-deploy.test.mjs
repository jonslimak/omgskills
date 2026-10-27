import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyProductionDeploy } from "./verify-production-deploy.mjs";

const origin = "https://example.test";
const appcast = '<enclosure url="https://omgskills.com/updates/omgskills-1.0.0.zip"/>';
const disabledFeatures = { skillGroupsWebEnabled: false, skillGroupsAuthEnabled: false };
const disabledHelper = { version: 1, enabled: false, assets: [] };

function responseFor(path, options = {}, features = disabledFeatures) {
  if (path === "/app/release-config.json") {
    return Response.json({ version: 1, skillGroupsAuthEnabled: features.skillGroupsAuthEnabled });
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
      { error: features.skillGroupsWebEnabled ? "Unauthorized" : "Skill Groups are temporarily unavailable" },
      { status: features.skillGroupsWebEnabled ? 401 : 503 },
    );
  }
  if (path.endsWith("/package") && path.startsWith("/api/portal/private-releases/")) {
    return new Response("Skill Groups are temporarily unavailable", { status: 503 });
  }
  if (path === "/u/jonslimak") {
    return new Response("<h1>jon slim</h1><p>@jonslimak</p>");
  }
  if (path === "/u/jonslimak/sets/health-check-missing") {
    return new Response("<h1>Not found</h1>", { status: 404 });
  }
  if (path === "/api/public/groups/jonslimak/health-check-missing/manifest") {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }
  if (path === "/mcp/health") {
    return Response.json({ ok: true, skillCount: 46_000, ...(features.catalogSearchEnabled ? {
      sourceTrack: "crawl4", catalog: { mode: "compact", rankingBytes: 100 },
    } : {}) });
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
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: ["search_skills", "get_skill", "get_skills", "list_trending", "list_gold_basket", "list_by_author",
            "related_skills", "get_install_plan", "get_skill_content"]
            .map((name) => ({ name, annotations: { readOnlyHint: true, openWorldHint: name === "get_skill_content", destructiveHint: false },
              ...(features.catalogSearchEnabled ? {
              inputSchema: { properties: {
                page: { type: "object" },
                ...(name === "search_skills" ? { ranking: { const: "web-v1" } } : {}),
              } },
            } : {}) }))
        }
      });
    }
    const args = request.params?.arguments;
    if (features.catalogSearchEnabled && args?.page) {
      const next = Boolean(args.page.cursor);
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { structuredContent: {
        count: 1, skills: [{ id: next ? "author/repo:second" : "author/repo:first" }],
        page: { total: 2, hasMore: !next, nextCursor: next ? null : "next", sort: args.sort, snapshot: "a".repeat(64) },
      } } });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: { structuredContent: { count: 1, skills: [{ id: "author/repo:skill" }] } }
    });
  }
  return new Response(null, { status: 200 });
}

test("verifies the complete production deploy surface", async () => {
  const requests = [];
  await verifyProductionDeploy({
    origin,
    expectedFeatures: disabledFeatures,
    expectedHelperRelease: disabledHelper,
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
    { path: "/u/jonslimak", method: "GET" },
    { path: "/u/jonslimak/sets/health-check-missing", method: "GET" },
    { path: "/api/public/groups/jonslimak/health-check-missing/manifest", method: "GET" },
    { path: "/api/portal/private-releases/00000000-0000-4000-8000-000000000000/package", method: "GET" },
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
    { path: "/mcp", method: "POST" },
  ]);
});

test("rollback verification skips candidate-only public group checks", async () => {
  const requests = [];
  await verifyProductionDeploy({
    origin,
    expectedFeatures: disabledFeatures,
    expectedHelperRelease: disabledHelper,
    verifyCandidateFeatures: false,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push(path);
      return responseFor(path, options);
    },
  });

  assert.equal(requests.some((path) => path.startsWith("/u/jonslimak")), false);
  assert.equal(requests.some((path) => path.includes("health-check-missing")), false);
});

test("verifies a draft origin while preserving canonical public URLs", async () => {
  const previewOrigin = "https://preview.test";
  const requestedOrigins = [];
  await verifyProductionDeploy({
    origin: previewOrigin,
    publicOrigin: origin,
    expectedFeatures: disabledFeatures,
    expectedHelperRelease: disabledHelper,
    verifyCandidateFeatures: false,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requestedOrigins.push(parsed.origin);
      return responseFor(parsed.pathname, options);
    },
  });

  assert.deepEqual(new Set(requestedOrigins), new Set([previewOrigin]));
});

test("active search draft verification cannot accept a legacy reader", async () => {
  await assert.rejects(verifyProductionDeploy({
    origin,
    expectedFeatures: { ...disabledFeatures, catalogSearchEnabled: true },
    expectedHelperRelease: disabledHelper,
    verifyCandidateFeatures: false,
    verifyCatalogSearch: true,
    fetchImpl: async (url, options) => responseFor(new URL(url).pathname, options),
  }), /not using the ready ranked compact catalog/);
});

test("active search draft verification checks all sorts and both pages without account probes", async () => {
  const features = { ...disabledFeatures, catalogSearchEnabled: true };
  const requests = [];
  const pages = [];
  await verifyProductionDeploy({
    origin,
    expectedFeatures: features,
    expectedHelperRelease: disabledHelper,
    verifyCandidateFeatures: false,
    verifyCatalogSearch: true,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push(path);
      if (path === "/mcp") {
        const args = JSON.parse(options.body).params?.arguments;
        if (args?.page) pages.push([args.sort, Boolean(args.page.cursor)]);
      }
      return responseFor(path, options, features);
    },
  });
  assert.deepEqual(pages, ["relevance", "trending", "stars", "updated", "added", "name"].flatMap(sort => [[sort, false], [sort, true]]));
  assert.equal(requests.some(path => path.startsWith("/u/") || path.startsWith("/api/public/")), false);
});

test("active search draft verification rejects unavailable ranking, capabilities and inconsistent pages", async () => {
  const features = { ...disabledFeatures, catalogSearchEnabled: true };
  for (const fault of ["full", "ranking", "track", "capability", "duplicate", "snapshot"]) {
    await assert.rejects(verifyProductionDeploy({
      origin,
      expectedFeatures: features,
      expectedHelperRelease: disabledHelper,
      verifyCandidateFeatures: false,
      verifyCatalogSearch: true,
      fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        const response = responseFor(path, options, features);
        if (path !== "/mcp/health" && path !== "/mcp") return response;
        const body = await response.json();
        if (path === "/mcp/health") {
          if (fault === "full") body.catalog.mode = "full";
          if (fault === "ranking") body.catalog.rankingBytes = 0;
          if (fault === "track") body.sourceTrack = "v2";
        } else {
          const rpc = JSON.parse(options.body);
          if (fault === "capability" && rpc.method === "tools/list") delete body.result.tools[0].inputSchema.properties.page;
          if (rpc.params?.arguments?.page?.cursor) {
            if (fault === "duplicate") body.result.structuredContent.skills[0].id = "author/repo:first";
            if (fault === "snapshot") body.result.structuredContent.page.snapshot = "b".repeat(64);
          }
        }
        return Response.json(body);
      },
    }), /ready ranked compact catalog|advertised search upgrade|inconsistent ranked page chain/, fault);
  }
});

test("historical verification can explicitly check feature-off search", async () => {
  await verifyProductionDeploy({
    origin,
    expectedFeatures: { ...disabledFeatures, catalogSearchEnabled: true },
    expectedHelperRelease: disabledHelper,
    verifyCandidateFeatures: false,
    verifyCatalogSearch: false,
    fetchImpl: async (url, options) => responseFor(new URL(url).pathname, options),
  });
});

test("the deploy helper's search override enforces the reviewed flag independently", async (t) => {
  const previous = process.env.VERIFY_CATALOG_SEARCH;
  t.after(() => {
    if (previous === undefined) delete process.env.VERIFY_CATALOG_SEARCH;
    else process.env.VERIFY_CATALOG_SEARCH = previous;
  });
  process.env.VERIFY_CATALOG_SEARCH = "1";
  const options = {
    origin,
    expectedFeatures: disabledFeatures,
    expectedHelperRelease: disabledHelper,
    verifyCandidateFeatures: false,
    fetchImpl: async (url, request) => responseFor(new URL(url).pathname, request),
  };
  await verifyProductionDeploy(options);
  const active = { ...options, expectedFeatures: { ...disabledFeatures, catalogSearchEnabled: true } };
  await assert.rejects(verifyProductionDeploy(active), /not using the ready ranked compact catalog/);
  await verifyProductionDeploy({ ...active, verifyCatalogSearch: false });
});

test("fails when a required release asset is missing", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: disabledFeatures,
      expectedHelperRelease: disabledHelper,
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
  const enabledFeatures = { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: true };
  await verifyProductionDeploy({
    origin,
    expectedFeatures: enabledFeatures,
    expectedHelperRelease: disabledHelper,
    fetchImpl: async (url, options) => (
      responseFor(new URL(url).pathname, options, enabledFeatures)
    ),
  });
});

test("accepts the web-only beta with Mac delivery disabled", async () => {
  const webOnlyFeatures = { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false };
  await verifyProductionDeploy({
    origin,
    expectedFeatures: webOnlyFeatures,
    expectedHelperRelease: disabledHelper,
    fetchImpl: async (url, options) => responseFor(new URL(url).pathname, options, webOnlyFeatures),
  });
});

test("fails when the private portal does not honor the reviewed kill-switch state", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: disabledFeatures,
      expectedHelperRelease: disabledHelper,
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

test("fails when the public group manifest route is unhealthy", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: disabledFeatures,
      expectedHelperRelease: disabledHelper,
      fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        if (path === "/api/public/groups/jonslimak/health-check-missing/manifest") {
          return Response.json({ error: "Manifest failed" }, { status: 500 });
        }
        return responseFor(path, options);
      },
    }),
    /public\/groups\/jonslimak\/health-check-missing\/manifest returned 500, expected 404/,
  );
});

test("fails when the deployed feature receipt does not match the reviewed state", async () => {
  await assert.rejects(
    verifyProductionDeploy({
      origin,
      expectedFeatures: { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: true },
      expectedHelperRelease: disabledHelper,
      fetchImpl: async (url, options) => responseFor(new URL(url).pathname, options),
    }),
    /does not match the reviewed production feature state/,
  );
});

test("candidate verification checks the full helper feed and download bytes", async () => {
  const content = Buffer.from("synthetic helper asset");
  const expectedHelperRelease = {
    version: 1,
    enabled: true,
    assets: ["appcast.xml", "OMGSkills-Helper-0.1.0-1-arm64.dmg"].map((name) => ({
      path: `helper/updates/${name}`,
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    })),
  };
  const requests = [];
  let corrupt = false;
  const options = {
    origin,
    expectedFeatures: disabledFeatures,
    expectedHelperRelease,
    fetchImpl: async (url, request) => {
      const path = new URL(url).pathname;
      if (path.startsWith("/helper/updates/")) {
        requests.push({ path, method: request.method || "GET" });
        return new Response(corrupt ? Buffer.alloc(content.length, 120) : content);
      }
      return responseFor(path, request);
    },
  };
  await verifyProductionDeploy(options);
  assert.deepEqual(requests, expectedHelperRelease.assets.map((asset) => ({ path: `/${asset.path}`, method: "GET" })));
  corrupt = true;
  await assert.rejects(verifyProductionDeploy(options), /checksum mismatch/);
  requests.length = 0;
  await verifyProductionDeploy({ ...options, verifyCandidateFeatures: false });
  assert.deepEqual(requests, []);
});

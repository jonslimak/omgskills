import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createConfiguredMcpHandler } from "../omgskills-mcp.mjs";
import { createCompactMcpLibraryLoader } from "./compact-mcp-library.js";
import { createMcpLibraryLoader } from "./mcp-library.js";
import { catalogFixture, rows } from "../../../mcp/test/search-catalog-fixture.js";

test("the reviewed switch selects only one reader and off keeps legacy tool schemas", async context => {
  const f = catalogFixture(context, rows, true);
  let fullReads = 0, compactReads = 0;
  const full = createMcpLibraryLoader({ loadTrack: async () => f.legacy });
  const compact = createCompactMcpLibraryLoader({ ...f.options, ranking: true, tracks: [{ name: "crawl4", manifestUrl: f.url }] });
  const loaders = { legacy: { ...full, get: () => { fullReads++; return full.get(); } }, compact: { ...compact, get: () => { compactReads++; return compact.get(); } } };
  const work: Promise<unknown>[] = [], ctx = { waitUntil: (p: Promise<unknown>) => { work.push(p); } };
  const call = async (enabled: boolean, method: string, params = {}) => {
    const response = await createConfiguredMcpHandler(enabled, loaders)(new Request("https://test.invalid/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }), ctx);
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const old = await call(false, "tools/list");
  assert.equal(fullReads, 1); assert.equal(compactReads, 0);
  assert.equal(old.tools[0].inputSchema.properties.page, undefined);
  const active = await call(true, "tools/list");
  assert.equal(fullReads, 1); assert.equal(compactReads, 1);
  assert.equal(active.tools[0].inputSchema.properties.page.type, "object");
  assert.equal(active.tools[0].inputSchema.properties.ranking.const, "web-v1");
  const result = await call(true, "tools/call", { name: "search_skills", arguments: { query: "design", ranking: "web-v1", page: {}, limit: 1 } });
  assert.equal(result.structuredContent.skills.length, 1); assert.ok(result.structuredContent.page.hasMore);
  assert.equal(fullReads, 1);
  const health = await (await createConfiguredMcpHandler(true, loaders)(new Request("https://test.invalid/mcp/health"), ctx)).json();
  assert.equal(health.catalog.mode, "compact"); assert.equal(health.sourceTrack, "crawl4");
  await Promise.allSettled(work);
});

test("production compact reads inherit the existing bounded fetch behavior", async context => {
  const f = catalogFixture(context, rows, true), original = globalThis.fetch;
  globalThis.fetch = async (input, init) => { assert.ok(init?.signal instanceof AbortSignal); return f.fetcher(input, init); };
  try {
    const loader = createCompactMcpLibraryLoader({ ranking: true, goldBasketUrl: f.options.goldBasketUrl, tracks: [{ name: "crawl4", manifestUrl: f.url }] });
    assert.equal((await loader.get()).skillCount, rows.length);
  } finally { globalThis.fetch = original; }
});

test("install records retain full metadata without changing the configured MCP search reader", async context => {
  const f = catalogFixture(context, rows, true);
  for (const enabled of [false, true]) {
    let fullReads = 0, compactReads = 0;
    const full = createMcpLibraryLoader({ loadTrack: async () => f.legacy });
    const compact = createCompactMcpLibraryLoader({ ...f.options, ranking: true,
      tracks: [{ name: "crawl4", manifestUrl: f.url }] });
    const handler = createConfiguredMcpHandler(enabled, {
      legacy: { ...full, get: () => { fullReads++; return full.get(); } },
      compact: { ...compact, get: () => { compactReads++; return compact.get(); } },
    });
    const work: Promise<unknown>[] = [], ctx = { waitUntil: (p: Promise<unknown>) => { work.push(p); } };
    const response = await handler(new Request(
      `https://test.invalid/api/catalog/install-record?id=${encodeURIComponent(rows[0].id)}`), ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.skill.repo_slug, rows[0].repo_slug);
    assert.equal(body.skill.install_target_name, rows[0].install_target_name);
    assert.equal(body.skill.repo_commit_sha, rows[0].repo_commit_sha);
    assert.equal(body.skill.readme_snippet, undefined);
    assert.equal(fullReads, 1);
    assert.equal(compactReads, 0);
    const tools = await handler(new Request("https://test.invalid/mcp", { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }), ctx);
    assert.equal(tools.status, 200);
    assert.equal(fullReads, enabled ? 1 : 2);
    assert.equal(compactReads, enabled ? 1 : 0);
    await Promise.allSettled(work);
  }
});

test("the function bundle includes the exact reviewed configuration and shared validator", async () => {
  const bundled = await build({ entryPoints: [new URL("../omgskills-mcp.mts", import.meta.url).pathname], bundle: true,
    packages: "external", platform: "node", format: "esm", write: false, metafile: true });
  const paths = Object.keys(bundled.metafile!.inputs);
  assert.ok(paths.some(path => path.endsWith("config/production-features.json")));
  assert.ok(paths.some(path => path.endsWith("config/production-features.mjs")));
  const config = JSON.parse(await readFile(new URL("../../../config/production-features.json", import.meta.url), "utf8"));
  assert.match(bundled.outputFiles![0].text, new RegExp(`catalogSearchEnabled: ${config.catalogSearchEnabled}`));
});

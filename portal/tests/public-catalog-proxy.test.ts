import assert from "node:assert/strict";
import test from "node:test";
import { isPublicCatalogRequest, publicCatalogPathPattern, publicCatalogProxy } from "../public-catalog-proxy";

test("catalog proxy is opt-in and targets only the canonical public host", () => {
  assert.deepEqual(publicCatalogProxy(false), {});
  const options = publicCatalogProxy(true)[publicCatalogPathPattern];
  assert.equal(options.target, "https://omgskills.com");
  assert.equal(options.followRedirects, false);
  assert.equal(options.proxyTimeout, 20_000);
});

test("catalog policy permits public reads and MCP POST only", () => {
  assert.equal(isPublicCatalogRequest("/mcp", "POST"), true);
  for (const path of ["/mcp/health", "/data/crawl4/manifest.json", "/data/crawl4/collections-123abc.json?v=1", "/data/v2/manifest.json", "/catalog-skill-urls.json"]) {
    assert.equal(isPublicCatalogRequest(path, "GET"), true);
    assert.equal(isPublicCatalogRequest(path, "HEAD"), true);
    assert.equal(isPublicCatalogRequest(path, "POST"), false);
    assert.equal(isPublicCatalogRequest(path, "DELETE"), false);
  }
  assert.equal(isPublicCatalogRequest("/mcp", "GET"), false);
});

test("catalog policy rejects account endpoints, other origins and path escapes", () => {
  for (const path of ["/api/portal/groups", "/data/health.json", "/mcp/other", "/mcpx", "/catalog-skill-urls.json/other", "/data/crawl4/../health.json", "/data/crawl4/%2e%2e/health.json", "https://example.com/mcp"]) {
    assert.equal(isPublicCatalogRequest(path, "GET"), false, path);
    assert.equal(isPublicCatalogRequest(path, "POST"), false, path);
  }
});

test("public proxy removes account credentials before forwarding", () => {
  const removed: string[] = [];
  const options = publicCatalogProxy(true)[publicCatalogPathPattern];
  options.configure!({
    on(event: string, listener: (request: { removeHeader: (name: string) => void }) => void) {
      assert.equal(event, "proxyReq");
      listener({ removeHeader: (name) => removed.push(name) });
    },
  } as never, options);
  assert.deepEqual(removed, ["authorization", "cookie"]);
});

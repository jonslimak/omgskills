import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appDomainRedirects } from "./portal-redirects.mjs";

function destination(url) {
  for (const rule of appDomainRedirects) {
    const [from, to, status] = rule.trim().split(/\s+/);
    const pattern = from.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*)");
    const match = url.match(new RegExp(`^${pattern}$`));
    if (match) return { to: to.replace(":splat", match[1] || ""), status };
  }
  return null;
}

test("public catalog exceptions win before the app fallback on both schemes", () => {
  for (const scheme of ["http", "https"]) {
    for (const path of ["/mcp", "/mcp/health", "/data/crawl4/manifest.json", "/data/crawl4/collections-a123.json", "/data/v2/manifest.json", "/data/v2/collections-abc123.json", "/catalog-skill-urls.json"]) {
      assert.deepEqual(destination(`${scheme}://app.omgskills.com${path}`), {
        to: `https://omgskills.com${path}`, status: "200!"
      });
    }
  }
});

test("existing assets and app deep links retain their destinations", () => {
  for (const scheme of ["http", "https"]) {
    for (const path of ["/assets/main.js", "/app/assets/main.js"]) {
      assert.equal(destination(`${scheme}://app.omgskills.com${path}`).to, "/app/assets/main.js");
    }
    for (const path of ["/", "/sets", "/groups/abc", "/connect", "/app/connect"]) {
      assert.equal(destination(`${scheme}://app.omgskills.com${path}`).to, "/app/index.html");
    }
  }
});

test("exceptions do not forward private APIs, protected health, or other hosts", () => {
  for (const path of ["/api/portal/groups", "/data/health.json", "/health/check", "/mcpx", "/mcp/private", "/data/crawl40/manifest.json"]) {
    assert.equal(destination(`https://app.omgskills.com${path}`).to, "/app/index.html");
  }
  assert.equal(destination("https://omgskills.com/mcp"), null);
  assert.equal(destination("https://example.test/mcp"), null);
});

test("combined build uses the tested rules before other redirects", async () => {
  const source = await readFile(new URL("./build-netlify-site.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ appDomainRedirects \} from "\.\/portal-redirects\.mjs"/);
  assert.ok(source.indexOf("...appDomainRedirects,") < source.indexOf("webLibraryRedirects.trim()"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { hostingFiles, candidateBuildOptions, candidateOrigin } from "./prepare-catalog-candidate-web.mjs";

test("private artifact has bounded public proxy routes and no public app or update fallback", () => {
  const files = hostingFiles(), redirects = files._redirects;
  assert.match(redirects, /^\/api\/catalog\/install-record https:\/\/omgskills.com\/api\/catalog\/install-record 200$/m);
  assert.match(redirects, /^\/mcp https:\/\/omgskills.com\/mcp 200$/m);
  assert.doesNotMatch(redirects, /api\/portal|appcast|updates|\.zip|\.dmg|\/app\/\*/);
  assert.match(files._headers, /X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(files._headers, /connect-src 'self'/);
  assert.match(files["robots.txt"], /Disallow: \//);
  const native = readFileSync(new URL("../menubar/Sources/omgskills/CatalogCandidateRuntime.swift", import.meta.url), "utf8");
  assert.ok(native.includes(candidateOrigin));
});

test("separate build ignores normal configuration and dotenv, replacing only its own entry", () => {
  const options = candidateBuildOptions("/private/tmp/candidate-fixture");
  assert.equal(options.configFile, false); assert.equal(options.envFile, false);
  assert.equal(options.base, "/app/"); assert.equal(options.build.emptyOutDir, false);
  assert.equal(options.build.outDir, "/private/tmp/candidate-fixture/app");
  const plugin = options.plugins.find(plugin => plugin.name === "catalog-candidate-entry-only");
  const html = readFileSync(new URL("../portal/index.html", import.meta.url), "utf8");
  assert.equal(plugin.transformIndexHtml.order, "pre");
  assert.match(plugin.transformIndexHtml.handler(html), /src\/candidate\/main.tsx/);
  assert.doesNotMatch(plugin.transformIndexHtml.handler(html), /bootstrap.ts/);
  assert.throws(() => plugin.transformIndexHtml.handler("unrecognized entry"));
  assert.match(html, /src\/bootstrap.ts/);
});

test("ordinary production bundle cannot import the private candidate entry", async () => {
  const portal = fileURLToPath(new URL("../portal/", import.meta.url));
  const result = await build({ root: portal, configFile: portal + "vite.config.ts", envFile: false,
    logLevel: "error", define: {
      "import.meta.env.VITE_PORTAL_UNIFIED_ENABLED": JSON.stringify("1"),
      "import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST": JSON.stringify("1"),
      "import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST": JSON.stringify("1"),
    }, build: { write: false, emptyOutDir: false } });
  const source = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output)
    .filter(chunk => chunk.type === "chunk").map(chunk => chunk.code).join("\n");
  assert.doesNotMatch(source, /Candidate test unavailable|Disposable Mac VM only|signed candidate download is not available|omgskills.app.catalog-install-intent.v1.candidate/);
});

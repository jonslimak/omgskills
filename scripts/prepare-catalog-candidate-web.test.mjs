import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostingFiles, candidateBuildOptions, candidateOrigin } from "./prepare-catalog-candidate-web.mjs";
import { connectedClerkFrontend, requireConnectedCandidateBrowser } from "../portal/src/candidate/connected-policy.ts";

const connected = { profile: "connected", publishableKey: `pk_test_${Buffer.from("cc2b3-fixture.clerk.accounts.dev$").toString("base64")}`,
  clerkFrontendOrigin: "https://cc2b3-fixture.clerk.accounts.dev" };
const portal = fileURLToPath(new URL("../portal/", import.meta.url));
const sentinel = "CC2B3_UNAPPROVED_ENVIRONMENT_VALUE";

// A clean child environment/cwd also isolates the normal config's explicit loadEnv().
async function inMemoryBuild(profile) {
  const directory = await mkdtemp(join(tmpdir(), "cc2b3-build-"));
  try {
    const script = `
      import { build } from ${JSON.stringify(import.meta.resolve("vite"))};
      import { candidateBuildOptions } from ${JSON.stringify(new URL("./prepare-catalog-candidate-web.mjs", import.meta.url).href)};
      globalThis.fetch = () => { throw Error("Build tests must not access the network"); };
      const profile = ${JSON.stringify(profile)};
      const options = profile === "normal" ? {
        root: ${JSON.stringify(portal)}, configFile: ${JSON.stringify(portal + "vite.config.ts")}, envFile: false,
        define: {
          "import.meta.env.VITE_PORTAL_UNIFIED_ENABLED": JSON.stringify("1"),
          "import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST": JSON.stringify("1"),
          "import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST": JSON.stringify("1"),
        },
      } : candidateBuildOptions(${JSON.stringify(join(directory, "not-written"))},
        profile === "connected" ? ${JSON.stringify(connected)} : { profile: "install-only" });
      const result = await build({ ...options, logLevel: "error", mode: "production",
        build: { ...options.build, write: false, emptyOutDir: false } });
      const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
      process.stdout.write(JSON.stringify({
        files: output.map(chunk => chunk.fileName),
        modules: [...new Set(output.filter(chunk => chunk.type === "chunk").flatMap(chunk => Object.keys(chunk.modules)))],
        source: output.filter(chunk => chunk.type === "chunk").map(chunk => chunk.code).join("\\n"),
        assets: Object.fromEntries(output.filter(chunk => chunk.type === "asset").map(chunk => [chunk.fileName,
          typeof chunk.source === "string" ? chunk.source : Buffer.from(chunk.source).toString("utf8")])),
      }));
    `;
    const env = { PATH: process.env.PATH, TMPDIR: directory, NODE_ENV: "production",
      CLERK_SECRET_KEY: "sk_test_" + sentinel, OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL: "postgresql://" + sentinel,
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_" + sentinel, VITE_UNAPPROVED_VALUE: sentinel,
      VITE_NEWMAC_WEB_INSTALL_TEST: "1", VITE_NEWMAC_CATALOG_INSTALL_TEST: "1",
      VITE_NEWMAC_F1: "1", VITE_PORTAL_PREVIEW: "1", OMGSKILLS_CONNECTED_CANDIDATE: "1" };
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: directory, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    }));
    assert.equal((await readdir(directory)).includes("not-written"), false, "In-memory build wrote site output");
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const hasModule = (result, suffix) => result.modules.some(id => id.replaceAll("\\", "/").endsWith(suffix));

test("private artifact has bounded public proxy routes and no public app or update fallback", () => {
  const files = hostingFiles(), redirects = files._redirects;
  assert.doesNotMatch(redirects, /install-record/, 'Record endpoint must be provided by the isolated function');
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
  const result = await inMemoryBuild("normal"), source = result.source;
  assert.ok(hasModule(result, "/src/bootstrap.ts"));
  for (const entry of ["main.tsx", "connected-main.tsx", "connected-app.tsx", "distribution.json"]) {
    assert.equal(hasModule(result, "/src/candidate/" + entry), false);
  }
  assert.doesNotMatch(source, /Candidate test unavailable|Disposable Mac VM only|signed candidate download is not available|omgskills.app.catalog-install-intent.v1.candidate/);
  assert.doesNotMatch(source, /OMGSkills-Catalog-Candidate-0\.0\.21-21-arm64\.zip|b222aa91f16f8f4c2be97a2f0d3962d91126beaaf1c71548c7cd27d8befd6d69/);
});

test("explicit connected helpers validate the same public key/origin contract as the browser", () => {
  assert.equal(connectedClerkFrontend(connected.publishableKey), connected.clerkFrontendOrigin);
  const options = candidateBuildOptions("/private/tmp/not-written", connected);
  const config = JSON.parse(options.define.__OMGSKILLS_CONNECTED_CANDIDATE__);
  assert.deepEqual(config, connected); assert.deepEqual(options.envPrefix, []);
  assert.equal(options.envFile, false); assert.equal(options.configFile, false);
  assert.equal(requireConnectedCandidateBrowser(config, candidateOrigin + "/app/").publishableKey, connected.publishableKey);
  const plugin = options.plugins.find(plugin => plugin.name === "catalog-candidate-entry-only");
  const html = readFileSync(new URL("../portal/index.html", import.meta.url), "utf8");
  assert.match(plugin.transformIndexHtml.handler(html), /src\/candidate\/connected-main.tsx/);
  assert.doesNotMatch(plugin.transformIndexHtml.handler(html), /src\/candidate\/main.tsx|src\/bootstrap.ts/);
  assert.throws(() => plugin.transformIndexHtml.handler("unrecognized entry"));
});

test("bad profiles and extra configuration fail before a build can be started", () => {
  for (const profile of [null, "", "1", "normal", "production"]) {
    assert.throws(() => candidateBuildOptions("/private/tmp/not-written", { profile }));
    assert.throws(() => hostingFiles({ profile }));
  }
  for (const value of [null, [], "connected", { ...connected, secretKey: "sk_test_synthetic" },
    { ...connected, callback: "https://evil.test" }, { ...connected, extraOrigins: ["https://evil.test"] },
    { ...connected, profile: undefined }, { profile: "connected" }]) {
    assert.throws(() => candidateBuildOptions("/private/tmp/not-written", value));
    assert.throws(() => hostingFiles(value));
  }
  for (const publishableKey of [undefined, "", "pk_live_ignored", "sk_test_ignored", "pk_test_not-base64!",
    "pk_test_a", `pk_test_${Buffer.from("other.example.test$").toString("base64")}`,
    `pk_test_${Buffer.from("cc2b3-fixture.clerk.accounts.dev.evil.test$").toString("base64")}`]) {
    const value = { ...connected, publishableKey };
    assert.throws(() => connectedClerkFrontend(publishableKey));
    assert.throws(() => requireConnectedCandidateBrowser(value, candidateOrigin + "/app/"));
    assert.throws(() => candidateBuildOptions("/private/tmp/not-written", value)); assert.throws(() => hostingFiles(value));
  }
  for (const clerkFrontendOrigin of [undefined, "", connected.clerkFrontendOrigin + "/", "http://cc2b3-fixture.clerk.accounts.dev",
    "https://other.clerk.accounts.dev", "https://user:pass@cc2b3-fixture.clerk.accounts.dev", "https://omgskills.com", "https://*.clerk.accounts.dev"]) {
    const value = { ...connected, clerkFrontendOrigin };
    assert.throws(() => requireConnectedCandidateBrowser(value, candidateOrigin + "/app/"));
    assert.throws(() => candidateBuildOptions("/private/tmp/not-written", value)); assert.throws(() => hostingFiles(value));
  }
});

test("install-only default stays unchanged and never adopts environment-selected connected mode", () => {
  assert.deepEqual(hostingFiles(), hostingFiles({ profile: "install-only" }));
  const defaultOptions = candidateBuildOptions("/private/tmp/not-written");
  assert.equal(defaultOptions.define, undefined);
  assert.equal(candidateBuildOptions("/private/tmp/not-written", { profile: "install-only" }).define, undefined);
  const originalHeaders = "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'\n";
  assert.equal(hostingFiles()._headers, originalHeaders);
  const html = readFileSync(new URL("../portal/index.html", import.meta.url), "utf8");
  const entry = options => options.plugins.find(plugin => plugin.name === "catalog-candidate-entry-only").transformIndexHtml.handler(html);
  assert.equal(entry(defaultOptions), entry(candidateBuildOptions("/private/tmp/not-written", { profile: "install-only" })));
  const source = readFileSync(new URL("./prepare-catalog-candidate-web.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|loadEnv|prepareCandidateWeb\([^)]*profile/);
  assert.match(source, /build\(candidateBuildOptions\(site\)\)/);
  assert.match(source, /Object\.entries\(hostingFiles\(\)\)/);
});

test("connected routing adds just one internal rewrite and a bounded Clerk resource policy", () => {
  const original = hostingFiles(), files = hostingFiles(connected);
  assert.equal(files._redirects, original._redirects + "/app/connect /app/index.html 200\n");
  assert.doesNotMatch(files._redirects, /\/app\/\*|api\/portal|\/download|updates|appcast|\.zip|\.dmg/);
  const csp = files._headers.split("Content-Security-Policy: ")[1].trim();
  const directives = Object.fromEntries(csp.split(";").map(part => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...values]) => [name, values]));
  for (const name of ["script-src", "connect-src"]) assert.deepEqual(directives[name], ["'self'", connected.clerkFrontendOrigin]);
  assert.deepEqual(directives["frame-src"], [connected.clerkFrontendOrigin]);
  for (const name of ["default-src", "font-src"]) assert.deepEqual(directives[name], ["'self'"]);
  assert.deepEqual(directives["style-src"], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(directives["img-src"], ["'self'", "data:", "https://github.com", "https://avatars.githubusercontent.com"]);
  for (const name of ["frame-ancestors", "object-src", "base-uri"]) assert.deepEqual(directives[name], ["'none'"]);
  assert.doesNotMatch(csp, /\*|unsafe-eval/);
  assert.equal(files._headers.replace(csp, original._headers.split("Content-Security-Policy: ")[1].trim()), original._headers);
  assert.equal(files["robots.txt"], original["robots.txt"]); assert.equal(files["404.html"], original["404.html"]);
});

test("install-only build keeps its own entry and existing distribution", async () => {
  const result = await inMemoryBuild("install-only");
  assert.ok(hasModule(result, "/src/candidate/main.tsx"));
  assert.ok(hasModule(result, "/src/candidate/distribution.json"));
  for (const entry of ["connected-main.tsx", "connected-app.tsx"]) assert.equal(hasModule(result, "/src/candidate/" + entry), false);
  assert.equal(hasModule(result, "/src/bootstrap.ts"), false);
  assert.match(result.source, /OMGSkills-Catalog-Candidate-0\.0\.21-21-arm64\.zip/);
  assert.doesNotMatch(result.source, new RegExp(sentinel));
});

test("connected in-memory graph uses the reviewed shared flow without old downloads or leaked environment", async () => {
  const result = await inMemoryBuild("connected");
  for (const module of ["/src/candidate/connected-main.tsx", "/src/candidate/connected-app.tsx", "/src/ConnectPage.tsx",
    "/src/integration/unified/Session.tsx", "/src/integration/unified/useAccount.ts"]) assert.ok(hasModule(result, module), module);
  for (const module of ["/src/bootstrap.ts", "/src/candidate/main.tsx", "/src/candidate/distribution.ts", "/src/candidate/distribution.json"]) {
    assert.equal(hasModule(result, module), false, module);
  }
  assert.equal(result.modules.some(id => /\/src\/preview\//.test(id)), false);
  assert.ok(result.source.includes(connected.publishableKey)); assert.ok(result.source.includes(connected.clerkFrontendOrigin));
  // SDK key-prefix constants are not credentials; reject payloads and sentinel values.
  const unsafe = /\b__OMGSKILLS_CONNECTED_CANDIDATE__\b|CC2B3_UNAPPROVED_ENVIRONMENT_VALUE|pk_live_[A-Za-z0-9+/=]+|sk_(?:test|live)_[A-Za-z0-9]+|postgresql:\/\//;
  assert.equal(unsafe.test(result.source), false, "Connected output contains forbidden configuration");
  assert.doesNotMatch(result.source, /OMGSkills-Catalog-Candidate-0\.0\.21-21-arm64\.zip|b222aa91f16f8f4c2be97a2f0d3962d91126beaaf1c71548c7cd27d8befd6d69/);
  const html = result.assets["index.html"];
  assert.match(html, /<title>OMGSkills Connected Candidate<\/title>/);
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(urls.length > 0);
  for (const page of ["/app/", "/app/connect"]) for (const asset of urls) {
    const url = new URL(asset, candidateOrigin + page);
    assert.equal(url.origin, candidateOrigin); assert.ok(url.pathname.startsWith("/app/assets/"));
    assert.ok(result.files.includes(url.pathname.slice(5)), `Missing built asset: ${url.pathname}`);
  }
});

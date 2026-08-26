#!/usr/bin/env node

import {
  catalogSkillUrlEntries,
  legacyCatalogSkillRedirects,
} from "./web-library-skill-urls.mjs";

const targetOrigin = (process.env.TARGET_ORIGIN || "https://codex-skillgroups-mvp--omgskills.netlify.app").replace(/\/$/, "");
const productionOrigin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const handle = process.env.SKILLGROUP_HANDLE || "";
const groupSlug = process.env.SKILLGROUP_SLUG || "";
const verifyTargetLibrary = process.env.VERIFY_TARGET_WEB_LIBRARY === "1";
const verifyProfileRouteDiagnostic = process.env.VERIFY_PROFILE_ROUTE_DIAGNOSTIC === "1";

function fail(message) {
  console.error(`verify-skillgroups-rollout: ${message}`);
  process.exit(1);
}

async function request(path, options = {}) {
  const url = `${options.origin || targetOrigin}${path}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    redirect: "manual",
    headers: options.headers,
    body: options.body
  });
  return { url, response };
}

async function expectStatus(path, expected, options = {}) {
  const { url, response } = await request(path, options);
  if (response.status !== expected) {
    fail(`${url} returned ${response.status}, expected ${expected}`);
  }
  console.log(`ok ${response.status} ${url}`);
  return response;
}

async function expectJsonAsset(path, key, options = {}) {
  const response = await expectStatus(path, 200, options);
  const json = await response.json();
  if (!json?.[key]?.path) {
    fail(`${options.origin || targetOrigin}${path} missing ${key}.path`);
  }
}

async function expectText(path, text, options = {}) {
  const response = await expectStatus(path, 200, options);
  const body = await response.text();
  if (!body.includes(text)) {
    fail(`${options.origin || targetOrigin}${path} did not contain ${text}`);
  }
}

async function catalogSkillPage(origin) {
  const response = await expectStatus("/catalog-skill-urls.json", 200, { origin });
  const entries = catalogSkillUrlEntries(await response.json());
  if (entries.length === 0) {
    fail(`${origin}/catalog-skill-urls.json contained no generated skill URLs`);
  }
  return entries[0][1];
}

async function verifyGeneratedSkillPage(origin) {
  await expectStatus(await catalogSkillPage(origin), 200, { origin });
}

async function verifyFrontendDesignRedirect(origin) {
  const [legacyRoute] = legacyCatalogSkillRedirects;
  const response = await expectStatus("/catalog-skill-urls.json", 200, { origin });
  const currentPath = new Map(catalogSkillUrlEntries(await response.json())).get(
    legacyRoute.catalogSkillId,
  );
  if (!currentPath) {
    fail(`${origin}/catalog-skill-urls.json did not map ${legacyRoute.catalogSkillId}`);
  }
  const redirect = await expectStatus(legacyRoute.path, 301, { origin });
  if (redirect.headers.get("location") !== currentPath) {
    fail(`frontend-design redirect did not point to ${currentPath}`);
  }
  await expectText(currentPath, "frontend-design", { origin });
}

async function verifyTargetCore() {
  await expectStatus("/app/", 200);
  if (verifyProfileRouteDiagnostic) {
    console.log("skip database-backed sync check during profile route diagnostics");
  } else {
    await expectStatus("/api/portal/sync-upload", 401, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad", skills: [] })
    });
  }
  await expectJsonAsset("/data/crawl4/manifest.json", "skills");
  await expectJsonAsset("/data/v2/manifest.json", "skills");
  await expectJsonAsset("/data/manifest.json", "skills");
  await expectStatus("/appcast.xml", 200);
  await expectText("/robots.txt", "Sitemap: https://omgskills.com/sitemap-groups.xml");
  await expectStatus("/sitemap-groups.xml", 200);
}

async function verifyProfileDiagnostics() {
  if (!verifyProfileRouteDiagnostic) {
    return;
  }
  if (!handle) {
    fail("VERIFY_PROFILE_ROUTE_DIAGNOSTIC requires SKILLGROUP_HANDLE");
  }

  for (const suffix of ["", "/"]) {
    const response = await expectStatus(`/u/${encodeURIComponent(handle)}${suffix}`, 200, {
      headers: { "x-omgskills-route-diagnostic": "1" }
    });
    const diagnostic = await response.json();
    if (diagnostic.resolvedHandle !== handle || diagnostic.resolvedHandleIsValid !== true) {
      fail(`profile diagnostic resolved ${JSON.stringify(diagnostic)}, expected handle ${handle}`);
    }
  }

  await expectStatus("/u/logo.png", 404);
}

async function verifyPublicGroupRoutes() {
  if (!handle || !groupSlug) {
    console.log("skip public group routes: set SKILLGROUP_HANDLE and SKILLGROUP_SLUG to verify real set pages");
    return;
  }
  const canonicalPath = `/u/${encodeURIComponent(handle)}/sets/${encodeURIComponent(groupSlug)}`;
  const canonicalUrl = `${productionOrigin}${canonicalPath}`;
  const page = await expectStatus(canonicalPath, 200);
  const html = await page.text();
  if (!html.includes(`<link rel="canonical" href="${canonicalUrl}">`)) {
    fail(`${targetOrigin}${canonicalPath} did not expose its canonical URL`);
  }
  if (/omgskills:\/\/group|Install (all|group)|Open in omgskills/i.test(html)) {
    fail(`${targetOrigin}${canonicalPath} advertised group installation before L5.2`);
  }

  for (const legacyPath of [
    `/u/${encodeURIComponent(handle)}/${encodeURIComponent(groupSlug)}`,
    `/profiles/${encodeURIComponent(handle)}/sets/${encodeURIComponent(groupSlug)}`,
    `${canonicalPath}/`,
  ]) {
    const redirect = await expectStatus(legacyPath, 301);
    const location = redirect.headers.get("location");
    if (!location || new URL(location, targetOrigin).pathname !== canonicalPath) {
      fail(`${targetOrigin}${legacyPath} did not redirect to ${canonicalPath}`);
    }
  }

  const sitemap = await expectStatus("/sitemap-groups.xml", 200);
  if (!(await sitemap.text()).includes(canonicalUrl)) {
    fail(`${targetOrigin}/sitemap-groups.xml did not contain ${canonicalUrl}`);
  }
}

async function verifyProductionLibraryBaseline() {
  await expectText("/library/anthropics/", "Anthropic", { origin: productionOrigin });
  await verifyGeneratedSkillPage(productionOrigin);
  await verifyFrontendDesignRedirect(productionOrigin);
}

async function verifyTargetLibraryPages() {
  if (!verifyTargetLibrary) {
    console.log("skip target web-library pages: set VERIFY_TARGET_WEB_LIBRARY=1 after merging latest main");
    return;
  }
  const redirect = await expectStatus("/profiles/anthropics", 301);
  if (redirect.headers.get("location") !== "/library/anthropics/") {
    fail("static profile redirect did not point to the creator canonical URL");
  }
  const staticProfile = await expectStatus("/library/anthropics/", 200);
  if (!(staticProfile.headers.get("cache-control") || "").includes("public")) {
    fail("static profile lost its public cache policy");
  }
  if (!(await staticProfile.text()).includes("Anthropic")) {
    fail("static profile did not contain Anthropic");
  }
  await verifyGeneratedSkillPage(targetOrigin);
  await verifyFrontendDesignRedirect(targetOrigin);
}

await verifyTargetCore();
await verifyProfileDiagnostics();
await verifyPublicGroupRoutes();
await verifyProductionLibraryBaseline();
await verifyTargetLibraryPages();

console.log("verify-skillgroups-rollout: ok");

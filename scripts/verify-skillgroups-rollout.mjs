#!/usr/bin/env node

const targetOrigin = (process.env.TARGET_ORIGIN || "https://codex-skillgroups-mvp--omgskills.netlify.app").replace(/\/$/, "");
const productionOrigin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const handle = process.env.SKILLGROUP_HANDLE || "";
const groupSlug = process.env.SKILLGROUP_SLUG || "";
const verifyTargetLibrary = process.env.VERIFY_TARGET_WEB_LIBRARY === "1";

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

async function verifyTargetCore() {
  await expectStatus("/app/", 200);
  await expectStatus("/api/portal/sync-upload", 401, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "bad", skills: [] })
  });
  await expectJsonAsset("/data/crawl4/manifest.json", "skills");
  await expectJsonAsset("/data/v2/manifest.json", "skills");
  await expectJsonAsset("/data/manifest.json", "skills");
  await expectStatus("/appcast.xml", 200);
}

async function verifyPublicGroupRoutes() {
  if (!handle) {
    console.log("skip public profile routes: set SKILLGROUP_HANDLE to verify a real profile page");
    return;
  }
  await expectStatus(`/profiles/${encodeURIComponent(handle)}`, 200);
  await expectStatus(`/u/${encodeURIComponent(handle)}`, 200);

  if (!groupSlug) {
    console.log("skip public group routes: set SKILLGROUP_SLUG to verify real set pages");
    return;
  }
  await expectStatus(`/profiles/${encodeURIComponent(handle)}/sets/${encodeURIComponent(groupSlug)}`, 200);
  await expectStatus(`/u/${encodeURIComponent(handle)}/${encodeURIComponent(groupSlug)}`, 200);
}

async function verifyProductionLibraryBaseline() {
  await expectText("/profiles/anthropics/", "Anthropic", { origin: productionOrigin });
  await expectText("/skills/anthropics/skills/frontend-design/", "frontend-design", {
    origin: productionOrigin
  });
}

async function verifyTargetLibraryPages() {
  if (!verifyTargetLibrary) {
    console.log("skip target web-library pages: set VERIFY_TARGET_WEB_LIBRARY=1 after merging latest main");
    return;
  }
  await expectText("/profiles/anthropics/", "Anthropic");
  await expectText("/skills/anthropics/skills/frontend-design/", "frontend-design");
}

await verifyTargetCore();
await verifyPublicGroupRoutes();
await verifyProductionLibraryBaseline();
await verifyTargetLibraryPages();

console.log("verify-skillgroups-rollout: ok");

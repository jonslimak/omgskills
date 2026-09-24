#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { extractUpdateAssetPaths } from "./deploy-artifact-guard.mjs";
import { loadProductionFeatures } from "./production-features.mjs";
import { verifyMcpEndpoint } from "./verify-mcp-endpoint.mjs";

const defaultOrigin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const requiredStaticReleaseAssets = [
  "downloads/omgskills-mac.dmg",
  "downloads/omgskills-mac.dmg.sha256",
];
const publicGroupFixture = {
  pagePath: "/u/jonslimak/sets/my-faves",
  manifestPath: "/api/public/groups/jonslimak/my-faves/manifest",
};

async function expectStatus(fetchImpl, origin, path, expected, options = {}) {
  const url = `${origin}${path}`;
  const response = await fetchImpl(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  if (response.status !== expected) {
    throw new Error(`${url} returned ${response.status}, expected ${expected}`);
  }
  console.log(`ok ${expected} ${url}`);
  return response;
}

async function verifyManifest(fetchImpl, origin, path) {
  const response = await expectStatus(fetchImpl, origin, path, 200);
  const manifest = await response.json();
  if (!manifest?.skills?.path) {
    throw new Error(`${origin}${path} is missing skills.path`);
  }
}

async function verifyAiCatalog(fetchImpl, origin, publicOrigin) {
  const path = "/.well-known/ai-catalog.json";
  const response = await expectStatus(fetchImpl, origin, path, 200);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error(`${origin}${path} returned Content-Type ${contentType || "<missing>"}`);
  }
  if (response.headers.get("access-control-allow-origin") !== "*") {
    throw new Error(`${origin}${path} must allow cross-origin discovery`);
  }
  const catalog = await response.json();
  const mcpEntry = catalog?.entries?.find(
    (entry) => entry.identifier === "urn:air:omgskills.com:mcp:catalog",
  );
  if (catalog?.specVersion !== "1.0" || mcpEntry?.data?.endpoint !== `${publicOrigin}/mcp`) {
    throw new Error(`${origin}${path} does not advertise the hosted omgskills MCP server`);
  }
}

async function verifyReleaseConfig(fetchImpl, origin, expected) {
  const path = "/app/release-config.json";
  const response = await expectStatus(fetchImpl, origin, path, 200);
  const config = await response.json();
  if (
    config?.version !== 1
    || config?.skillGroupsAuthEnabled !== expected.skillGroupsAuthEnabled
  ) {
    throw new Error(`${origin}${path} does not match the reviewed production feature state`);
  }
}

async function verifyPublicGroupManifest(fetchImpl, origin, expectedFeatures) {
  const page = await expectStatus(fetchImpl, origin, publicGroupFixture.pagePath, 200);
  const pageHtml = await page.text();
  const hasInstallLink = pageHtml.includes("Install in omgskills");
  if (hasInstallLink !== expectedFeatures.skillGroupsAuthEnabled) {
    throw new Error(`${origin}${publicGroupFixture.pagePath} has the wrong Mac install availability`);
  }
  const response = await expectStatus(fetchImpl, origin, publicGroupFixture.manifestPath, 200);
  const manifest = await response.json();
  if (
    manifest?.type !== "omgskills.skill_group"
    || manifest?.version !== 2
    || manifest?.group?.slug !== "my-faves"
    || !Array.isArray(manifest?.items)
  ) {
    throw new Error(`${origin}${publicGroupFixture.manifestPath} is not a valid public group manifest`);
  }
  if (JSON.stringify(manifest).includes("private_github")) {
    throw new Error(`${origin}${publicGroupFixture.manifestPath} exposed private source coordinates`);
  }
}

export async function verifyProductionDeploy({
  origin = defaultOrigin,
  publicOrigin = process.env.PUBLIC_ORIGIN || origin,
  fetchImpl = fetch,
  expectedFeatures,
  verifyCandidateFeatures = process.env.VERIFY_CANDIDATE_FEATURES !== "0",
} = {}) {
  origin = origin.replace(/\/$/, "");
  publicOrigin = publicOrigin.replace(/\/$/, "");
  const reviewedFeatures = expectedFeatures || await loadProductionFeatures();
  await expectStatus(fetchImpl, origin, "/app/", 200);
  await verifyReleaseConfig(fetchImpl, origin, reviewedFeatures);
  await expectStatus(fetchImpl, origin, "/about/", 200);
  await expectStatus(fetchImpl, origin, "/support/", 200);
  await expectStatus(fetchImpl, origin, "/health/", 401);
  await expectStatus(fetchImpl, origin, "/data/health.json", 401);
  await expectStatus(fetchImpl, origin, "/banner.webp", 200, { method: "HEAD" });
  const expectedPortalStatus = reviewedFeatures.skillGroupsWebEnabled ? 401 : 503;
  await expectStatus(fetchImpl, origin, "/api/portal/sync-upload", expectedPortalStatus, {
    method: "POST",
    headers: {
      Authorization: "Bearer invalid-production-smoke-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ skills: [] }),
  });
  if (verifyCandidateFeatures) {
    await verifyPublicGroupManifest(fetchImpl, origin, reviewedFeatures);
    if (!reviewedFeatures.skillGroupsAuthEnabled) {
      await expectStatus(
        fetchImpl,
        origin,
        "/api/portal/private-releases/00000000-0000-4000-8000-000000000000/package",
        503,
      );
    }
  }

  for (const path of [
    "/data/manifest.json",
    "/data/v2/manifest.json",
    "/data/crawl4/manifest.json",
  ]) {
    await verifyManifest(fetchImpl, origin, path);
  }

  const download = await expectStatus(fetchImpl, origin, "/download", 302);
  const downloadLocation = download.headers.get("location");
  if (downloadLocation !== "/downloads/omgskills-mac.dmg") {
    throw new Error(`${origin}/download redirected to ${downloadLocation || "no location"}`);
  }

  const appcast = await expectStatus(fetchImpl, origin, "/appcast.xml", 200);
  const updateAssets = extractUpdateAssetPaths(await appcast.text());
  if (updateAssets.length === 0) {
    throw new Error(`${origin}/appcast.xml has no /updates/ assets`);
  }

  for (const relativePath of [...requiredStaticReleaseAssets, ...updateAssets]) {
    await expectStatus(fetchImpl, origin, `/${relativePath}`, 200, { method: "HEAD" });
  }

  await verifyAiCatalog(fetchImpl, origin, publicOrigin);
  await verifyMcpEndpoint({ origin, fetchImpl });

  console.log("Production deploy verified");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyProductionDeploy().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

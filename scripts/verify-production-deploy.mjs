#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { extractUpdateAssetPaths } from "./deploy-artifact-guard.mjs";
import { verifyMcpEndpoint } from "./verify-mcp-endpoint.mjs";

const defaultOrigin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const requiredStaticReleaseAssets = [
  "downloads/omgskills-mac.dmg",
  "downloads/omgskills-mac.dmg.sha256",
];

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

async function verifyAiCatalog(fetchImpl, origin) {
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
  if (catalog?.specVersion !== "1.0" || mcpEntry?.data?.endpoint !== `${origin}/mcp`) {
    throw new Error(`${origin}${path} does not advertise the hosted omgskills MCP server`);
  }
}

export async function verifyProductionDeploy({
  origin = defaultOrigin,
  fetchImpl = fetch,
} = {}) {
  await expectStatus(fetchImpl, origin, "/app/", 200);
  await expectStatus(fetchImpl, origin, "/about/", 200);
  await expectStatus(fetchImpl, origin, "/support/", 200);
  await expectStatus(fetchImpl, origin, "/banner.webp", 200, { method: "HEAD" });
  await expectStatus(fetchImpl, origin, "/api/portal/sync-upload", 401, {
    method: "POST",
    headers: {
      Authorization: "Bearer invalid-production-smoke-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ skills: [] }),
  });

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

  await verifyAiCatalog(fetchImpl, origin);
  await verifyMcpEndpoint({ origin, fetchImpl });

  console.log("Production deploy verified");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyProductionDeploy().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

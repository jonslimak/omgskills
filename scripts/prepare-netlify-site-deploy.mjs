#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const productionOrigin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const isCi = process.env.CI === "true";

const requiredStaticAssets = [
  "/downloads/omgskills-mac.dmg",
  "/downloads/omgskills-mac.dmg.sha256",
];

function localPathForUrlPath(urlPath) {
  const cleanPath = urlPath.replace(/^\/+/, "");
  return path.join(siteDir, cleanPath);
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function downloadAsset(urlPath) {
  const target = localPathForUrlPath(urlPath);
  const source = `${productionOrigin}${urlPath}`;
  console.log(`Restoring ${urlPath} from ${source}`);

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to restore ${urlPath}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`Failed to restore ${urlPath}: response was empty`);
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function ensureAsset(urlPath) {
  const target = localPathForUrlPath(urlPath);
  if (await fileExists(target)) {
    return;
  }

  if (!isCi) {
    throw new Error(`Missing required deploy asset: ${target}`);
  }

  await downloadAsset(urlPath);

  if (!(await fileExists(target))) {
    throw new Error(`Missing required deploy asset after restore: ${target}`);
  }
}

async function readAppcast() {
  const appcastPath = path.join(siteDir, "appcast.xml");
  if (!(await fileExists(appcastPath))) {
    throw new Error(`Missing required appcast: ${appcastPath}`);
  }
  return readFile(appcastPath, "utf8");
}

function extractUpdatePaths(appcastXml) {
  const paths = new Set();
  const urlPattern = /\burl="([^"]+)"/g;

  for (const match of appcastXml.matchAll(urlPattern)) {
    const value = match[1];
    let parsed;
    try {
      parsed = new URL(value, productionOrigin);
    } catch {
      continue;
    }

    if (parsed.pathname.startsWith("/updates/")) {
      paths.add(parsed.pathname);
    }
  }

  return [...paths].sort();
}

async function main() {
  const appcastXml = await readAppcast();
  const updateAssets = extractUpdatePaths(appcastXml);

  if (updateAssets.length === 0) {
    throw new Error("No /updates/ assets were found in site/appcast.xml");
  }

  const requiredAssets = [...requiredStaticAssets, ...updateAssets];
  for (const urlPath of requiredAssets) {
    await ensureAsset(urlPath);
  }

  console.log(`Netlify deploy assets ready: ${requiredAssets.length} files verified`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

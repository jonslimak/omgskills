#!/usr/bin/env node

import { mkdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  requiredReleaseAssetPaths,
  verifyReleaseDeployArtifacts,
  verifyWebLibraryDeployArtifacts,
} from "./deploy-artifact-guard.mjs";
import { ensureHealthSnapshot } from "./health-snapshot-guard.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
const productionOrigin = (process.env.PRODUCTION_ORIGIN || "https://omgskills.com").replace(/\/$/, "");
const isCi = process.env.CI === "true";

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

async function runWebLibraryBuild() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "build-web-library.mjs")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SITE_DIR: siteDir,
        PRODUCTION_ORIGIN: productionOrigin,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Web library build failed with exit code ${code}`));
    });
  });
}

async function verifyPolicy() {
  await new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(
      command,
      ["--prefix", path.join(repoRoot, "index"), "run", "policy:validate", "--", "--profile", "deploy"],
      { cwd: repoRoot, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Policy validation failed with exit code ${code}`));
    });
  });
}

async function verifyCreatorHandleReservations() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "scripts", "generate-creator-handle-reservations.mjs"), "--check"],
      { cwd: repoRoot, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Creator handle reservation check failed with exit code ${code}`));
    });
  });
}

async function verifyWebLibraryBuild() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "verify-web-library-pages.mjs")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SITE_DIR: siteDir,
        PRODUCTION_ORIGIN: productionOrigin,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Web library verification failed with exit code ${code}`));
    });
  });
}

async function main() {
  await verifyPolicy();
  await verifyCreatorHandleReservations();
  await runWebLibraryBuild();
  await verifyWebLibraryBuild();
  await verifyWebLibraryDeployArtifacts(siteDir, "site deploy source");

  const healthSnapshot = await ensureHealthSnapshot({ siteDir, productionOrigin });
  if (healthSnapshot.restored) {
    console.log(`Restored /data/health.json from ${healthSnapshot.source}`);
  }

  const requiredAssets = await requiredReleaseAssetPaths(siteDir);
  for (const relativePath of requiredAssets) {
    await ensureAsset(`/${relativePath}`);
  }
  await verifyReleaseDeployArtifacts(siteDir, "site deploy source");

  console.log(`Netlify deploy assets ready: ${requiredAssets.length} files verified`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

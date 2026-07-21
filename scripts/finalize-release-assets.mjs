#!/usr/bin/env node

import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requiredReleaseAssetPaths,
  verifyReleaseDeployArtifacts,
} from "./deploy-artifact-guard.mjs";

async function isFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function finalizeReleaseAssets(rootDir) {
  const archivedUpdatesDir = path.join(rootDir, "updates", "old_updates");
  const requiredAssets = await requiredReleaseAssetPaths(rootDir);
  const restored = [];

  for (const relativePath of requiredAssets) {
    if (!relativePath.startsWith("updates/")) continue;

    const targetPath = path.join(rootDir, relativePath);
    if (await isFile(targetPath)) continue;

    const archivedPath = path.join(archivedUpdatesDir, path.basename(relativePath));
    if (!(await isFile(archivedPath))) continue;

    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(archivedPath, targetPath);
    restored.push(relativePath);
  }

  await verifyReleaseDeployArtifacts(rootDir, "release source");
  await rm(archivedUpdatesDir, { recursive: true, force: true });
  return restored;
}

async function main() {
  const defaultRoot = fileURLToPath(new URL("../site", import.meta.url));
  const rootDir = path.resolve(process.argv[2] ?? defaultRoot);
  const restored = await finalizeReleaseAssets(rootDir);
  console.log(`Release assets finalized (${restored.length} archived appcast assets restored).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

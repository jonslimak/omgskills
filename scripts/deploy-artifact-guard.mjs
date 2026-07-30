import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  catalogSkillUrlEntries,
  catalogSkillUrlsFilename,
} from "./web-library-skill-urls.mjs";

const requiredWebLibraryArtifacts = [
  "library/anthropics/index.html",
  "collections/starter-pack/index.html",
  "skills/index.html",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
];

const requiredStaticReleaseAssets = [
  "downloads/omgskills-mac.dmg",
  "downloads/omgskills-mac.dmg.sha256",
];

async function isFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function verifyWebLibraryDeployArtifacts(rootDir, label = "deploy artifact") {
  const missing = [];

  for (const relativePath of requiredWebLibraryArtifacts) {
    if (!(await isFile(path.join(rootDir, relativePath)))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${label} is unsafe: missing generated web library deploy artifacts: ${missing.join(", ")}`
    );
  }

  const catalogSkillUrlsPath = path.join(rootDir, catalogSkillUrlsFilename);
  if (!(await isFile(catalogSkillUrlsPath))) {
    throw new Error(
      `${label} is unsafe: missing generated web library deploy artifacts: ${catalogSkillUrlsFilename}`
    );
  }

  let entries;
  try {
    const asset = JSON.parse(await readFile(catalogSkillUrlsPath, "utf8"));
    entries = catalogSkillUrlEntries(asset);
  } catch (error) {
    throw new Error(
      `${label} is unsafe: invalid ${catalogSkillUrlsFilename}: ${error.message}`
    );
  }

  if (entries.length === 0) {
    throw new Error(`${label} is unsafe: ${catalogSkillUrlsFilename} contains no generated skill URLs`);
  }

  const missingSkillPages = [];
  for (const [catalogSkillId, urlPath] of entries) {
    const relativePath = path.posix.join(urlPath.replace(/^\/+/, ""), "index.html");
    if (!(await isFile(path.join(rootDir, relativePath)))) {
      missingSkillPages.push(`${catalogSkillId} -> ${relativePath}`);
    }
  }

  if (missingSkillPages.length > 0) {
    throw new Error(
      `${label} is unsafe: catalog skill URL asset maps missing generated pages: ${missingSkillPages.join(", ")}`
    );
  }
}

export function extractUpdateAssetPaths(appcastXml) {
  const paths = new Set();
  const urlPattern = /\burl="([^"]+)"/g;

  for (const match of appcastXml.matchAll(urlPattern)) {
    try {
      const parsed = new URL(match[1]);
      if (parsed.pathname.startsWith("/updates/")) {
        paths.add(parsed.pathname.replace(/^\/+/, ""));
      }
    } catch {
      // Ignore unrelated malformed URLs; the appcast update requirement below remains strict.
    }
  }

  return [...paths].sort();
}

export async function requiredReleaseAssetPaths(rootDir) {
  const appcastPath = path.join(rootDir, "appcast.xml");
  let appcastXml;
  try {
    appcastXml = await readFile(appcastPath, "utf8");
  } catch {
    throw new Error(`release deploy artifact is unsafe: missing appcast.xml`);
  }

  const updateAssets = extractUpdateAssetPaths(appcastXml);
  if (updateAssets.length === 0) {
    throw new Error(`release deploy artifact is unsafe: appcast.xml has no /updates/ assets`);
  }
  return [...requiredStaticReleaseAssets, ...updateAssets];
}

export async function verifyReleaseDeployArtifacts(rootDir, label = "deploy artifact") {
  const requiredAssets = await requiredReleaseAssetPaths(rootDir);
  const missing = [];

  for (const relativePath of requiredAssets) {
    if (!(await isFile(path.join(rootDir, relativePath)))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(`${label} is unsafe: missing release assets: ${missing.join(", ")}`);
  }
}

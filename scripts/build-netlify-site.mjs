#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyWebLibraryDeployArtifacts } from "./deploy-artifact-guard.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const siteDir = path.join(repoRoot, "site");
const portalDir = path.join(repoRoot, "portal");
const portalDist = path.join(portalDir, "dist");
const outputDir = path.join(repoRoot, "dist", "netlify-site");
const outputAppDir = path.join(outputDir, "app");

const appDomainRedirects = [
  "https://app.omgskills.com/app/assets/*  /app/assets/:splat  200!",
  "http://app.omgskills.com/app/assets/*   /app/assets/:splat  200!",
  "https://app.omgskills.com/assets/*      /app/assets/:splat  200!",
  "http://app.omgskills.com/assets/*       /app/assets/:splat  200!",
  "https://app.omgskills.com/*             /app/index.html     200!",
  "http://app.omgskills.com/*              /app/index.html     200!"
];

const previewPortalRedirects = [
  "/app/*  /app/index.html  200"
];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function mergeRedirects() {
  const siteRedirectsPath = path.join(siteDir, "_redirects");
  const outputRedirectsPath = path.join(outputDir, "_redirects");
  const siteRedirects = (await exists(siteRedirectsPath))
    ? await readFile(siteRedirectsPath, "utf8")
    : "";
  const staticProfileRedirects = [];
  const profilesDir = path.join(outputDir, "profiles");
  if (await exists(profilesDir)) {
    const entries = await readdir(profilesDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !(await exists(path.join(profilesDir, entry.name, "index.html")))) {
        continue;
      }
      staticProfileRedirects.push(
        `/profiles/${entry.name}  /profiles/${entry.name}/index.html  200!`,
        `/profiles/${entry.name}/  /profiles/${entry.name}/index.html  200!`
      );
    }
  }
  const merged = [
    "# app.omgskills.com portal rewrites",
    ...appDomainRedirects,
    "",
    "# generated web library profiles",
    ...staticProfileRedirects,
    "/profiles/:handle  /__profile/:handle  200!",
    "",
    "# existing omgskills.com redirects",
    siteRedirects.trim(),
    "",
    "# deploy-preview portal fallback",
    ...previewPortalRedirects
  ]
    .filter(Boolean)
    .join("\n");

  await writeFile(outputRedirectsPath, `${merged}\n`);
}

async function verifyRequiredOutput() {
  const required = [
    "index.html",
    "app/index.html",
    "data/manifest.json",
    "data/v2/manifest.json",
    "appcast.xml"
  ];

  const missing = [];
  for (const relativePath of required) {
    if (!(await exists(path.join(outputDir, relativePath)))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Combined Netlify output is missing: ${missing.join(", ")}`);
  }
}

async function main() {
  run("npm", ["--workspace", "portal", "run", "build"]);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(siteDir, outputDir, { recursive: true });
  await verifyWebLibraryDeployArtifacts(outputDir, "Netlify deploy artifact");
  await rm(outputAppDir, { recursive: true, force: true });
  await cp(portalDist, outputAppDir, { recursive: true });
  await mergeRedirects();
  await verifyRequiredOutput();

  console.log(`Netlify deploy output ready: ${path.relative(repoRoot, outputDir)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

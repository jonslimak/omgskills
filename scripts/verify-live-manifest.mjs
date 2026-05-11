#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const localManifestPath = join(repoRoot, "site", "data", "manifest.json");
const liveUrl = process.env.LIVE_MANIFEST_URL ?? "https://omgskills.com/data/manifest.json";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const localManifest = JSON.parse(readFileSync(localManifestPath, "utf8"));
const response = await fetch(liveUrl, { headers: { "cache-control": "no-cache" } });
if (!response.ok) {
  console.error(`verify-live-manifest: live manifest request failed with ${response.status}`);
  process.exit(1);
}

const liveManifest = await response.json();
if (JSON.stringify(stable(localManifest)) !== JSON.stringify(stable(liveManifest))) {
  console.error("verify-live-manifest: live manifest does not match local manifest");
  process.exit(1);
}

console.log("verify-live-manifest: ok");

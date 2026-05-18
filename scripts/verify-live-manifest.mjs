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

const maxAttempts = Number.parseInt(process.env.LIVE_MANIFEST_VERIFY_ATTEMPTS ?? "12", 10);
const delayMs = Number.parseInt(process.env.LIVE_MANIFEST_VERIFY_DELAY_MS ?? "5000", 10);
const expected = JSON.stringify(stable(localManifest));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const response = await fetch(liveUrl, { headers: { "cache-control": "no-cache" } });
  if (!response.ok) {
    console.error(`verify-live-manifest: live manifest request failed with ${response.status}`);
  } else {
    const liveManifest = await response.json();
    if (JSON.stringify(stable(liveManifest)) === expected) {
      console.log("verify-live-manifest: ok");
      process.exit(0);
    }
  }

  if (attempt < maxAttempts) {
    console.error(`verify-live-manifest: waiting for live manifest (${attempt}/${maxAttempts})`);
    await sleep(delayMs);
  }
}

console.error("verify-live-manifest: live manifest does not match local manifest");
process.exit(1);

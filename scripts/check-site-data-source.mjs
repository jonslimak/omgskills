#!/usr/bin/env node

import { readFileSync } from "node:fs";

const pages = [
  "site/index.html",
  "site/data/index.html",
];

const failures = [];

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  if (!html.includes("/data/v2/manifest.json")) {
    failures.push(`${page} does not reference /data/v2/manifest.json`);
  }
  if (!html.includes("falling back to legacy data")) {
    failures.push(`${page} does not keep legacy manifest as explicit fallback`);
  }

  const v2Index = html.indexOf('loadHomepageData("v2")') >= 0
    ? html.indexOf('loadHomepageData("v2")')
    : html.indexOf('loadLeaderboardsFromTrack("v2")');
  const legacyIndex = html.indexOf('loadHomepageData("legacy")') >= 0
    ? html.indexOf('loadHomepageData("legacy")')
    : html.indexOf('loadLeaderboardsFromTrack("legacy")');

  if (v2Index === -1 || legacyIndex === -1) {
    failures.push(`${page} must load v2 first and legacy only as fallback`);
  } else if (legacyIndex < v2Index) {
    failures.push(`${page} loads legacy data before v2 data`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("site data source check passed");

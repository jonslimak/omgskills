#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const shadowDir = join(repoRoot, "index", "shadow");
const dataDir = join(repoRoot, "site", "data", "crawl4");
const reportPath = join(shadowDir, "shadow-report.json");
const cutoverSkillsPath = join(shadowDir, "skills.cutover.shadow.json");
const trendingPath = join(repoRoot, "index", "trending.json");
const xTrendingPath = join(repoRoot, "index", "x-trending.json");

function fail(message) {
  console.error(`publish-crawl4-data: ${message}`);
  process.exit(1);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeJsonAsset(prefix, value) {
  const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const hash = sha256Hex(data);
  const filename = `${prefix}-${hash.slice(0, 12)}.json`;
  writeFileSync(join(dataDir, filename), data);
  return { path: filename, sha256: hash, bytes: data.length };
}

function pruneOldAssets(manifest) {
  const manifestAssets = new Set(
    [manifest.skills, manifest.trending, manifest.xTrending]
      .map((asset) => asset?.path)
      .filter(Boolean),
  );
  for (const prefix of ["skills", "trending", "x-trending"]) {
    const files = readdirSync(dataDir)
      .filter((file) => file.startsWith(`${prefix}-`) && file.endsWith(".json"))
      .filter((file) => !manifestAssets.has(file))
      .sort((a, b) => statSync(join(dataDir, b)).mtimeMs - statSync(join(dataDir, a)).mtimeMs);
    for (const file of files.slice(1)) {
      rmSync(join(dataDir, file), { force: true });
    }
  }
}

if (!existsSync(reportPath)) fail("missing index/shadow/shadow-report.json; run npm run scrape:shadow first");
if (!existsSync(cutoverSkillsPath)) fail("missing index/shadow/skills.cutover.shadow.json; run npm run scrape:shadow first");
if (!existsSync(trendingPath)) fail("missing index/trending.json; run npm run scrape:trending first");

const report = loadJson(reportPath);
if (!report.cutoverValidationPassed) {
  fail("cutover validation did not pass");
}

const skills = loadJson(cutoverSkillsPath);
if (!Array.isArray(skills) || skills.length === 0) {
  fail("cutover skills must be a non-empty array");
}

const skillIds = new Set(skills.map((skill) => skill?.id).filter(Boolean));
const trending = loadJson(trendingPath).filter((entry) => skillIds.has(entry?.id));
const manifest = {
  version: 1,
  generatedAt: report.checkedAt ?? new Date().toISOString(),
};

mkdirSync(dataDir, { recursive: true });
manifest.skills = writeJsonAsset("skills", skills);
manifest.trending = writeJsonAsset("trending", trending);

if (existsSync(xTrendingPath)) {
  const sourceXTrending = loadJson(xTrendingPath);
  if (!Array.isArray(sourceXTrending)) {
    fail("index/x-trending.json must be an array");
  }
  const filteredXTrending = sourceXTrending.filter((skill) => skillIds.has(skill?.id));
  const xTrending = filteredXTrending.length > 0 ? filteredXTrending : sourceXTrending;
  if (sourceXTrending.length > 0 && xTrending.length === 0) {
    fail("refusing to publish empty xTrending from a non-empty source");
  }
  manifest.xTrending = writeJsonAsset("x-trending", xTrending);
}

writeFileSync(join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
pruneOldAssets(manifest);

console.log("✓ Published Crawl 4 data");
console.log(`  ${join(dataDir, "manifest.json")}`);
console.log(`  ${join(dataDir, manifest.skills.path)}`);
console.log(`  ${join(dataDir, manifest.trending.path)}`);
if (manifest.xTrending) {
  console.log(`  ${join(dataDir, manifest.xTrending.path)}`);
}

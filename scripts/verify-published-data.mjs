#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dataDir = join(repoRoot, "site", "data");
const manifestPath = join(dataDir, "manifest.json");

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function fail(message) {
  console.error(`verify-published-data: ${message}`);
  process.exit(1);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertAsset(name, asset) {
  if (!asset?.path || !asset?.sha256 || typeof asset.bytes !== "number") {
    fail(`${name} asset is incomplete in manifest`);
  }

  const assetPath = join(dataDir, asset.path);
  if (!existsSync(assetPath)) {
    fail(`${name} asset file is missing: ${asset.path}`);
  }

  const data = readFileSync(assetPath);
  const bytes = statSync(assetPath).size;
  const hash = sha256Hex(data);

  if (bytes !== asset.bytes) {
    fail(`${name} byte count mismatch: manifest=${asset.bytes} actual=${bytes}`);
  }
  if (hash !== asset.sha256) {
    fail(`${name} sha256 mismatch`);
  }

  return { path: assetPath, decoded: JSON.parse(data.toString("utf8")) };
}

const manifest = loadJson(manifestPath);
if (typeof manifest.version !== "number") {
  fail("manifest version missing");
}

const skills = assertAsset("skills", manifest.skills);
const trending = assertAsset("trending", manifest.trending);
const trendingLeaderboard = manifest.trendingLeaderboard
  ? assertAsset("trendingLeaderboard", manifest.trendingLeaderboard)
  : null;
const leaderboardViewData = manifest.leaderboardViewData
  ? assertAsset("leaderboardViewData", manifest.leaderboardViewData)
  : null;
const xTrending = manifest.xTrending ? assertAsset("xTrending", manifest.xTrending) : null;
const skillSignals = manifest.skillSignals ? assertAsset("skillSignals", manifest.skillSignals) : null;
const authorSignals = manifest.authorSignals ? assertAsset("authorSignals", manifest.authorSignals) : null;
const authorLeaderboards = manifest.authorLeaderboards ? assertAsset("authorLeaderboards", manifest.authorLeaderboards) : null;

if (!Array.isArray(skills.decoded)) fail("skills payload must be an array");
if (!Array.isArray(trending.decoded)) fail("trending payload must be an array");
if (trendingLeaderboard && !Array.isArray(trendingLeaderboard.decoded)) {
  fail("trendingLeaderboard payload must be an array");
}
if (leaderboardViewData && (!leaderboardViewData.decoded || Array.isArray(leaderboardViewData.decoded))) {
  fail("leaderboardViewData payload must be an object");
}
if (xTrending && !Array.isArray(xTrending.decoded)) fail("xTrending payload must be an array");
if (skillSignals && !Array.isArray(skillSignals.decoded)) fail("skillSignals payload must be an array");
if (authorSignals && !Array.isArray(authorSignals.decoded)) fail("authorSignals payload must be an array");
if (authorLeaderboards && !Array.isArray(authorLeaderboards.decoded)) fail("authorLeaderboards payload must be an array");

const skillIds = new Set(skills.decoded.map((item) => item?.id).filter(Boolean));
const authorHandles = new Set(skills.decoded.map((item) => item?.author_handle).filter(Boolean));
for (const entry of trending.decoded) {
  if (!entry?.id || !skillIds.has(entry.id)) {
    fail(`trending entry missing matching skill id: ${entry?.id ?? "<missing>"}`);
  }
}

for (const entry of trendingLeaderboard?.decoded ?? []) {
  if (!entry?.id || !skillIds.has(entry.id)) {
    fail(`trendingLeaderboard entry missing matching skill id: ${entry?.id ?? "<missing>"}`);
  }
  if (!entry.name || !entry.authorHandle || typeof entry.installs !== "number") {
    fail(`trendingLeaderboard entry is missing required display fields: ${entry.id}`);
  }
}

if (leaderboardViewData) {
  const data = leaderboardViewData.decoded;
  if (!Array.isArray(data.topSkills) || data.topSkills.length !== 10) {
    fail("leaderboardViewData.topSkills must contain 10 rows");
  }
  if (!Array.isArray(data.creatorCategories) || data.creatorCategories.length !== 6) {
    fail("leaderboardViewData.creatorCategories must contain 6 categories");
  }
  if (!Array.isArray(data.allRounders)) {
    fail("leaderboardViewData.allRounders must be an array");
  }
  for (const skill of data.topSkills) {
    if (!skill?.id || !skill.name || !skill.authorHandle || typeof skill.installs !== "number") {
      fail("leaderboardViewData.topSkills contains an invalid row");
    }
  }
  for (const category of data.creatorCategories) {
    if (!category?.id || !category.title || !Array.isArray(category.rows) || category.rows.length === 0) {
      fail(`leaderboardViewData creator category is invalid: ${category?.id ?? "<missing>"}`);
    }
  }
}

for (const entry of skillSignals?.decoded ?? []) {
  if (!entry?.id || !skillIds.has(entry.id)) {
    fail(`skillSignals entry missing matching skill id: ${entry?.id ?? "<missing>"}`);
  }
}

for (const entry of authorSignals?.decoded ?? []) {
  if (!entry?.authorHandle || !authorHandles.has(entry.authorHandle)) {
    fail(`authorSignals entry missing matching author handle: ${entry?.authorHandle ?? "<missing>"}`);
  }
  for (const skillId of entry?.topSkillIds ?? []) {
    if (!skillIds.has(skillId)) {
      fail(`authorSignals top skill missing from skills payload: ${skillId}`);
    }
  }
}

for (const entry of authorLeaderboards?.decoded ?? []) {
  if (!entry?.authorHandle || !authorHandles.has(entry.authorHandle)) {
    fail(`authorLeaderboards entry missing matching author handle: ${entry?.authorHandle ?? "<missing>"}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      skillsCount: skills.decoded.length,
      trendingCount: trending.decoded.length,
      trendingLeaderboardCount: trendingLeaderboard?.decoded.length ?? 0,
      leaderboardViewDataCategories: leaderboardViewData?.decoded?.creatorCategories?.length ?? 0,
      xTrendingCount: xTrending?.decoded.length ?? 0,
      skillSignalsCount: skillSignals?.decoded.length ?? 0,
      authorSignalsCount: authorSignals?.decoded.length ?? 0,
      authorLeaderboardsCount: authorLeaderboards?.decoded.length ?? 0,
    },
    null,
    2,
  ),
);

#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dataDir = join(repoRoot, "site", "data");
const manifestPath = join(dataDir, "manifest.json");
const healthPath = join(dataDir, "health.json");

function loadJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeValue(value) {
  return value === "" ? null : value;
}

const previous = loadJson(healthPath, {}) ?? {};
const manifest = loadJson(manifestPath, {});

function countItems(asset) {
  if (!asset?.path) return null;
  const path = join(dataDir, asset.path);
  if (!existsSync(path)) return null;
  const decoded = loadJson(path, null);
  if (decoded?.topSkills && Array.isArray(decoded.topSkills)) return decoded.topSkills.length;
  return Array.isArray(decoded) ? decoded.length : null;
}

function fileGeneratedAt(sourcePath, previousValue = null) {
  if (!sourcePath || !existsSync(sourcePath)) return previousValue;
  return new Date(statSync(sourcePath).mtimeMs).toISOString();
}

const indexDir = join(repoRoot, "index");
const skillsSource = join(indexDir, "skills.json");
const trendingSource = join(indexDir, "trending.json");
const trendingLeaderboardSource = join(indexDir, "trending-leaderboard.json");
const leaderboardViewDataSource = join(indexDir, "leaderboard-view-data.json");
const xTrendingSource = join(indexDir, "x-trending.json");
const skillSignalsSource = join(indexDir, "skill-signals.json");
const authorSignalsSource = join(indexDir, "author-signals.json");
const authorLeaderboardsSource = join(indexDir, "author-leaderboards.json");
const goldBasketSource = join(indexDir, "gold-basket.json");
const statsSource = join(indexDir, "stats.json");
const dashboardSource = join(indexDir, "dashboard.html");
const snapshotsDir = join(indexDir, "snapshots");

function latestBasketEnrichedAt(previousValue = null) {
  if (!existsSync(goldBasketSource)) return previousValue;
  const basket = loadJson(goldBasketSource, []);
  if (!Array.isArray(basket) || basket.length === 0) return previousValue;
  const enrichedValues = basket
    .map((item) => item?.gh_enriched_at)
    .filter((value) => typeof value === "string");
  if (enrichedValues.length === 0) return previousValue;
  return enrichedValues.sort().at(-1) ?? previousValue;
}

function countSnapshots() {
  if (!existsSync(snapshotsDir)) return 0;
  try {
    return readdirSync(snapshotsDir).filter((name) => /^trending-\d{4}-\d{2}-\d{2}\.json$/.test(name)).length;
  } catch {
    return 0;
  }
}

const health = {
  version: 1,
  status: process.env.HEALTH_STATUS ?? previous.status ?? "ok",
  message: process.env.HEALTH_MESSAGE ?? previous.message ?? null,
  checkedAt: process.env.HEALTH_CHECKED_AT ?? isoNow(),
  publishedAt: normalizeValue(process.env.HEALTH_PUBLISHED_AT ?? previous.publishedAt) ?? null,
  deployedAt: normalizeValue(process.env.HEALTH_DEPLOYED_AT ?? previous.deployedAt) ?? null,
  lastSuccessfulScrapeAt: normalizeValue(process.env.HEALTH_LAST_SCRAPE_SUCCESS_AT ?? previous.lastSuccessfulScrapeAt) ?? null,
  lastSuccessfulXRefreshAt: normalizeValue(process.env.HEALTH_LAST_X_REFRESH_SUCCESS_AT ?? previous.lastSuccessfulXRefreshAt) ?? null,
  lastSuccessfulContentReportAt: normalizeValue(process.env.HEALTH_LAST_CONTENT_REPORT_SUCCESS_AT ?? previous.lastSuccessfulContentReportAt) ?? null,
  workflow: process.env.HEALTH_WORKFLOW ?? previous.workflow ?? null,
  runId: process.env.HEALTH_RUN_ID ?? previous.runId ?? null,
  gitSha: process.env.HEALTH_GIT_SHA ?? previous.gitSha ?? null,
  manifestPath: "data/manifest.json",
  manifestGeneratedAt: manifest.generatedAt ?? previous.manifestGeneratedAt ?? null,
  assets: {
    skills: manifest.skills
      ? {
          path: manifest.skills.path,
          count: countItems(manifest.skills),
          generatedAt: fileGeneratedAt(skillsSource, previous.assets?.skills?.generatedAt ?? null),
        }
      : null,
    trending: manifest.trending
      ? {
          path: manifest.trending.path,
          count: countItems(manifest.trending),
          generatedAt: fileGeneratedAt(trendingSource, previous.assets?.trending?.generatedAt ?? null),
        }
      : null,
    trendingLeaderboard: manifest.trendingLeaderboard
      ? {
          path: manifest.trendingLeaderboard.path,
          count: countItems(manifest.trendingLeaderboard),
          generatedAt: fileGeneratedAt(
            trendingLeaderboardSource,
            previous.assets?.trendingLeaderboard?.generatedAt ?? null,
          ),
        }
      : null,
    leaderboardViewData: manifest.leaderboardViewData
      ? {
          path: manifest.leaderboardViewData.path,
          count: countItems(manifest.leaderboardViewData),
          generatedAt: fileGeneratedAt(
            leaderboardViewDataSource,
            previous.assets?.leaderboardViewData?.generatedAt ?? null,
          ),
        }
      : null,
    xTrending: manifest.xTrending
      ? {
          path: manifest.xTrending.path,
          count: countItems(manifest.xTrending),
          generatedAt: fileGeneratedAt(xTrendingSource, previous.assets?.xTrending?.generatedAt ?? null),
        }
      : null,
    skillSignals: manifest.skillSignals
      ? {
          path: manifest.skillSignals.path,
          count: countItems(manifest.skillSignals),
          generatedAt: fileGeneratedAt(skillSignalsSource, previous.assets?.skillSignals?.generatedAt ?? null),
        }
      : null,
    authorSignals: manifest.authorSignals
      ? {
          path: manifest.authorSignals.path,
          count: countItems(manifest.authorSignals),
          generatedAt: fileGeneratedAt(authorSignalsSource, previous.assets?.authorSignals?.generatedAt ?? null),
        }
      : null,
    authorLeaderboards: manifest.authorLeaderboards
      ? {
          path: manifest.authorLeaderboards.path,
          count: countItems(manifest.authorLeaderboards),
          generatedAt: fileGeneratedAt(authorLeaderboardsSource, previous.assets?.authorLeaderboards?.generatedAt ?? null),
        }
      : null,
  },
  content: {
    goldBasketGeneratedAt: fileGeneratedAt(goldBasketSource, previous.content?.goldBasketGeneratedAt ?? null),
    basketEnrichedAt: latestBasketEnrichedAt(previous.content?.basketEnrichedAt ?? null),
    statsGeneratedAt: fileGeneratedAt(statsSource, previous.content?.statsGeneratedAt ?? null),
    dashboardGeneratedAt: fileGeneratedAt(dashboardSource, previous.content?.dashboardGeneratedAt ?? null),
    snapshotCount: countSnapshots(),
  },
};

const coreOk = Boolean(health.assets.skills?.count) &&
  Boolean(health.assets.trending?.count) &&
  Boolean(health.assets.trendingLeaderboard?.count) &&
  Boolean(health.assets.leaderboardViewData?.path);
const xOk = Boolean(health.assets.xTrending?.count);
const overlaysOk = Boolean(health.assets.skillSignals?.count) &&
  Boolean(health.assets.authorSignals?.count) &&
  Boolean(health.assets.authorLeaderboards?.count);
const contentOk = Boolean(health.content.goldBasketGeneratedAt) &&
  Boolean(health.content.statsGeneratedAt) &&
  Boolean(health.content.dashboardGeneratedAt) &&
  Boolean(health.content.basketEnrichedAt);

health.sections = {
  core: {
    status: coreOk ? "ok" : "degraded",
    skillsCount: health.assets.skills?.count ?? 0,
    trendingCount: health.assets.trending?.count ?? 0,
    trendingLeaderboardCount: health.assets.trendingLeaderboard?.count ?? 0,
    leaderboardViewDataPath: health.assets.leaderboardViewData?.path ?? null,
    lastSuccessfulScrapeAt: health.lastSuccessfulScrapeAt,
  },
  x: {
    status: xOk ? "ok" : "degraded",
    xTrendingCount: health.assets.xTrending?.count ?? 0,
    lastSuccessfulXRefreshAt: health.lastSuccessfulXRefreshAt,
  },
  overlays: {
    status: overlaysOk ? "ok" : "degraded",
    skillSignalsCount: health.assets.skillSignals?.count ?? 0,
    authorSignalsCount: health.assets.authorSignals?.count ?? 0,
    authorLeaderboardsCount: health.assets.authorLeaderboards?.count ?? 0,
  },
  contentReports: {
    status: contentOk ? "ok" : "degraded",
    lastSuccessfulContentReportAt: health.lastSuccessfulContentReportAt,
    basketEnrichedAt: health.content.basketEnrichedAt,
    snapshotCount: health.content.snapshotCount,
  },
};

writeFileSync(healthPath, JSON.stringify(health, null, 2) + "\n", "utf8");
console.log(healthPath);

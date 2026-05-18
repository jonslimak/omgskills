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

function envOrPrevious(name, previousValue) {
  return normalizeValue(process.env[name]) ?? previousValue ?? null;
}

function parseJsonValue(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function withCheckMetadata(name, current, checkedAt) {
  const previousSection = previous.sections?.[name] ?? {};
  const status = current.status ?? "degraded";
  return {
    ...current,
    checkedAt: current.checkedAt ?? checkedAt,
    lastPassedAt: status === "ok"
      ? (current.checkedAt ?? checkedAt)
      : (previousSection.lastPassedAt ?? null),
  };
}

const previous = loadJson(healthPath, {}) ?? {};
const manifest = loadJson(manifestPath, {});
const productHealth = parseJsonValue(process.env.HEALTH_PRODUCT_JSON, previous.productHealth ?? null);
const marketingFunnel = parseJsonValue(process.env.HEALTH_MARKETING_FUNNEL_JSON, previous.sections?.marketingFunnel ?? null);
const pipelineStatus = process.env.HEALTH_PIPELINE_STATUS ?? process.env.HEALTH_STATUS ?? previous.pipeline?.status ?? previous.status ?? "ok";
const pipelineMessage = process.env.HEALTH_PIPELINE_MESSAGE ?? process.env.HEALTH_MESSAGE ?? previous.pipeline?.message ?? previous.message ?? null;

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
  status: pipelineStatus,
  message: pipelineMessage,
  checkedAt: process.env.HEALTH_CHECKED_AT ?? isoNow(),
  publishedAt: envOrPrevious("HEALTH_PUBLISHED_AT", previous.publishedAt),
  deployedAt: envOrPrevious("HEALTH_DEPLOYED_AT", previous.deployedAt),
  lastSuccessfulScrapeAt: envOrPrevious("HEALTH_LAST_SCRAPE_SUCCESS_AT", previous.lastSuccessfulScrapeAt),
  lastSuccessfulXRefreshAt: envOrPrevious("HEALTH_LAST_X_REFRESH_SUCCESS_AT", previous.lastSuccessfulXRefreshAt),
  lastSuccessfulContentReportAt: envOrPrevious(
    "HEALTH_LAST_CONTENT_REPORT_SUCCESS_AT",
    previous.lastSuccessfulContentReportAt,
  ),
  workflow: process.env.HEALTH_WORKFLOW ?? previous.workflow ?? null,
  runId: process.env.HEALTH_RUN_ID ?? previous.runId ?? null,
  gitSha: process.env.HEALTH_GIT_SHA ?? previous.gitSha ?? null,
  manifestPath: "data/manifest.json",
  manifestGeneratedAt: manifest.generatedAt ?? previous.manifestGeneratedAt ?? null,
  pipeline: {
    status: pipelineStatus,
    message: pipelineMessage,
  },
  productHealth,
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

const scrapeMaxAgeHours = Number(process.env.SCRAPE_MAX_AGE_HOURS ?? 36);
const xMaxAgeHours = Number(process.env.X_MAX_AGE_HOURS ?? 30);
const contentMaxAgeHours = Number(process.env.CONTENT_MAX_AGE_HOURS ?? 192);
const crawlIssues = [];
if (!health.lastSuccessfulScrapeAt) {
  crawlIssues.push("No successful scrape run found");
} else if (hoursSince(health.lastSuccessfulScrapeAt) > scrapeMaxAgeHours) {
  crawlIssues.push(`scrape is stale (${hoursSince(health.lastSuccessfulScrapeAt).toFixed(1)}h)`);
}
if (!health.lastSuccessfulXRefreshAt) {
  crawlIssues.push("No successful x-refresh run found");
} else if (hoursSince(health.lastSuccessfulXRefreshAt) > xMaxAgeHours) {
  crawlIssues.push(`x-refresh is stale (${hoursSince(health.lastSuccessfulXRefreshAt).toFixed(1)}h)`);
}
if (!health.lastSuccessfulContentReportAt) {
  crawlIssues.push("No successful content-reports run found");
} else if (hoursSince(health.lastSuccessfulContentReportAt) > contentMaxAgeHours) {
  crawlIssues.push(`content-reports is stale (${hoursSince(health.lastSuccessfulContentReportAt).toFixed(1)}h)`);
}

health.sections = {
  crawl: withCheckMetadata("crawl", {
    status: crawlIssues.length === 0 ? "ok" : "degraded",
    issues: crawlIssues,
    lastSuccessfulScrapeAt: health.lastSuccessfulScrapeAt,
    lastSuccessfulXRefreshAt: health.lastSuccessfulXRefreshAt,
    lastSuccessfulContentReportAt: health.lastSuccessfulContentReportAt,
  }, health.checkedAt),
  core: withCheckMetadata("core", {
    status: coreOk ? "ok" : "degraded",
    skillsCount: health.assets.skills?.count ?? 0,
    trendingCount: health.assets.trending?.count ?? 0,
    trendingLeaderboardCount: health.assets.trendingLeaderboard?.count ?? 0,
    leaderboardViewDataPath: health.assets.leaderboardViewData?.path ?? null,
    lastSuccessfulScrapeAt: health.lastSuccessfulScrapeAt,
  }, health.checkedAt),
  x: withCheckMetadata("x", {
    status: xOk ? "ok" : "degraded",
    xTrendingCount: health.assets.xTrending?.count ?? 0,
    lastSuccessfulXRefreshAt: health.lastSuccessfulXRefreshAt,
  }, health.checkedAt),
  overlays: withCheckMetadata("overlays", {
    status: overlaysOk ? "ok" : "degraded",
    skillSignalsCount: health.assets.skillSignals?.count ?? 0,
    authorSignalsCount: health.assets.authorSignals?.count ?? 0,
    authorLeaderboardsCount: health.assets.authorLeaderboards?.count ?? 0,
  }, health.checkedAt),
  contentReports: withCheckMetadata("contentReports", {
    status: contentOk ? "ok" : "degraded",
    lastSuccessfulContentReportAt: health.lastSuccessfulContentReportAt,
    basketEnrichedAt: health.content.basketEnrichedAt,
    snapshotCount: health.content.snapshotCount,
  }, health.checkedAt),
};

for (const name of ["download", "updates", "dataRefresh", "search"]) {
  const current = productHealth?.sections?.[name];
  if (current) {
    health.sections[name] = withCheckMetadata(name, current, health.checkedAt);
  }
}

if (marketingFunnel) {
  health.sections.marketingFunnel = withCheckMetadata("marketingFunnel", marketingFunnel, health.checkedAt);
}

const sectionIssues = Object.values(health.sections)
  .flatMap((section) => Array.isArray(section.issues) ? section.issues : []);
const messages = [
  pipelineStatus === "ok" ? null : pipelineMessage,
  productHealth?.status === "ok" ? null : productHealth?.message,
  ...sectionIssues,
].filter(Boolean);
const anySectionDegraded = Object.values(health.sections).some((section) => section.status !== "ok");
health.status = pipelineStatus === "ok" && productHealth?.status !== "degraded" && !anySectionDegraded ? "ok" : "degraded";
health.message = health.status === "ok" ? "All health checks passed" : [...new Set(messages)].join("; ");

writeFileSync(healthPath, JSON.stringify(health, null, 2) + "\n", "utf8");
console.log(healthPath);

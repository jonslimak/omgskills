#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dataDir = join(repoRoot, "site", "data");
const healthPath = join(dataDir, "health.json");
const previous = loadJson(healthPath, {}) ?? {};
const checkedAt = process.env.HEALTH_CHECKED_AT ?? isoNow();

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

function withCheckMetadata(name, current) {
  const previousSection = previous.sections?.[name] ?? {};
  const status = current?.status ?? "degraded";
  return {
    ...(current ?? {}),
    checkedAt: current?.checkedAt ?? checkedAt,
    lastPassedAt: status === "ok"
      ? (current?.checkedAt ?? checkedAt)
      : (previousSection.lastPassedAt ?? null),
  };
}

function countItems(asset, trackDir = dataDir) {
  if (!asset?.path) return null;
  const path = join(trackDir, asset.path);
  if (!existsSync(path)) return null;
  const decoded = loadJson(path, null);
  if (decoded?.topSkills && Array.isArray(decoded.topSkills)) return decoded.topSkills.length;
  return Array.isArray(decoded) ? decoded.length : null;
}

function fileGeneratedAt(sourcePath, previousValue = null) {
  if (!sourcePath || !existsSync(sourcePath)) return previousValue;
  return new Date(statSync(sourcePath).mtimeMs).toISOString();
}

function latestBasketEnrichedAt(goldBasketSource, previousValue = null) {
  if (!existsSync(goldBasketSource)) return previousValue;
  const basket = loadJson(goldBasketSource, []);
  if (!Array.isArray(basket) || basket.length === 0) return previousValue;
  const enrichedValues = basket
    .map((item) => item?.gh_enriched_at)
    .filter((value) => typeof value === "string");
  if (enrichedValues.length === 0) return previousValue;
  return enrichedValues.sort().at(-1) ?? previousValue;
}

function countSnapshots(snapshotsDir) {
  if (!existsSync(snapshotsDir)) return 0;
  try {
    return readdirSync(snapshotsDir).filter((name) => /^trending-\d{4}-\d{2}-\d{2}\.json$/.test(name)).length;
  } catch {
    return 0;
  }
}

const productHealth = parseJsonValue(process.env.HEALTH_PRODUCT_JSON, previous.productHealth ?? null);
const pipelineHealth = parseJsonValue(process.env.HEALTH_PIPELINE_JSON, previous.pipelineHealth ?? null);
const marketingFunnel = parseJsonValue(process.env.HEALTH_MARKETING_FUNNEL_JSON, previous.sections?.marketingFunnel ?? null);

const indexDir = join(repoRoot, "index");
const skillsSource = join(indexDir, "skills.json");
const trendingSource = join(indexDir, "trending.json");
const xTrendingSource = join(indexDir, "x-trending.json");
const skillSignalsSource = join(indexDir, "skill-signals.json");
const authorSignalsSource = join(indexDir, "author-signals.json");
const authorLeaderboardsSource = join(indexDir, "author-leaderboards.json");
const goldBasketSource = join(indexDir, "gold-basket.json");
const statsSource = join(indexDir, "stats.json");
const dashboardSource = join(indexDir, "dashboard.html");
const snapshotsDir = join(indexDir, "snapshots");
const shadowReportPath = join(indexDir, "shadow", "shadow-report.json");
const shadowReport = loadJson(shadowReportPath, null);

const legacyManifestPath = join(dataDir, "manifest.json");
const legacyManifest = loadJson(legacyManifestPath, null);
const v2Dir = join(dataDir, "v2");
const v2ManifestPath = join(v2Dir, "manifest.json");
const v2Manifest = loadJson(v2ManifestPath, null);

const health = {
  version: 2,
  status: "degraded",
  message: null,
  checkedAt,
  publishedAt: envOrPrevious("HEALTH_PUBLISHED_AT", previous.publishedAt),
  deployedAt: envOrPrevious("HEALTH_DEPLOYED_AT", previous.deployedAt),
  lastSuccessfulShadowCrawlerAt: envOrPrevious(
    "HEALTH_LAST_SHADOW_CRAWLER_SUCCESS_AT",
    pipelineHealth?.lastShadowCrawlerSuccessAt ?? previous.lastSuccessfulShadowCrawlerAt,
  ),
  lastSuccessfulContentReportAt: envOrPrevious(
    "HEALTH_LAST_CONTENT_REPORT_SUCCESS_AT",
    previous.lastSuccessfulContentReportAt,
  ),
  workflow: process.env.HEALTH_WORKFLOW ?? previous.workflow ?? null,
  runId: process.env.HEALTH_RUN_ID ?? previous.runId ?? null,
  gitSha: process.env.HEALTH_GIT_SHA ?? previous.gitSha ?? null,
  pipeline: {
    status: process.env.HEALTH_PIPELINE_STATUS ?? pipelineHealth?.status ?? previous.pipeline?.status ?? "ok",
    message: process.env.HEALTH_PIPELINE_MESSAGE ?? pipelineHealth?.message ?? previous.pipeline?.message ?? null,
  },
  productHealth,
  pipelineHealth,
  tracks: {
    legacy: legacyManifest
      ? {
          manifestPath: "data/manifest.json",
          manifestGeneratedAt: legacyManifest.generatedAt ?? null,
          skills: legacyManifest.skills
            ? {
                path: legacyManifest.skills.path,
                count: countItems(legacyManifest.skills, dataDir),
                generatedAt: fileGeneratedAt(skillsSource, previous.tracks?.legacy?.skills?.generatedAt ?? null),
              }
            : null,
          trending: legacyManifest.trending
            ? {
                path: legacyManifest.trending.path,
                count: countItems(legacyManifest.trending, dataDir),
                generatedAt: fileGeneratedAt(trendingSource, previous.tracks?.legacy?.trending?.generatedAt ?? null),
              }
            : null,
        }
      : null,
    v2: v2Manifest
      ? {
          manifestPath: "data/v2/manifest.json",
          manifestGeneratedAt: v2Manifest.generatedAt ?? null,
          skills: v2Manifest.skills
            ? {
                path: v2Manifest.skills.path,
                count: countItems(v2Manifest.skills, v2Dir),
                generatedAt: fileGeneratedAt(skillsSource, previous.tracks?.v2?.skills?.generatedAt ?? null),
              }
            : null,
          trending: v2Manifest.trending
            ? {
                path: v2Manifest.trending.path,
                count: countItems(v2Manifest.trending, v2Dir),
                generatedAt: fileGeneratedAt(trendingSource, previous.tracks?.v2?.trending?.generatedAt ?? null),
              }
            : null,
          xTrending: v2Manifest.xTrending
            ? {
                path: v2Manifest.xTrending.path,
                count: countItems(v2Manifest.xTrending, v2Dir),
                generatedAt: fileGeneratedAt(xTrendingSource, previous.tracks?.v2?.xTrending?.generatedAt ?? null),
              }
            : null,
        }
      : null,
  },
  assets: {
    skillSignals: legacyManifest?.skillSignals
      ? {
          path: legacyManifest.skillSignals.path,
          count: countItems(legacyManifest.skillSignals, dataDir),
          generatedAt: fileGeneratedAt(skillSignalsSource, previous.assets?.skillSignals?.generatedAt ?? null),
        }
      : null,
    authorSignals: legacyManifest?.authorSignals
      ? {
          path: legacyManifest.authorSignals.path,
          count: countItems(legacyManifest.authorSignals, dataDir),
          generatedAt: fileGeneratedAt(authorSignalsSource, previous.assets?.authorSignals?.generatedAt ?? null),
        }
      : null,
    authorLeaderboards: legacyManifest?.authorLeaderboards
      ? {
          path: legacyManifest.authorLeaderboards.path,
          count: countItems(legacyManifest.authorLeaderboards, dataDir),
          generatedAt: fileGeneratedAt(authorLeaderboardsSource, previous.assets?.authorLeaderboards?.generatedAt ?? null),
        }
      : null,
  },
  content: {
    goldBasketGeneratedAt: fileGeneratedAt(goldBasketSource, previous.content?.goldBasketGeneratedAt ?? null),
    basketEnrichedAt: latestBasketEnrichedAt(goldBasketSource, previous.content?.basketEnrichedAt ?? null),
    statsGeneratedAt: fileGeneratedAt(statsSource, previous.content?.statsGeneratedAt ?? null),
    dashboardGeneratedAt: fileGeneratedAt(dashboardSource, previous.content?.dashboardGeneratedAt ?? null),
    snapshotCount: countSnapshots(snapshotsDir),
  },
  shadow: shadowReport
    ? {
        checkedAt: shadowReport.checkedAt ?? null,
        status: shadowReport.status ?? null,
        cadence: shadowReport.cadence ?? null,
        cutoverValidationPassed: shadowReport.cutoverValidationPassed ?? null,
        shadowSkillCount: shadowReport.shadowSkillCount ?? null,
        repoCount: shadowReport.repoCount ?? null,
      }
    : null,
};

const contentOverlaysIssues = [];
if (!health.assets.skillSignals?.count) contentOverlaysIssues.push("skill-signals missing or empty");
if (!health.assets.authorSignals?.count) contentOverlaysIssues.push("author-signals missing or empty");
if (!health.assets.authorLeaderboards?.count) contentOverlaysIssues.push("author-leaderboards missing or empty");
if (!health.content.goldBasketGeneratedAt) contentOverlaysIssues.push("gold-basket is missing");
if (!health.content.statsGeneratedAt) contentOverlaysIssues.push("stats is missing");
if (!health.content.dashboardGeneratedAt) contentOverlaysIssues.push("dashboard is missing");
if (!health.content.basketEnrichedAt) contentOverlaysIssues.push("gold-basket enrichment is missing");

health.sections = {
  release: withCheckMetadata("release", productHealth?.sections?.release),
  v2AppData: withCheckMetadata("v2AppData", productHealth?.sections?.v2AppData),
  legacyData: withCheckMetadata("legacyData", productHealth?.sections?.legacyData),
  search: withCheckMetadata("search", productHealth?.sections?.search),
  crawlers: withCheckMetadata("crawlers", pipelineHealth?.sections?.crawlers ?? {
    status: "degraded",
    issues: ["No pipeline crawler health available"],
    lastSuccessfulShadowRunAt: health.lastSuccessfulShadowCrawlerAt,
  }),
  shadowCutover: withCheckMetadata("shadowCutover", pipelineHealth?.sections?.shadowCutover ?? {
    status: "degraded",
    issues: ["No shadow/cutover health available"],
  }),
  contentOverlays: withCheckMetadata("contentOverlays", contentOverlaysIssues.length
    ? {
        status: "degraded",
        issues: contentOverlaysIssues,
        skillSignalsCount: health.assets.skillSignals?.count ?? 0,
        authorSignalsCount: health.assets.authorSignals?.count ?? 0,
        authorLeaderboardsCount: health.assets.authorLeaderboards?.count ?? 0,
        lastSuccessfulContentReportAt: health.lastSuccessfulContentReportAt,
        basketEnrichedAt: health.content.basketEnrichedAt,
        snapshotCount: health.content.snapshotCount,
      }
    : {
        status: "ok",
        issues: [],
        skillSignalsCount: health.assets.skillSignals?.count ?? 0,
        authorSignalsCount: health.assets.authorSignals?.count ?? 0,
        authorLeaderboardsCount: health.assets.authorLeaderboards?.count ?? 0,
        lastSuccessfulContentReportAt: health.lastSuccessfulContentReportAt,
        basketEnrichedAt: health.content.basketEnrichedAt,
        snapshotCount: health.content.snapshotCount,
      }),
};

if (marketingFunnel) {
  health.sections.marketingFunnel = withCheckMetadata("marketingFunnel", marketingFunnel);
}

const sectionIssues = Object.entries(health.sections)
  .filter(([name]) => name !== "marketingFunnel")
  .flatMap(([, section]) => Array.isArray(section.issues) ? section.issues : []);
const messages = [
  health.pipeline.status === "ok" ? null : health.pipeline.message,
  productHealth?.status === "ok" ? null : productHealth?.message,
  ...sectionIssues,
].filter(Boolean);
const nonInformationalDegraded = Object.entries(health.sections)
  .filter(([name]) => name !== "marketingFunnel")
  .some(([, section]) => section.status !== "ok");

health.status = health.pipeline.status === "ok" && productHealth?.status !== "degraded" && !nonInformationalDegraded
  ? "ok"
  : "degraded";
health.message = health.status === "ok" ? "All health checks passed" : [...new Set(messages)].join("; ");

writeFileSync(healthPath, JSON.stringify(health, null, 2) + "\n", "utf8");
console.log(healthPath);

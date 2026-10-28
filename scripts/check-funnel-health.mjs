#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function loadEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function localDayBounds(daysBack = 0) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = json?.errors?.[0]?.message ?? json?.error ?? response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return json;
}

function safeRate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

// The landing page and public library entry points. /app/ may contain historical rows;
// this release deliberately does not load its automatic tracker there.
const webAppEntryPages = new Set(["/", "/developers/"]);
export const webAppEvents = {
  webSearches: "App Search",
  webSkillOpens: "App Skill Open",
  webCopyInstalls: "App Copy Install",
  webInstallStarts: "App Install Start",
  webSetupDownloads: "App Setup Download",
  webSignIns: "App Sign In",
  webGetMacAppClicks: "App Get Mac App",
};

export function isWebAppPage(row) {
  const path = row.path ?? row.page ?? "";
  return webAppEntryPages.has(path) || /^\/(?:app|library)(?:\/|$)/.test(path) || row.page_group === "app";
}

// The documented API supports limit, but not offset pagination.
export async function breakdownRows(url, headers) {
  const json = await fetchJson(`${url}&limit=50`, { headers });
  return Array.isArray(json?.data) ? json.data : [];
}

export function webAppFunnel(pages, clicks) {
  const funnel = { webVisitors: 0, webAppPageViews: 0 };
  for (const row of pages) {
    if ((row.path ?? row.page) === "/") funnel.webVisitors += Number(row.unique_visitors) || 0;
    if (isWebAppPage(row)) funnel.webAppPageViews += Number(row.page_views) || 0;
  }
  for (const [key, target] of Object.entries(webAppEvents)) {
    funnel[key] = clicks.flatMap((row) => row.top_targets ?? [row])
      .filter((item) => item.target === target)
      .reduce((total, item) => total + (Number(item.clicks) || 0), 0);
  }
  funnel.webSearchRate = safeRate(funnel.webSearches, funnel.webVisitors);
  funnel.webSetupDownloadRate = safeRate(funnel.webSetupDownloads, funnel.webVisitors);
  return funnel;
}

async function humblyticsMetrics() {
  const propertyId = requireEnv("HUMBLYTICS_PROPERTY_ID");
  const token = requireEnv("HUMBLYTICS_API_KEY");
  const timezone = process.env.FUNNEL_TIMEZONE ?? "America/New_York";
  const { start, end } = localDayBounds(0);
  const params = new URLSearchParams({ start, end, timezone });
  const base = `https://app.humblytics.com/api/external/v1/properties/${propertyId}`;
  const headers = { authorization: `Bearer ${token}` };

  const [summary, traffic, clicks, pageRows, clickRows] = await Promise.all([
    fetchJson(`${base}/traffic/summary?${params}`, { headers }),
    fetchJson(`${base}/traffic/breakdown?${params}`, { headers }),
    fetchJson(`${base}/clicks/details?${params}&page=/`, { headers }),
    breakdownRows(`${base}/pages/breakdown?${params}`, headers),
    breakdownRows(`${base}/clicks/breakdown?${params}`, headers),
  ]);

  const sessions = Number(summary?.data?.sessions ?? summary?.data?.total_sessions ?? summary?.sessions ?? 0);
  const pageViews = Number(summary?.data?.page_views ?? summary?.data?.pageviews ?? summary?.page_views ?? 0);
  const paidX = (traffic?.data?.utm ?? [])
    .filter((row) => ["x", "twitter"].includes(String(row.source ?? "").toLowerCase()) ||
      String(row.medium ?? "").toLowerCase().includes("paid"))
    .reduce((total, row) => ({
      sessions: total.sessions + (Number(row.sessions) || 0),
      pageViews: total.pageViews + (Number(row.page_views) || 0),
    }), { sessions: 0, pageViews: 0 });

  const cta = { hero: 0, reviews: 0, legacy: 0, total: 0, uniqueSessions: 0, paidXDownloads: 0 };
  for (const click of clicks?.data?.clicks ?? []) {
    const target = String(click.target ?? "");
    const secondary = String(click.secondary ?? "");
    const isDownload = target === "Hero Download Mac DMG" ||
      target === "Reviews Download Mac DMG" ||
      secondary === "/downloads/omgskills-mac.dmg";
    if (!isDownload) continue;

    const clickCount = Number(click.clicks) || 0;
    cta.total += clickCount;
    cta.uniqueSessions += Number(click.unique_sessions) || 0;
    if (target === "Hero Download Mac DMG") cta.hero += clickCount;
    else if (target === "Reviews Download Mac DMG") cta.reviews += clickCount;
    else cta.legacy += clickCount;

    for (const utm of click.utm_breakdown ?? []) {
      const source = String(utm.utm_source ?? "").toLowerCase();
      const medium = String(utm.utm_medium ?? "").toLowerCase();
      if (["x", "twitter"].includes(source) || medium.includes("paid")) {
        cta.paidXDownloads += Number(utm.clicks) || 0;
      }
    }
  }

  return {
    sessions,
    pageViews,
    downloadClicks: cta.total,
    downloadUniqueSessions: cta.uniqueSessions,
    heroDownloadClicks: cta.hero,
    reviewsDownloadClicks: cta.reviews,
    legacyDownloadClicks: cta.legacy,
    paidXSessions: paidX.sessions,
    paidXPageViews: paidX.pageViews,
    paidXDownloadClicks: cta.paidXDownloads,
    ...webAppFunnel(pageRows, clickRows),
    webBreakdownPossiblyTruncated: pageRows.length >= 50 || clickRows.length >= 50,
    webFunnelScope: "Up to 50 page and click rows. Visitors are homepage-only; event/visitor ratios are not cohort conversion rates. Direct /app/ tracking is off.",
  };
}

function telemetryQuery(appID, dataSource, type) {
  return {
    queryType: "topN",
    dataSource,
    granularity: "all",
    dimension: { type: "default", dimension: "type", outputName: "type" },
    metric: { type: "numeric", metric: "count" },
    aggregations: [{ type: "userCount", name: "count" }],
    filter: {
      type: "and",
      fields: [
        { type: "selector", dimension: "appID", value: appID },
        { type: "selector", dimension: "isTestMode", value: "false" },
        { type: "selector", dimension: "type", value: type },
      ],
    },
    relativeIntervals: [{
      beginningDate: { component: "day", offset: 0, position: "beginning" },
      endDate: { component: "day", offset: 0, position: "end" },
    }],
    threshold: 1,
  };
}

function telemetryTopNCount(result, type) {
  const rows = Array.isArray(result) ? result.flatMap((bucket) => bucket.result ?? []) : [];
  const row = rows.find((item) => item.type === type);
  return Number(row?.count) || 0;
}

async function telemetryMetrics() {
  const token = requireEnv("TELEMETRYDECK_TOKEN");
  const appID = requireEnv("TELEMETRYDECK_APP_ID");
  const dataSource = process.env.TELEMETRYDECK_DATASOURCE ?? "com.omgskills";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const types = ["app.installed.v2", "app.launched", "skill.searched", "skill.opened", "skill.installed",
    "connected.connection", "connected.inventory"];
  const counts = {};

  for (const type of types) {
    const result = await fetchJson("https://api.telemetrydeckapi.com/api/v4/query/tql", {
      method: "POST",
      headers,
      body: JSON.stringify(telemetryQuery(appID, dataSource, type)),
    });
    counts[type] = telemetryTopNCount(result, type);
  }

  return {
    installs: counts["app.installed.v2"] ?? 0,
    launches: counts["app.launched"] ?? 0,
    searches: counts["skill.searched"] ?? 0,
    skillOpens: counts["skill.opened"] ?? 0,
    skillInstalls: counts["skill.installed"] ?? 0,
    // These include failed outcomes, not just successful connections or syncs.
    connectedConnectionEventUsers: counts["connected.connection"] ?? 0,
    connectedInventoryEventUsers: counts["connected.inventory"] ?? 0,
    engagedUsersLowerBound: Math.max(
      counts["skill.searched"] ?? 0,
      counts["skill.opened"] ?? 0,
      counts["skill.installed"] ?? 0,
    ),
  };
}

async function main() {
  loadEnv();
  const checkedAt = new Date().toISOString();
  const issues = [];
  let web = null;
  let app = null;

  try {
    web = await humblyticsMetrics();
  } catch (error) {
    issues.push(`Humblytics: ${error.message}`);
  }

  try {
    app = await telemetryMetrics();
  } catch (error) {
    issues.push(`TelemetryDeck: ${error.message}`);
  }

  const metrics = {
    ...(web ?? {}),
    ...(app ?? {}),
  };

  metrics.downloadClickRate = safeRate(metrics.downloadClicks ?? 0, metrics.sessions ?? 0);
  metrics.downloadToInstallRate = safeRate(metrics.installs ?? 0, metrics.downloadClicks ?? 0);

  const payload = {
    status: issues.length ? "degraded" : "ok",
    checkedAt,
    window: "today",
    timezone: process.env.FUNNEL_TIMEZONE ?? "America/New_York",
    issues,
    ...metrics,
  };

  console.log(JSON.stringify(payload));
  const output = `marketing_funnel_json=${JSON.stringify(payload)}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => {
  const payload = {
    status: "degraded",
    checkedAt: new Date().toISOString(),
    window: "today",
    timezone: process.env.FUNNEL_TIMEZONE ?? "America/New_York",
    issues: [error.message],
  };
  console.log(JSON.stringify(payload));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `marketing_funnel_json=${JSON.stringify(payload)}\n`);
  }
});

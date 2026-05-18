#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from "node:fs";

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

async function humblyticsMetrics() {
  const propertyId = requireEnv("HUMBLYTICS_PROPERTY_ID");
  const token = requireEnv("HUMBLYTICS_API_KEY");
  const timezone = process.env.FUNNEL_TIMEZONE ?? "America/New_York";
  const { start, end } = localDayBounds(0);
  const params = new URLSearchParams({ start, end, timezone });
  const base = `https://app.humblytics.com/api/external/v1/properties/${propertyId}`;
  const headers = { authorization: `Bearer ${token}` };

  const [summary, traffic, clicks] = await Promise.all([
    fetchJson(`${base}/traffic/summary?${params}`, { headers }),
    fetchJson(`${base}/traffic/breakdown?${params}`, { headers }),
    fetchJson(`${base}/clicks/details?${params}&page=/`, { headers }),
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

async function telemetryMetrics() {
  const token = requireEnv("TELEMETRYDECK_TOKEN");
  const appID = requireEnv("TELEMETRYDECK_APP_ID");
  const dataSource = process.env.TELEMETRYDECK_DATASOURCE ?? "com.omgskills";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const types = ["app.installed.v2", "app.launched", "skill.searched", "skill.opened", "skill.installed"];
  const counts = {};

  for (const type of types) {
    const result = await fetchJson("https://api.telemetrydeckapi.com/api/v4/query/tql", {
      method: "POST",
      headers,
      body: JSON.stringify(telemetryQuery(appID, dataSource, type)),
    });
    const row = result?.result?.rows?.[0];
    counts[type] = Number(row?.result?.[0]?.count) || 0;
  }

  return {
    installs: counts["app.installed.v2"] ?? 0,
    launches: counts["app.launched"] ?? 0,
    searches: counts["skill.searched"] ?? 0,
    skillOpens: counts["skill.opened"] ?? 0,
    skillInstalls: counts["skill.installed"] ?? 0,
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

main().catch((error) => {
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

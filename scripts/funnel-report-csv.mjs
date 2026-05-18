#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

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

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : fallback;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((items) => items.some((item) => item.trim() !== ""));
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function csvRecords(path) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function first(record, names) {
  for (const name of names) {
    const value = record[normalizeHeader(name)];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function parseNumber(value) {
  const cleaned = String(value ?? "").replace(/[$,%\s]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function dateRange(days, startArg, endArg) {
  const end = endArg ? new Date(`${endArg}T12:00:00`) : new Date();
  const start = startArg ? new Date(`${startArg}T12:00:00`) : new Date(end.getTime() - (days - 1) * 864e5);
  const dates = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function localBounds(date) {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function key(date, campaign) {
  return `${date}||${campaign || "unknown"}`;
}

function addMetric(map, date, campaign, patch) {
  const id = key(date, campaign);
  const current = map.get(id) ?? { date, campaign: campaign || "unknown" };
  for (const [metric, value] of Object.entries(patch)) {
    current[metric] = (current[metric] ?? 0) + value;
  }
  map.set(id, current);
}

function readXCsv(path) {
  const rows = csvRecords(path);
  const totals = new Map();
  for (const row of rows) {
    const date = dateKey(first(row, ["date", "day", "time period", "start date", "reporting starts", "reporting date"]));
    if (!date) continue;
    const campaign = first(row, ["utm campaign", "campaign", "campaign name", "campaign id", "campaign_id"]) || "unknown";
    addMetric(totals, date, campaign, {
      xSpend: parseNumber(first(row, ["spend", "amount spent", "total spend", "billed charge local micro", "billed charge"])),
      xImpressions: parseNumber(first(row, ["impressions"])),
      xClicks: parseNumber(first(row, ["clicks", "link clicks", "url clicks", "app clicks"])),
    });
  }
  return totals;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) throw new Error(`${response.status} ${json?.error ?? response.statusText}`);
  return json;
}

async function humblyticsDay(date, timezone) {
  const propertyId = requireEnv("HUMBLYTICS_PROPERTY_ID");
  const token = requireEnv("HUMBLYTICS_API_KEY");
  const { start, end } = localBounds(date);
  const params = new URLSearchParams({ start, end, timezone });
  const base = `https://app.humblytics.com/api/external/v1/properties/${propertyId}`;
  const headers = { authorization: `Bearer ${token}` };
  const [traffic, clicks] = await Promise.all([
    fetchJson(`${base}/traffic/breakdown?${params}`, { headers }),
    fetchJson(`${base}/clicks/details?${params}&page=/`, { headers }),
  ]);
  return { traffic, clicks };
}

function isPaidX(row) {
  const source = String(row.source ?? row.utm_source ?? "").toLowerCase();
  const medium = String(row.medium ?? row.utm_medium ?? "").toLowerCase();
  return ["x", "twitter"].includes(source) || medium.includes("paid");
}

function addHumblytics(map, date, data) {
  for (const row of data.traffic?.data?.utm ?? []) {
    if (!isPaidX(row)) continue;
    addMetric(map, date, row.campaign ?? "unknown", {
      siteSessions: Number(row.sessions) || 0,
      sitePageViews: Number(row.page_views) || 0,
    });
  }

  for (const click of data.clicks?.data?.clicks ?? []) {
    const isDownload = click.target === "Hero Download Mac DMG" ||
      click.target === "Reviews Download Mac DMG" ||
      click.secondary === "/downloads/omgskills-mac.dmg";
    if (!isDownload) continue;
    for (const utm of click.utm_breakdown ?? []) {
      const campaign = utm.utm_campaign && utm.utm_campaign !== "none" ? utm.utm_campaign : "unknown";
      addMetric(map, date, campaign, {
        downloadClicks: Number(utm.clicks) || 0,
      });
    }
  }
}

function telemetryQuery(appID, dataSource, type, days) {
  return {
    queryType: "topN",
    dataSource,
    granularity: { type: "period", period: "P1D", timeZone: process.env.FUNNEL_TIMEZONE ?? "America/New_York" },
    dimension: { type: "default", dimension: "type", outputName: "type" },
    metric: { type: "numeric", metric: "count" },
    aggregations: [{ type: "eventCount", name: "count" }],
    filter: {
      type: "and",
      fields: [
        { type: "selector", dimension: "appID", value: appID },
        { type: "selector", dimension: "isTestMode", value: "false" },
        { type: "selector", dimension: "type", value: type },
      ],
    },
    relativeIntervals: [{
      beginningDate: { component: "day", offset: -days + 1, position: "beginning" },
      endDate: { component: "day", offset: 0, position: "end" },
    }],
    threshold: 10,
  };
}

async function telemetryCounts(days) {
  const token = requireEnv("TELEMETRYDECK_TOKEN");
  const appID = requireEnv("TELEMETRYDECK_APP_ID");
  const dataSource = process.env.TELEMETRYDECK_DATASOURCE ?? "com.omgskills";
  const types = ["app.installed.v2", "app.launched", "skill.searched", "skill.opened", "skill.installed"];
  const counts = new Map();
  for (const type of types) {
    const result = await fetchJson("https://api.telemetrydeckapi.com/api/v4/query/tql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(telemetryQuery(appID, dataSource, type, days)),
    });
    for (const row of result?.result?.rows ?? []) {
      const date = String(row.timestamp).slice(0, 10);
      const count = Number(row.result?.[0]?.count) || 0;
      const current = counts.get(date) ?? {};
      current[type] = count;
      counts.set(date, current);
    }
  }
  return counts;
}

function fmt(value, digits = 0) {
  const number = Number(value) || 0;
  return digits ? number.toFixed(digits) : Math.round(number).toLocaleString();
}

function pct(numerator, denominator) {
  const top = Number(numerator) || 0;
  const bottom = Number(denominator) || 0;
  return bottom ? `${((top / bottom) * 100).toFixed(1)}%` : "-";
}

function printTable(rows) {
  const header = [
    "date", "campaign", "spend", "x clicks", "site sessions", "downloads", "installs", "first-use", "click->download", "download->install",
  ];
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    console.log([
      row.date,
      row.campaign,
      `$${fmt(row.xSpend, 2)}`,
      fmt(row.xClicks),
      fmt(row.siteSessions),
      fmt(row.downloadClicks),
      fmt(row.installs),
      fmt(row.firstUse),
      pct(row.downloadClicks, row.xClicks || row.siteSessions),
      pct(row.installs, row.downloadClicks),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
}

async function main() {
  loadEnv();
  const csvPath = arg("x-csv");
  if (!csvPath) throw new Error("Usage: node scripts/funnel-report-csv.mjs --x-csv path/to/x-export.csv [--days 7]");
  const days = Number.parseInt(arg("days", "7"), 10);
  const timezone = process.env.FUNNEL_TIMEZONE ?? "America/New_York";
  const dates = dateRange(days, arg("start"), arg("end"));
  const rowsByKey = readXCsv(csvPath);

  for (const date of dates) {
    addHumblytics(rowsByKey, date, await humblyticsDay(date, timezone));
  }

  const appCounts = await telemetryCounts(days);
  const output = [...rowsByKey.values()]
    .filter((row) => dates.includes(row.date))
    .map((row) => {
      const counts = appCounts.get(row.date) ?? {};
      return {
        ...row,
        installs: counts["app.installed.v2"] ?? 0,
        launches: counts["app.launched"] ?? 0,
        firstUse: (counts["skill.searched"] ?? 0) + (counts["skill.opened"] ?? 0) + (counts["skill.installed"] ?? 0),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign));

  printTable(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

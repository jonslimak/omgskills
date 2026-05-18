#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const repoRoot = process.cwd();

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

function encode(value) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method, url, query = {}) {
  const oauth = {
    oauth_consumer_key: requireEnv("X_API_KEY"),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: requireEnv("X_ACCESS_TOKEN"),
    oauth_version: "1.0",
  };

  const params = Object.entries({ ...query, ...oauth })
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])
    .map(([key, value]) => [encode(key), encode(String(value))])
    .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey));

  const paramString = params.map(([key, value]) => `${key}=${value}`).join("&");
  const baseString = [method.toUpperCase(), encode(url), encode(paramString)].join("&");
  const signingKey = `${encode(requireEnv("X_API_KEY_SECRET"))}&${encode(requireEnv("X_ACCESS_TOKEN_SECRET"))}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  return "OAuth " + Object.entries(oauth)
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ");
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

async function checkXAds() {
  const accountId = requireEnv("X_ADS_ACCOUNT_ID");
  const base = "https://ads-api.x.com/12";

  const accessUrl = `${base}/accounts/${accountId}/authenticated_user_access`;
  const access = await fetchJson(accessUrl, {
    headers: { authorization: oauthHeader("GET", accessUrl) },
  });

  const campaignsUrl = `${base}/accounts/${accountId}/campaigns`;
  const campaignQuery = { count: "5" };
  const campaignSearch = new URLSearchParams(campaignQuery).toString();
  const campaigns = await fetchJson(`${campaignsUrl}?${campaignSearch}`, {
    headers: { authorization: oauthHeader("GET", campaignsUrl, campaignQuery) },
  });

  return {
    accountId,
    permissions: access?.data?.permissions ?? [],
    campaignCountReturned: Array.isArray(campaigns?.data) ? campaigns.data.length : 0,
  };
}

async function checkHumblytics() {
  const propertyId = requireEnv("HUMBLYTICS_PROPERTY_ID");
  const token = requireEnv("HUMBLYTICS_API_KEY");
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: process.env.FUNNEL_TIMEZONE ?? "America/New_York",
  });
  const base = `https://app.humblytics.com/api/external/v1/properties/${propertyId}`;
  const headers = { authorization: `Bearer ${token}` };
  const [summary, clicks] = await Promise.all([
    fetchJson(`${base}/traffic/summary?${params}`, { headers }),
    fetchJson(`${base}/clicks/breakdown?${params}`, { headers }),
  ]);

  return {
    propertyId,
    summaryKeys: Object.keys(summary ?? {}).slice(0, 10),
    clickRows: Array.isArray(clicks?.data) ? clicks.data.length : Array.isArray(clicks) ? clicks.length : null,
  };
}

async function checkTelemetryDeck() {
  const token = requireEnv("TELEMETRYDECK_TOKEN");
  const appID = requireEnv("TELEMETRYDECK_APP_ID");
  const dataSource = process.env.TELEMETRYDECK_DATASOURCE ?? "com.omgskills";
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  await fetchJson("https://api.telemetrydeckapi.com/api/v3/users/info/", { headers });

  const query = {
    queryType: "topN",
    dataSource,
    granularity: "all",
    dimension: {
      type: "default",
      dimension: "type",
      outputName: "type",
    },
    metric: {
      type: "numeric",
      metric: "count",
    },
    aggregations: [
      {
        type: "eventCount",
        name: "count",
      },
    ],
    filter: {
      type: "and",
      fields: [
        { type: "selector", dimension: "appID", value: appID },
        { type: "selector", dimension: "isTestMode", value: "false" },
      ],
    },
    relativeIntervals: [
      {
        beginningDate: { component: "day", offset: -7, position: "beginning" },
        endDate: { component: "day", offset: 0, position: "end" },
      },
    ],
    threshold: 20,
  };

  const result = await fetchJson("https://api.telemetrydeckapi.com/api/v4/query/tql", {
    method: "POST",
    headers,
    body: JSON.stringify(query),
  });

  return {
    appID,
    dataSource,
    resultType: result?.result?.type ?? null,
    rowCount: Array.isArray(result?.result?.rows) ? result.result.rows.length : null,
  };
}

async function runCheck(name, fn) {
  try {
    const result = await fn();
    console.log(`✓ ${name}`);
    console.log(JSON.stringify(result, null, 2));
    return true;
  } catch (error) {
    console.error(`✗ ${name}: ${error.message}`);
    return false;
  }
}

loadEnv();

const checks = [
  ["X Ads", checkXAds],
  ["Humblytics", checkHumblytics],
  ["TelemetryDeck", checkTelemetryDeck],
];

let ok = true;
for (const [name, fn] of checks) {
  ok = (await runCheck(name, fn)) && ok;
}

process.exit(ok ? 0 : 1);

#!/usr/bin/env node

import { createHash } from "node:crypto";

const origin = (process.env.PRODUCT_HEALTH_ORIGIN ?? "https://omgskills.com").replace(/\/$/, "");
const minDownloadBytes = Number(process.env.MIN_DOWNLOAD_BYTES ?? 1_000_000);
const minSkillsCount = Number(process.env.MIN_SKILLS_COUNT ?? 40_000);
const minTrendingCount = Number(process.env.MIN_TRENDING_COUNT ?? 100);
const searchQueries = (process.env.SEARCH_SMOKE_QUERIES ?? "swift,figma,mcp")
  .split(",")
  .map((query) => query.trim())
  .filter(Boolean);

const checkedAt = new Date().toISOString();
const sections = {};

function section(status, details = {}, issues = []) {
  return {
    status,
    checkedAt,
    issues,
    ...details,
  };
}

function ok(details = {}) {
  return section("ok", details);
}

function degraded(issues, details = {}) {
  return section("degraded", details, issues);
}

function absolute(path) {
  return new URL(path, `${origin}/`).toString();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PRODUCT_HEALTH_TIMEOUT_MS ?? 30_000));
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "omgskills-product-health/1.0",
        "cache-control": "no-cache",
        ...(options.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function headerNumber(response, name) {
  const value = response.headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function getJson(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function getBuffer(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/app[\s-]*store/g, "appstore")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchSkills(skills, query) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  return skills
    .map((skill) => {
      const fields = [
        [normalize(skill.name), 100],
        [normalize((skill.tags ?? []).join(" ")), 60],
        [normalize(skill.authorHandle ?? skill.author ?? ""), 30],
        [normalize(skill.description), 25],
      ];
      let score = 0;
      let matched = 0;
      for (const token of tokens) {
        const tokenScore = Math.max(
          ...fields.map(([field, exact]) => {
            if (!field) return 0;
            if (field.split(" ").includes(token)) return exact;
            return token.length >= 3 && field.includes(token) ? Math.round(exact * 0.7) : 0;
          }),
        );
        if (tokenScore > 0) {
          score += tokenScore;
          matched += 1;
        }
      }
      return { skill, score: matched === tokens.length ? score + 1_000 : score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || (b.skill.stars ?? 0) - (a.skill.stars ?? 0))
    .slice(0, 5);
}

async function checkDownload() {
  const redirect = await fetchWithTimeout(absolute("/download"), { redirect: "manual" });
  const location = redirect.headers.get("location") ?? "";
  const redirectOk = [301, 302, 307, 308].includes(redirect.status) &&
    location.includes("/downloads/omgskills-mac.dmg");

  const dmg = await fetchWithTimeout(absolute("/downloads/omgskills-mac.dmg"), { method: "HEAD" });
  const bytes = headerNumber(dmg, "content-length");
  const cacheControl = dmg.headers.get("cache-control") ?? "";
  const issues = [];

  if (!redirectOk) issues.push(`/download returned ${redirect.status} to ${location || "no location"}`);
  if (!dmg.ok) issues.push(`DMG returned ${dmg.status}`);
  if (!bytes || bytes < minDownloadBytes) issues.push(`DMG size too small (${bytes ?? "missing"} bytes)`);
  if (!cacheControl.includes("max-age=60")) issues.push(`DMG cache header unexpected (${cacheControl || "missing"})`);

  sections.download = issues.length
    ? degraded(issues, { redirectStatus: redirect.status, redirectLocation: location, dmgStatus: dmg.status, bytes, cacheControl })
    : ok({ redirectStatus: redirect.status, redirectLocation: location, dmgStatus: dmg.status, bytes, cacheControl });
}

function extractAppcast(appcast) {
  const itemMatch = appcast.match(/<item>[\s\S]*?<\/item>/);
  const latestItem = itemMatch?.[0] ?? "";
  const latestVersion = latestItem.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/)?.[1] ??
    latestItem.match(/<title>([^<]+)<\/title>/)?.[1] ?? null;
  const enclosureMatches = [...latestItem.matchAll(/<enclosure\b[^>]*\burl="([^"]+)"[^>]*\blength="([^"]+)"/g)];
  const fullZip = enclosureMatches.find((match) => /\/updates\/omgskills-[^/]+\.zip$/.test(new URL(match[1], origin).pathname));
  return {
    latestVersion,
    latestZipUrl: fullZip?.[1] ? new URL(fullZip[1], origin).toString() : null,
    latestZipExpectedBytes: fullZip?.[2] ? Number(fullZip[2]) : null,
  };
}

async function checkUpdates() {
  const appcastResponse = await fetchWithTimeout(absolute("/appcast.xml"));
  const issues = [];
  let details = { appcastStatus: appcastResponse.status, latestVersion: null, latestZipUrl: null, latestZipStatus: null, latestZipBytes: null };

  if (!appcastResponse.ok) {
    sections.updates = degraded([`appcast returned ${appcastResponse.status}`], details);
    return;
  }

  const appcast = await appcastResponse.text();
  const parsed = extractAppcast(appcast);
  details = { ...details, ...parsed };

  if (!parsed.latestVersion) issues.push("appcast has no latest version");
  if (!parsed.latestZipUrl) issues.push("appcast has no latest full update zip");

  if (parsed.latestZipUrl) {
    const zip = await fetchWithTimeout(parsed.latestZipUrl, { method: "HEAD" });
    const bytes = headerNumber(zip, "content-length");
    details.latestZipStatus = zip.status;
    details.latestZipBytes = bytes;
    if (!zip.ok) issues.push(`latest update zip returned ${zip.status}`);
    if (!bytes || bytes < minDownloadBytes) issues.push(`latest update zip size too small (${bytes ?? "missing"} bytes)`);
    if (parsed.latestZipExpectedBytes && bytes && parsed.latestZipExpectedBytes !== bytes) {
      issues.push(`latest update zip byte mismatch (${bytes} != ${parsed.latestZipExpectedBytes})`);
    }
  }

  sections.updates = issues.length ? degraded(issues, details) : ok(details);
}

async function checkDataRefreshAndSearch() {
  const manifestUrl = absolute("/data/manifest.json");
  const manifest = await getJson(manifestUrl);
  const assetNames = Object.entries(manifest)
    .filter(([, value]) => value?.path && value?.sha256 && Number.isFinite(value?.bytes))
    .map(([name]) => name);
  const checkedAssets = [];
  const issues = [];
  let skills = null;
  let trending = null;

  for (const name of assetNames) {
    const asset = manifest[name];
    if (!asset?.path) continue;
    const assetUrl = new URL(asset.path, manifestUrl).toString();
    const buffer = await getBuffer(assetUrl);
    const actualHash = sha256Hex(buffer);
    checkedAssets.push({ name, path: asset.path, bytes: buffer.length });
    if (buffer.length !== asset.bytes) issues.push(`${name} byte mismatch (${buffer.length} != ${asset.bytes})`);
    if (actualHash !== asset.sha256) issues.push(`${name} sha256 mismatch`);
    if (name === "skills") skills = JSON.parse(buffer.toString("utf8"));
    if (name === "trending") trending = JSON.parse(buffer.toString("utf8"));
  }

  if (!Array.isArray(skills)) issues.push("skills asset did not parse as an array");
  if (!Array.isArray(trending)) issues.push("trending asset did not parse as an array");
  if (Array.isArray(skills) && skills.length < minSkillsCount) issues.push(`skills count too low (${skills.length})`);
  if (Array.isArray(trending) && trending.length < minTrendingCount) issues.push(`trending count too low (${trending.length})`);

  sections.dataRefresh = issues.length
    ? degraded(issues, { manifestGeneratedAt: manifest.generatedAt ?? null, checkedAssets, skillsCount: skills?.length ?? null, trendingCount: trending?.length ?? null })
    : ok({ manifestGeneratedAt: manifest.generatedAt ?? null, checkedAssets, skillsCount: skills.length, trendingCount: trending.length });

  const searchIssues = [];
  const queryResults = [];
  if (Array.isArray(skills)) {
    for (const query of searchQueries) {
      const results = searchSkills(skills, query);
      queryResults.push({
        query,
        resultCount: results.length,
        topResult: results[0]?.skill?.id ?? null,
      });
      if (results.length === 0) searchIssues.push(`search returned no results for "${query}"`);
    }
  } else {
    searchIssues.push("search skipped because skills data was unavailable");
  }

  sections.search = searchIssues.length ? degraded(searchIssues, { queryResults }) : ok({ queryResults });
}

async function main() {
  const topIssues = [];
  for (const run of [checkDownload, checkUpdates, checkDataRefreshAndSearch]) {
    try {
      await run();
    } catch (error) {
      topIssues.push(error.message);
    }
  }

  if (topIssues.length) {
    sections.product = degraded(topIssues);
  }

  const issues = Object.entries(sections)
    .flatMap(([name, value]) => (value.issues ?? []).map((issue) => `${name}: ${issue}`));
  const status = issues.length === 0 ? "ok" : "degraded";
  const message = issues.length === 0 ? "All product checks passed" : issues.join("; ");
  const result = { version: 1, status, message, checkedAt, origin, sections };

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(process.env.GITHUB_OUTPUT, [
      `product_status=${status}`,
      `product_message<<EOF`,
      message,
      `EOF`,
      `product_health_json<<EOF`,
      JSON.stringify(result),
      `EOF`,
    ].join("\n") + "\n");
  }

  console.log(JSON.stringify(result, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(`check-product-health: ${error.message}`);
  process.exit(1);
});

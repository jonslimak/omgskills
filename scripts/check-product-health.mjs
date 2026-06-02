#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const origin = (process.env.PRODUCT_HEALTH_ORIGIN ?? "https://omgskills.com").replace(/\/$/, "");
const minDownloadBytes = Number(process.env.MIN_DOWNLOAD_BYTES ?? 1_000_000);
const minSkillsCount = Number(process.env.MIN_SKILLS_COUNT ?? 40_000);
const minTrendingCount = Number(process.env.MIN_TRENDING_COUNT ?? 100);
const minXTrendingCount = Number(process.env.MIN_X_TRENDING_COUNT ?? 1);
const repoRoot = process.cwd();
const dataDir = join(repoRoot, "site", "data");
const defaultTimeoutMs = Number(process.env.PRODUCT_HEALTH_TIMEOUT_MS ?? 45_000);
const defaultRetryAttempts = Number(process.env.PRODUCT_HEALTH_RETRY_ATTEMPTS ?? 2);
const retryBackoffMs = [500, 1_500];
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function isRetriableError(error) {
  return isAbortError(error) || error instanceof TypeError;
}

function formatNetworkError(error, label) {
  if (isAbortError(error)) return `${label} timed out`;
  return `${label} failed: ${error.message}`;
}

async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const retries = retryOptions.retries ?? defaultRetryAttempts;
  const retryStatuses = retryOptions.retryStatuses ?? true;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (attempt < retries && retryStatuses && isRetriableStatus(response.status)) {
        await sleep(retryBackoffMs[Math.min(attempt, retryBackoffMs.length - 1)] ?? 1_500);
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= retries || !isRetriableError(error)) throw error;
      await sleep(retryBackoffMs[Math.min(attempt, retryBackoffMs.length - 1)] ?? 1_500);
    }
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultTimeoutMs);
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

function contentRangeTotal(response) {
  const value = response.headers.get("content-range") ?? "";
  const match = value.match(/\/(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

async function assetSize(url) {
  const head = await fetchWithRetry(url, { method: "HEAD" });
  let bytes = headerNumber(head, "content-length");

  if (!bytes && head.ok) {
    const range = await fetchWithRetry(url, {
      headers: { range: "bytes=0-0" },
    });
    bytes = contentRangeTotal(range) ?? headerNumber(range, "content-length");
  }

  return { response: head, bytes };
}

async function getJson(url) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function getLocalJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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

async function checkRelease() {
  const issues = [];
  const details = {
    redirectStatus: null,
    redirectLocation: "",
    dmgStatus: null,
    dmgBytes: null,
    cacheControl: "",
    appcastStatus: null,
    latestVersion: null,
    latestZipUrl: null,
    latestZipStatus: null,
    latestZipBytes: null,
  };

  try {
    const redirect = await fetchWithRetry(absolute("/download"), { redirect: "manual" }, { retryStatuses: false });
    const location = redirect.headers.get("location") ?? "";
    const redirectOk = [301, 302, 307, 308].includes(redirect.status) &&
      location.includes("/downloads/omgskills-mac.dmg");
    details.redirectStatus = redirect.status;
    details.redirectLocation = location;
    if (!redirectOk) issues.push(`/download returned ${redirect.status} to ${location || "no location"}`);
  } catch (error) {
    issues.push(formatNetworkError(error, "/download request"));
  }

  try {
    const { response: dmg, bytes: dmgBytes } = await assetSize(absolute("/downloads/omgskills-mac.dmg"));
    const cacheControl = dmg.headers.get("cache-control") ?? "";
    details.dmgStatus = dmg.status;
    details.dmgBytes = dmgBytes;
    details.cacheControl = cacheControl;
    if (!dmg.ok) issues.push(`DMG returned ${dmg.status}`);
    if (!dmgBytes || dmgBytes < minDownloadBytes) issues.push(`DMG size too small (${dmgBytes ?? "missing"} bytes)`);
    if (!cacheControl.includes("max-age=60")) issues.push(`DMG cache header unexpected (${cacheControl || "missing"})`);
  } catch (error) {
    issues.push(formatNetworkError(error, "DMG asset request"));
  }

  try {
    const appcastResponse = await fetchWithRetry(absolute("/appcast.xml"));
    details.appcastStatus = appcastResponse.status;
    if (!appcastResponse.ok) {
      issues.push(`appcast returned ${appcastResponse.status}`);
    } else {
      const appcast = await appcastResponse.text();
      const itemMatch = appcast.match(/<item>[\s\S]*?<\/item>/);
      const latestItem = itemMatch?.[0] ?? "";
      details.latestVersion = latestItem.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/)?.[1] ??
        latestItem.match(/<title>([^<]+)<\/title>/)?.[1] ?? null;

      const enclosureMatches = [...latestItem.matchAll(/<enclosure\b[^>]*\burl="([^"]+)"[^>]*\blength="([^"]+)"/g)];
      const fullZip = enclosureMatches.find((match) => /\/updates\/omgskills-[^/]+\.zip$/.test(new URL(match[1], origin).pathname));
      details.latestZipUrl = fullZip?.[1] ? new URL(fullZip[1], origin).toString() : null;
      const latestZipExpectedBytes = fullZip?.[2] ? Number(fullZip[2]) : null;

      if (!details.latestVersion) issues.push("appcast has no latest version");
      if (!details.latestZipUrl) issues.push("appcast has no latest full update zip");

      if (details.latestZipUrl) {
        try {
          const zip = await fetchWithRetry(details.latestZipUrl, { method: "HEAD" });
          const zipBytes = headerNumber(zip, "content-length");
          details.latestZipStatus = zip.status;
          details.latestZipBytes = zipBytes;
          if (!zip.ok) issues.push(`latest update zip returned ${zip.status}`);
          if (!zipBytes || zipBytes < minDownloadBytes) issues.push(`latest update zip size too small (${zipBytes ?? "missing"} bytes)`);
          if (latestZipExpectedBytes && zipBytes && latestZipExpectedBytes !== zipBytes) {
            issues.push(`latest update zip byte mismatch (${zipBytes} != ${latestZipExpectedBytes})`);
          }
        } catch (error) {
          issues.push(formatNetworkError(error, "latest update zip request"));
        }
      }
    }
  } catch (error) {
    issues.push(formatNetworkError(error, "appcast request"));
  }

  sections.release = issues.length ? degraded(issues, details) : ok(details);
}

function parseAssetCount(decoded) {
  if (Array.isArray(decoded)) return decoded.length;
  if (decoded?.topSkills && Array.isArray(decoded.topSkills)) return decoded.topSkills.length;
  return null;
}

async function readLocalTrackData(manifestPath, requiredAssets) {
  const localManifestPath = join(dataDir, manifestPath.replace(/^\/?data\//, ""));
  const manifest = await getLocalJson(localManifestPath);
  const baseDir = manifestPath.includes("/v2/") ? join(dataDir, "v2") : dataDir;
  const counts = {};
  let skills = null;

  for (const assetName of requiredAssets) {
    const asset = manifest[assetName];
    if (!asset?.path) continue;
    const decoded = await getLocalJson(join(baseDir, asset.path));
    counts[assetName] = parseAssetCount(decoded);
    if (assetName === "skills" && Array.isArray(decoded)) {
      skills = decoded;
    }
  }

  return { manifest, counts, skills };
}

async function checkManifestTrack(sectionName, manifestPath, options = {}) {
  const manifestUrl = absolute(manifestPath);
  const issues = [];
  const checkedAssets = [];
  const requiredAssets = options.requiredAssets ?? ["skills", "trending"];
  let manifest = null;
  let localData = null;
  const counts = {};

  if (options.includeLocalCounts) {
    try {
      localData = await readLocalTrackData(manifestPath, requiredAssets);
      Object.assign(counts, localData.counts ?? {});
    } catch (error) {
      issues.push(`local ${sectionName} data unavailable: ${error.message}`);
    }
  }

  try {
    manifest = await getJson(manifestUrl);
  } catch (error) {
    issues.push(formatNetworkError(error, `${sectionName} manifest request`));
    sections[sectionName] = degraded(issues, {
      manifestPath,
      manifestGeneratedAt: null,
      checkedAssets,
      counts,
    });
    return { manifest: null, skills: localData?.skills ?? null };
  }

  for (const assetName of requiredAssets) {
    if (!manifest[assetName]?.path || !manifest[assetName]?.sha256 || !Number.isFinite(manifest[assetName]?.bytes)) {
      issues.push(`manifest missing ${assetName} asset`);
    }
  }

  for (const name of requiredAssets) {
    const asset = manifest[name];
    if (!asset?.path || !asset?.sha256 || !Number.isFinite(asset?.bytes)) continue;
    const assetUrl = new URL(asset.path, manifestUrl).toString();
    try {
      const { response, bytes } = await assetSize(assetUrl);
      checkedAssets.push({ name, path: asset.path, bytes });
      if (!response.ok) issues.push(`${name} asset returned ${response.status}`);
      if (!bytes || bytes < 1) issues.push(`${name} asset size missing`);
      if (name === "skills" && bytes && bytes < minDownloadBytes) issues.push(`${name} asset size too small (${bytes} bytes)`);
    } catch (error) {
      checkedAssets.push({ name, path: asset.path, bytes: null });
      issues.push(formatNetworkError(error, `${name} asset request`));
    }
  }

  if (localData && (counts.skills ?? 0) < minSkillsCount) issues.push(`skills count too low (${counts.skills ?? 0})`);
  if (localData && (counts.trending ?? 0) < minTrendingCount) issues.push(`trending count too low (${counts.trending ?? 0})`);
  if (requiredAssets.includes("xTrending") && (counts.xTrending ?? 0) < minXTrendingCount) {
    issues.push(`xTrending count too low (${counts.xTrending ?? 0})`);
  }

  sections[sectionName] = issues.length
    ? degraded(issues, {
        manifestPath,
        manifestGeneratedAt: manifest.generatedAt ?? null,
        checkedAssets,
        counts,
      })
    : ok({
        manifestPath,
        manifestGeneratedAt: manifest.generatedAt ?? null,
        checkedAssets,
        counts,
      });

  return { manifest, skills: localData?.skills ?? null };
}

async function checkSearch(skills) {
  const queryResults = [];
  const issues = [];

  if (!Array.isArray(skills)) {
    issues.push("search skipped because v2 skills data was unavailable");
  } else {
    for (const query of searchQueries) {
      const results = searchSkills(skills, query);
      queryResults.push({
        query,
        resultCount: results.length,
        topResult: results[0]?.skill?.id ?? null,
      });
      if (results.length === 0) issues.push(`search returned no results for "${query}"`);
    }
  }

  sections.search = issues.length ? degraded(issues, { queryResults }) : ok({ queryResults });
}

async function main() {
  const topIssues = [];
  let v2Skills = null;

  try {
    const localV2Data = await readLocalTrackData("/data/v2/manifest.json", ["skills", "trending", "xTrending"]);
    v2Skills = localV2Data.skills;
  } catch (error) {
    topIssues.push(`local search data unavailable: ${error.message}`);
  }

  for (const run of [
    checkRelease,
    async () => { await checkManifestTrack("legacyData", "/data/manifest.json", { requiredAssets: ["skills", "trending"], includeLocalCounts: true }); },
    async () => {
      await checkManifestTrack("v2AppData", "/data/v2/manifest.json", {
        requiredAssets: ["skills", "trending", "xTrending"],
        includeLocalCounts: true,
      });
    },
  ]) {
    try {
      await run();
    } catch (error) {
      topIssues.push(error.message);
    }
  }

  try {
    await checkSearch(v2Skills);
  } catch (error) {
    topIssues.push(error.message);
  }

  if (topIssues.length >= 2 || Object.keys(sections).length === 0) {
    sections.product = degraded(topIssues);
  }

  const issues = Object.entries(sections)
    .flatMap(([name, value]) => (value.issues ?? []).map((issue) => `${name}: ${issue}`));
  const status = issues.length === 0 ? "ok" : "degraded";
  const message = issues.length === 0 ? "All product checks passed" : issues.join("; ");
  const result = { version: 2, status, message, checkedAt, origin, sections };

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

#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const shadowMaxAgeHours = Number(process.env.SHADOW_MAX_AGE_HOURS ?? 12);
const stuckMaxMinutes = Number(process.env.STUCK_MAX_MINUTES ?? 90);
const checkedAt = new Date().toISOString();

const liveManifests = {
  legacyData: {
    liveUrl: process.env.LIVE_MANIFEST_URL ?? "https://omgskills.com/data/manifest.json",
    localPath: join(process.cwd(), "site", "data", "manifest.json"),
  },
  v2AppData: {
    liveUrl: process.env.LIVE_V2_MANIFEST_URL ?? "https://omgskills.com/data/v2/manifest.json",
    localPath: join(process.cwd(), "site", "data", "v2", "manifest.json"),
  },
};

if (!repo || !token) {
  console.error("check-pipeline-health: missing GITHUB_REPOSITORY or GITHUB_TOKEN");
  process.exit(1);
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "omgskills-health-check",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed with ${response.status}`);
  }
  return response.json();
}

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

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

const workflows = {
  shadowCrawler: "shadow-crawl-health.yml",
};

async function latestSuccessful(filename) {
  const payload = await github(`/repos/${repo}/actions/workflows/${filename}/runs?per_page=20`);
  return (payload.workflow_runs ?? []).find((run) => run.conclusion === "success") ?? null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function compareManifest(name, { liveUrl, localPath }) {
  const issues = [];
  let liveStatus = null;

  try {
    const liveManifestResponse = await fetch(liveUrl, { headers: { "cache-control": "no-cache" } });
    liveStatus = liveManifestResponse.status;
    if (!liveManifestResponse.ok) {
      issues.push(`live manifest request failed (${liveManifestResponse.status})`);
    } else {
      const liveManifest = await liveManifestResponse.json();
      const localManifest = readJson(localPath);
      if (JSON.stringify(liveManifest) !== JSON.stringify(localManifest)) {
        issues.push("live manifest differs from repo manifest");
      }
    }
  } catch (error) {
    issues.push(`live manifest check failed (${error.message})`);
  }

  return {
    name,
    status: issues.length === 0 ? "ok" : "degraded",
    liveUrl,
    localPath,
    liveStatus,
    issues,
  };
}

async function main() {
  const issues = [];
  const sections = {};

  const [shadowRun, inProgressRuns] = await Promise.all([
    latestSuccessful(workflows.shadowCrawler),
    github(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`),
  ]);

  const crawlerIssues = [];
  if (!shadowRun) {
    crawlerIssues.push("No successful shadow-crawl-health run found");
  } else if (hoursSince(shadowRun.updated_at) > shadowMaxAgeHours) {
    crawlerIssues.push(`shadow-crawl-health is stale (${hoursSince(shadowRun.updated_at).toFixed(1)}h)`);
  }

  for (const run of inProgressRuns.workflow_runs ?? []) {
    if (run.path?.endsWith(`/${workflows.shadowCrawler}`) === false && run.name !== "shadow-crawl-health") continue;
    const ageMinutes = (Date.now() - new Date(run.run_started_at).getTime()) / 6e4;
    if (ageMinutes > stuckMaxMinutes) {
      crawlerIssues.push(`workflow stuck: ${run.name} for ${Math.round(ageMinutes)}m`);
    }
  }

  sections.crawlers = crawlerIssues.length
    ? degraded(crawlerIssues, {
        lastSuccessfulShadowRunAt: shadowRun?.updated_at ?? null,
      })
    : ok({
        lastSuccessfulShadowRunAt: shadowRun?.updated_at ?? null,
      });
  issues.push(...crawlerIssues.map((issue) => `crawlers: ${issue}`));

  const manifestChecks = await Promise.all(
    Object.entries(liveManifests).map(([name, config]) => compareManifest(name, config)),
  );
  for (const manifestCheck of manifestChecks) {
    if (manifestCheck.issues.length) {
      issues.push(...manifestCheck.issues.map((issue) => `${manifestCheck.name}: ${issue}`));
    }
  }

  const shadowIssues = [];
  let v2ManifestMatchesLocal = manifestChecks.find((item) => item.name === "v2AppData")?.issues.length === 0;

  if (!v2ManifestMatchesLocal) {
    shadowIssues.push("live v2 manifest is not aligned with repo v2 manifest");
  }

  sections.shadowCutover = shadowIssues.length
    ? degraded(shadowIssues, {
        v2ManifestMatchesLocal,
      })
    : ok({
        v2ManifestMatchesLocal,
      });
  issues.push(...shadowIssues.map((issue) => `shadowCutover: ${issue}`));

  const status = issues.length === 0 ? "ok" : "degraded";
  const message = issues.length === 0 ? "All pipeline checks passed" : issues.join("; ");
  const result = {
    version: 2,
    status,
    message,
    checkedAt,
    sections,
    lastShadowCrawlerSuccessAt: shadowRun?.updated_at ?? null,
  };

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `health_status=${status}`,
      `health_message<<EOF`,
      message,
      `EOF`,
      `last_shadow_crawler_success_at=${shadowRun?.updated_at ?? ""}`,
      `pipeline_health_json<<EOF`,
      JSON.stringify(result),
      `EOF`,
    ];
    await import("node:fs/promises").then((fs) => fs.appendFile(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n"));
  }

  console.log(JSON.stringify(result, null, 2));
  if (issues.length) {
    console.error(`check-pipeline-health: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`check-pipeline-health: ${error.message}`);
  process.exit(1);
});

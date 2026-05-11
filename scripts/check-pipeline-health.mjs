#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const scrapeMaxAgeHours = Number(process.env.SCRAPE_MAX_AGE_HOURS ?? 36);
const xMaxAgeHours = Number(process.env.X_MAX_AGE_HOURS ?? 30);
const contentMaxAgeHours = Number(process.env.CONTENT_MAX_AGE_HOURS ?? 192);
const stuckMaxMinutes = Number(process.env.STUCK_MAX_MINUTES ?? 90);
const liveManifestUrl = process.env.LIVE_MANIFEST_URL ?? "https://omgskills.com/data/manifest.json";
const localManifestPath = join(process.cwd(), "site", "data", "manifest.json");

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

const issues = [];
const workflows = {
  scrape: "scrape.yml",
  xRefresh: "x-refresh.yml",
  contentReports: "content-reports.yml",
};

async function latestSuccessful(filename) {
  const payload = await github(`/repos/${repo}/actions/workflows/${filename}/runs?per_page=20`);
  return (payload.workflow_runs ?? []).find((run) => run.conclusion === "success") ?? null;
}

const [scrapeRun, xRun, contentRun, inProgressRuns] = await Promise.all([
  latestSuccessful(workflows.scrape),
  latestSuccessful(workflows.xRefresh),
  latestSuccessful(workflows.contentReports),
  github(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`),
]);

if (!scrapeRun) {
  issues.push("No successful scrape run found");
} else if (hoursSince(scrapeRun.updated_at) > scrapeMaxAgeHours) {
  issues.push(`scrape is stale (${hoursSince(scrapeRun.updated_at).toFixed(1)}h)`);
}

if (!xRun) {
  issues.push("No successful x-refresh run found");
} else if (hoursSince(xRun.updated_at) > xMaxAgeHours) {
  issues.push(`x-refresh is stale (${hoursSince(xRun.updated_at).toFixed(1)}h)`);
}

if (!contentRun) {
  issues.push("No successful content-reports run found");
} else if (hoursSince(contentRun.updated_at) > contentMaxAgeHours) {
  issues.push(`content-reports is stale (${hoursSince(contentRun.updated_at).toFixed(1)}h)`);
}

for (const run of inProgressRuns.workflow_runs ?? []) {
  const ageMinutes = (Date.now() - new Date(run.run_started_at).getTime()) / 6e4;
  if (ageMinutes > stuckMaxMinutes) {
    issues.push(`workflow stuck: ${run.name} for ${Math.round(ageMinutes)}m`);
  }
}

const liveManifestResponse = await fetch(liveManifestUrl, { headers: { "cache-control": "no-cache" } });
if (!liveManifestResponse.ok) {
  issues.push(`live manifest request failed (${liveManifestResponse.status})`);
} else {
  const liveManifest = await liveManifestResponse.json();
  const localManifest = JSON.parse(readFileSync(localManifestPath, "utf8"));
  if (JSON.stringify(liveManifest) !== JSON.stringify(localManifest)) {
    issues.push("live manifest differs from repo manifest");
  }
}

const status = issues.length === 0 ? "ok" : "degraded";
const message = issues.length === 0 ? "All pipeline checks passed" : issues.join("; ");

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `health_status=${status}`,
    `health_message<<EOF`,
    message,
    `EOF`,
    `last_scrape_success_at=${scrapeRun?.updated_at ?? ""}`,
    `last_x_refresh_success_at=${xRun?.updated_at ?? ""}`,
    `last_content_report_success_at=${contentRun?.updated_at ?? ""}`,
  ];
  await import("node:fs/promises").then((fs) => fs.appendFile(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n"));
}

if (issues.length) {
  console.error(`check-pipeline-health: ${message}`);
  process.exit(1);
}

console.log("check-pipeline-health: ok");

#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_WRITER_WORKFLOWS = new Set([
  "content-reports",
  "publish-collections",
  "scrape",
  "shadow-crawl-health",
  "x-refresh",
]);

const ACTIVE_RUN_STATUSES = new Set([
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);

export function activeDataWriterRuns(runs) {
  return runs
    .filter((run) => DATA_WRITER_WORKFLOWS.has(run?.name))
    .filter((run) => ACTIVE_RUN_STATUSES.has(run?.status))
    .map((run) => ({
      id: String(run.id ?? ""),
      name: run.name,
      status: run.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function checkActiveDataWriters({
  repository,
  token,
  fetchImpl = fetch,
} = {}) {
  if (!repository || !token) {
    return {
      busy: true,
      runs: [],
      message: "writer activity check unavailable: missing GitHub repository or token",
    };
  }

  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/runs?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub Actions lookup returned ${response.status}`);
    }

    const payload = await response.json();
    const runs = activeDataWriterRuns(payload.workflow_runs ?? []);
    return {
      busy: runs.length > 0,
      runs,
      message: runs.length > 0
        ? `data writer active: ${runs.map((run) => `${run.name}#${run.id} (${run.status})`).join(", ")}`
        : "no queued or running data writers",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      busy: true,
      runs: [],
      message: `writer activity check failed closed: ${detail}`,
    };
  }
}

async function appendOutput(pathname, lines) {
  if (!pathname) return;
  await appendFile(pathname, `${lines.join("\n")}\n`);
}

async function main() {
  const result = await checkActiveDataWriters({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  const busy = result.busy ? "true" : "false";

  console.log(`${busy}: ${result.message}`);
  await appendOutput(process.env.GITHUB_OUTPUT, [
    `busy=${busy}`,
    `message=${result.message}`,
  ]);
  await appendOutput(process.env.GITHUB_STEP_SUMMARY, [
    "### Health deploy queue check",
    "",
    result.busy ? `Skipped: ${result.message}` : result.message,
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

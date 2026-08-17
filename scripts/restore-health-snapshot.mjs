#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HEALTH_SNAPSHOT_PATH, parseHealthSnapshot } from "./health-snapshot-guard.mjs";

export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited ${code}`));
    });
  });
}

async function findHealthSnapshots(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findHealthSnapshots(entryPath));
    else if (entry.isFile() && entry.name === "health.json") matches.push(entryPath);
  }
  return matches;
}

export function validateArtifactSnapshot(raw, source, {
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const snapshot = parseHealthSnapshot(raw, source);
  const checkedAtMs = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    throw new Error(`Health snapshot is missing a valid checkedAt: ${source}`);
  }
  const ageMs = nowMs - checkedAtMs;
  if (ageMs < -5 * 60 * 1000) {
    throw new Error(`Health snapshot checkedAt is in the future: ${source}`);
  }
  if (ageMs > maxAgeMs) {
    throw new Error(`Health snapshot is stale: ${source}`);
  }
  return snapshot;
}

async function defaultListRuns({ repository, run }) {
  const result = await run("gh", [
    "run", "list",
    "--repo", repository,
    "--workflow", "pipeline-health.yml",
    "--status", "completed",
    "--limit", "20",
    "--json", "databaseId,createdAt",
  ]);
  const runs = JSON.parse(result.stdout);
  if (!Array.isArray(runs)) throw new Error("pipeline-health run list was not an array");
  return runs;
}

async function defaultDownloadRunArtifact({ repository, runId, destination, run }) {
  await run("gh", [
    "run", "download", String(runId),
    "--repo", repository,
    "--pattern", "pipeline-health-snapshot-*",
    "--dir", destination,
  ]);
}

export async function restoreLatestHealthSnapshot({
  siteDir,
  repository,
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  run = runCommand,
  listRuns = defaultListRuns,
  downloadRunArtifact = defaultDownloadRunArtifact,
} = {}) {
  if (!siteDir) throw new Error("siteDir is required");
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("repository must be owner/repo");
  }

  const runs = await listRuns({ repository, run });
  const failures = [];
  for (const workflowRun of runs) {
    const runId = workflowRun.databaseId ?? workflowRun.id;
    if (!runId) continue;
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "omgskills-health-"));
    try {
      await downloadRunArtifact({ repository, runId, destination: temporaryDirectory, run });
      const candidates = await findHealthSnapshots(temporaryDirectory);
      if (candidates.length !== 1) {
        throw new Error(`expected one health.json, found ${candidates.length}`);
      }
      const source = candidates[0];
      const raw = await readFile(source, "utf8");
      validateArtifactSnapshot(raw, source, { nowMs, maxAgeMs });

      const target = path.join(siteDir, HEALTH_SNAPSHOT_PATH);
      await mkdir(path.dirname(target), { recursive: true });
      const temporaryTarget = `${target}.tmp`;
      await writeFile(temporaryTarget, raw);
      await rename(temporaryTarget, target);
      return { runId, source, target };
    } catch (error) {
      failures.push(`${runId}: ${error.message}`);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  const detail = failures.length > 0 ? ` (${failures.join("; ")})` : "";
  throw new Error(`No valid recent pipeline-health snapshot artifact was found${detail}`);
}

async function resolveRepository(run) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const result = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return result.stdout.trim();
}

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const siteDir = path.resolve(process.env.SITE_DIR || path.join(repoRoot, "site"));
  const repository = await resolveRepository(runCommand);
  const result = await restoreLatestHealthSnapshot({ siteDir, repository });
  console.log(`Restored health snapshot from pipeline-health run ${result.runId}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`restore-health-snapshot: ${error.message}`);
    process.exitCode = 1;
  });
}

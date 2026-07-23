#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROLLBACK_ISSUE_TITLE = "Production deploy rollback";
const NETLIFY_API_ORIGIN = "https://api.netlify.com/api/v1";
const GITHUB_API_ORIGIN = "https://api.github.com";
const DEFAULT_RECEIPT_PATH = "dist/netlify-deploy-receipt.json";

function commandText(command, args) {
  return [command, ...args].join(" ");
}

export async function runCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
      reject(new Error(`${commandText(command, args)} failed: ${detail}`));
    });
  });
}

async function writeReceiptFile(receiptPath, receipt) {
  const absolutePath = path.resolve(receiptPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(temporaryPath, absolutePath);
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function apiJson(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return {};
  return JSON.parse(text);
}

function publishedDeployId(site) {
  return site?.published_deploy?.id ?? site?.publishedDeploy?.id ?? null;
}

async function currentDeployId({ fetchImpl, siteId, netlifyToken }) {
  const site = await apiJson(
    fetchImpl,
    `${NETLIFY_API_ORIGIN}/sites/${encodeURIComponent(siteId)}`,
    { headers: { Authorization: `Bearer ${netlifyToken}` } },
    "Netlify site lookup",
  );
  const deployId = publishedDeployId(site);
  if (!deployId) throw new Error("Netlify site lookup did not return a published deploy ID");
  return deployId;
}

function parseDeployId(stdout) {
  const candidates = [stdout.trim(), ...stdout.trim().split("\n").reverse()].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const deployId = parsed.deploy_id ?? parsed.deployId ?? parsed.id;
      if (typeof deployId === "string" && deployId) return deployId;
    } catch {
      // Netlify may print informational lines before its JSON result.
    }
  }
  throw new Error("Netlify deploy output did not contain a deploy ID");
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function resolveGithubContext({ env, run }) {
  let repository = env.GITHUB_REPOSITORY?.trim();
  let token = (env.GITHUB_TOKEN || env.GH_TOKEN)?.trim();

  if (!repository) {
    const result = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
    repository = result.stdout.trim();
  }
  if (!token) {
    const result = await run("gh", ["auth", "token"]);
    token = result.stdout.trim();
  }
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be owner/repo");
  }
  if (!token) throw new Error("GITHUB_TOKEN or an authenticated gh CLI is required");
  return { repository, token };
}

async function findOpenRollbackIssue({ fetchImpl, repository, githubToken }) {
  const issues = await apiJson(
    fetchImpl,
    `${GITHUB_API_ORIGIN}/repos/${repository}/issues?state=open&per_page=100`,
    { headers: githubHeaders(githubToken) },
    "GitHub issue lookup",
  );
  return issues.find((issue) => !issue.pull_request && issue.title === ROLLBACK_ISSUE_TITLE) ?? null;
}

async function openOrUpdateRollbackIssue({
  fetchImpl,
  repository,
  githubToken,
  body,
}) {
  const existing = await findOpenRollbackIssue({ fetchImpl, repository, githubToken });
  if (existing) {
    return apiJson(
      fetchImpl,
      `${GITHUB_API_ORIGIN}/repos/${repository}/issues/${existing.number}`,
      {
        method: "PATCH",
        headers: {
          ...githubHeaders(githubToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: ROLLBACK_ISSUE_TITLE, body }),
      },
      "GitHub rollback issue update",
    );
  }
  return apiJson(
    fetchImpl,
    `${GITHUB_API_ORIGIN}/repos/${repository}/issues`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(githubToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: ROLLBACK_ISSUE_TITLE, body }),
    },
    "GitHub rollback issue creation",
  );
}

async function restoreDeploy({ fetchImpl, siteId, deployId, netlifyToken }) {
  await apiJson(
    fetchImpl,
    `${NETLIFY_API_ORIGIN}/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}/restore`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${netlifyToken}` },
    },
    "Netlify deploy restore",
  );
}

function verificationCommands({ exactManifests }) {
  const commands = [
    {
      command: process.execPath,
      args: ["./scripts/verify-production-deploy.mjs"],
      env: { PRODUCTION_ORIGIN: "https://omgskills.com" },
    },
    {
      command: process.execPath,
      args: ["./scripts/verify-web-library-pages.mjs", "--live"],
      env: { PRODUCTION_ORIGIN: "https://omgskills.com" },
    },
  ];
  if (!exactManifests) return commands;

  for (const [livePath, localPath] of [
    ["/data/manifest.json", "site/data/manifest.json"],
    ["/data/v2/manifest.json", "site/data/v2/manifest.json"],
    ["/data/crawl4/manifest.json", "site/data/crawl4/manifest.json"],
  ]) {
    commands.push({
      command: process.execPath,
      args: ["./scripts/verify-live-manifest.mjs"],
      env: {
        LIVE_MANIFEST_URL: `https://omgskills.com${livePath}`,
        LOCAL_MANIFEST_PATH: localPath,
      },
    });
  }
  return commands;
}

async function verifyWithRetries({
  run,
  env,
  exactManifests,
  attempts,
  retryDelayMs,
  sleep,
  onAttempt,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    onAttempt(attempt);
    try {
      for (const command of verificationCommands({ exactManifests })) {
        const result = await run(command.command, command.args, {
          env: { ...env, ...command.env },
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.error(`Production verification attempt ${attempt} failed: ${error.message}`);
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastError;
}

function rollbackIssueBody(receipt) {
  const runUrl =
    receipt.githubRunUrl ||
    (receipt.githubRepository && receipt.githubRunId
      ? `https://github.com/${receipt.githubRepository}/actions/runs/${receipt.githubRunId}`
      : null);
  return [
    "A structural production verification failed. Deployments are blocked until this issue is closed.",
    "",
    `- Status: \`${receipt.status}\``,
    `- Source commit: \`${receipt.sourceCommit || "unknown"}\``,
    `- Candidate deploy: \`${receipt.candidateDeployId || "unknown"}\``,
    `- Previous deploy: \`${receipt.previousDeployId || "unknown"}\``,
    `- Verification error: ${receipt.verificationError || "unknown"}`,
    runUrl ? `- Workflow run: ${runUrl}` : null,
    receipt.manualRestoreCommand
      ? `- Manual restore: \`${receipt.manualRestoreCommand}\``
      : null,
    "",
    "Confirm production is healthy, fix the source problem, then close this issue to resume deploys.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function deployProduction({
  env = process.env,
  run = runCommand,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date().toISOString(),
  writeReceipt = writeReceiptFile,
} = {}) {
  const siteId = requireEnv(env, "NETLIFY_SITE_ID");
  const netlifyToken = requireEnv(env, "NETLIFY_AUTH_TOKEN");
  const receiptPath = env.NETLIFY_DEPLOY_RECEIPT_PATH || DEFAULT_RECEIPT_PATH;
  const attempts = Number.parseInt(env.NETLIFY_VERIFY_ATTEMPTS || "3", 10);
  const retryDelayMs = Number.parseInt(env.NETLIFY_VERIFY_RETRY_DELAY_MS || "10000", 10);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("NETLIFY_VERIFY_ATTEMPTS must be a positive integer");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error("NETLIFY_VERIFY_RETRY_DELAY_MS must be a non-negative integer");
  }

  const receipt = {
    version: 1,
    siteId,
    sourceCommit: null,
    previousDeployId: null,
    candidateDeployId: null,
    startedAt: now(),
    completedAt: null,
    status: "starting",
    verificationAttempts: 0,
    rollbackVerificationAttempts: 0,
    githubRepository: env.GITHUB_REPOSITORY || null,
    githubRunId: env.GITHUB_RUN_ID || null,
    githubRunUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null,
  };
  const save = async () => writeReceipt(receiptPath, receipt);
  await save();

  const github = await resolveGithubContext({ env, run });
  receipt.githubRepository = github.repository;
  const openIssue = await findOpenRollbackIssue({
    fetchImpl,
    repository: github.repository,
    githubToken: github.token,
  });
  if (openIssue) {
    receipt.status = "blocked-by-open-rollback-issue";
    receipt.completedAt = now();
    receipt.blockingIssueNumber = openIssue.number;
    await save();
    throw new Error(
      `Production deploy blocked by open issue #${openIssue.number}: ${ROLLBACK_ISSUE_TITLE}`,
    );
  }

  await run("git", ["fetch", "origin", "main"]);
  const head = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  const originMain = (await run("git", ["rev-parse", "origin/main"])).stdout.trim();
  receipt.sourceCommit = head;
  if (!head || head !== originMain) {
    receipt.status = "blocked-by-stale-checkout";
    receipt.completedAt = now();
    receipt.originMainCommit = originMain || null;
    await save();
    throw new Error(`Production deploy requires HEAD == origin/main (${head} != ${originMain})`);
  }

  receipt.previousDeployId = await currentDeployId({ fetchImpl, siteId, netlifyToken });
  receipt.manualRestoreCommand = `npx netlify-cli api restoreSiteDeploy --data '${JSON.stringify({
    site_id: siteId,
    deploy_id: receipt.previousDeployId,
  })}'`;
  receipt.status = "deploying";
  await save();

  const deployResult = await run(
    "npx",
    [
      "netlify-cli",
      "deploy",
      "--prod",
      "--dir=dist/netlify-site",
      "--no-build",
      "--json",
    ],
    { env },
  );
  try {
    receipt.candidateDeployId = parseDeployId(deployResult.stdout);
  } catch {
    const liveDeployId = await currentDeployId({ fetchImpl, siteId, netlifyToken });
    if (liveDeployId === receipt.previousDeployId) {
      throw new Error("Netlify deploy returned no deploy ID and no new live deploy was found");
    }
    receipt.candidateDeployId = liveDeployId;
    receipt.deployIdRecoveredFromLiveSite = true;
  }
  receipt.status = "verifying";
  await save();

  try {
    await verifyWithRetries({
      run,
      env,
      exactManifests: true,
      attempts,
      retryDelayMs,
      sleep,
      onAttempt: (attempt) => {
        receipt.verificationAttempts = attempt;
      },
    });
    receipt.status = "verified";
    receipt.completedAt = now();
    await save();
    return receipt;
  } catch (error) {
    receipt.verificationError = error.message;
  }

  const liveDeployId = await currentDeployId({ fetchImpl, siteId, netlifyToken });
  if (liveDeployId !== receipt.candidateDeployId) {
    receipt.status = "superseded";
    receipt.liveDeployId = liveDeployId;
    receipt.completedAt = now();
    await save();
    try {
      await openOrUpdateRollbackIssue({
        fetchImpl,
        repository: github.repository,
        githubToken: github.token,
        body: rollbackIssueBody(receipt),
      });
    } catch (error) {
      receipt.issueUpdateError = error.message;
      await save();
    }
    throw new Error(
      `Verification failed, but candidate ${receipt.candidateDeployId} is no longer live; no restore attempted`,
    );
  }

  try {
    await restoreDeploy({
      fetchImpl,
      siteId,
      deployId: receipt.previousDeployId,
      netlifyToken,
    });
    receipt.status = "verifying-rollback";
    await save();
    await verifyWithRetries({
      run,
      env,
      exactManifests: false,
      attempts,
      retryDelayMs,
      sleep,
      onAttempt: (attempt) => {
        receipt.rollbackVerificationAttempts = attempt;
      },
    });
    receipt.status = "rolled-back";
  } catch (error) {
    receipt.status = "rollback-failed";
    receipt.rollbackError = error.message;
  }

  receipt.completedAt = now();
  await save();
  try {
    await openOrUpdateRollbackIssue({
      fetchImpl,
      repository: github.repository,
      githubToken: github.token,
      body: rollbackIssueBody(receipt),
    });
  } catch (error) {
    receipt.issueUpdateError = error.message;
    await save();
  }
  throw new Error(
    receipt.status === "rolled-back"
      ? `Production verification failed; restored deploy ${receipt.previousDeployId}`
      : `Production verification failed and rollback did not verify: ${receipt.rollbackError}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployProduction().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

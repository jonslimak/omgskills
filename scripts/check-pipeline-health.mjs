#!/usr/bin/env node

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const shadowMaxAgeHours = Number(process.env.SHADOW_MAX_AGE_HOURS ?? 12);
const stuckMaxMinutes = Number(process.env.STUCK_MAX_MINUTES ?? 90);
const checkedAt = new Date().toISOString();

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

const jobsCache = new Map();

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
  pipelineHealth: "pipeline-health.yml",
};

export const VERIFIED_DEPLOY_WORKFLOWS = [
  "content-reports.yml",
  "deploy-current-main.yml",
  "pipeline-health.yml",
  "publish-collections.yml",
  "scrape.yml",
  "shadow-crawl-health.yml",
  "x-refresh.yml",
];

const shadowStageSteps = {
  crawl: "Run shadow crawl",
  publish: "Publish hosted v2 app data",
  // The shared production deploy succeeds only after structural and live manifest verification.
  verifiedDeploy: "Deploy site to Netlify",
};

async function workflowRuns(filename) {
  const payload = await github(`/repos/${repo}/actions/workflows/${filename}/runs?per_page=20`);
  return payload.workflow_runs ?? [];
}

async function jobsForRun(runId) {
  if (!jobsCache.has(runId)) {
    jobsCache.set(runId, github(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`).then((payload) => payload.jobs ?? []));
  }
  return jobsCache.get(runId);
}

function latestSuccessfulStepAt(jobs, stepName) {
  let latest = null;
  for (const job of jobs) {
    for (const step of job.steps ?? []) {
      if (step.name !== stepName || step.conclusion !== "success" || !step.completed_at) continue;
      if (!latest || step.completed_at > latest) {
        latest = step.completed_at;
      }
    }
  }
  return latest;
}

export async function latestStageSuccess(runs, stepName, loadJobs = jobsForRun) {
  for (const run of runs) {
    const jobs = await loadJobs(run.id);
    const completedAt = latestSuccessfulStepAt(jobs, stepName);
    if (completedAt) {
      return {
        run,
        completedAt,
      };
    }
  }
  return null;
}

export function newestRunsFirst(runs) {
  return [...runs].sort((left, right) => {
    const leftAt = left.created_at ?? left.run_started_at ?? "";
    const rightAt = right.created_at ?? right.run_started_at ?? "";
    return rightAt.localeCompare(leftAt);
  });
}

export function stuckShadowWorkflowIssues(inProgressRuns, nowMs = Date.now(), maxMinutes = stuckMaxMinutes) {
  const issues = [];
  for (const run of inProgressRuns ?? []) {
    if (run.path?.endsWith(`/${workflows.shadowCrawler}`) === false && run.name !== "shadow-crawl-health") continue;
    const ageMinutes = (nowMs - new Date(run.run_started_at).getTime()) / 6e4;
    if (ageMinutes > maxMinutes) {
      issues.push(`workflow stuck: ${run.name} for ${Math.round(ageMinutes)}m`);
    }
  }
  return issues;
}

export function buildShadowCutoverState({ latestV2Publish, latestVerifiedDeploy, latestShadowRun }) {
  const issues = [];
  const publishAt = latestV2Publish?.completedAt ?? null;
  const verifiedDeployAt = latestVerifiedDeploy?.completedAt ?? null;
  const latestRunPendingDeploy =
    latestShadowRun?.status !== "completed" &&
    latestV2Publish?.run?.id === latestShadowRun?.id &&
    publishAt !== null &&
    (verifiedDeployAt === null || verifiedDeployAt < publishAt);

  if (!publishAt) issues.push("No successful v2 publish stage found");
  if (!verifiedDeployAt) {
    issues.push("No successful verified production deploy found");
  } else if (publishAt && verifiedDeployAt < publishAt && !latestRunPendingDeploy) {
    issues.push("Latest v2 publish has no successful verified production deploy");
  }

  return {
    issues,
    publishAt,
    deployAt: verifiedDeployAt,
    verifyAt: verifiedDeployAt,
    verifyConclusion: verifiedDeployAt ? "success" : null,
  };
}

async function main() {
  if (!repo || !token) {
    console.error("check-pipeline-health: missing GITHUB_REPOSITORY or GITHUB_TOKEN");
    process.exit(1);
  }

  const issues = [];
  const sections = {};

  const additionalDeployWorkflows = VERIFIED_DEPLOY_WORKFLOWS.filter(
    (filename) => filename !== workflows.shadowCrawler && filename !== workflows.pipelineHealth,
  );
  const [shadowRuns, pipelineHealthRuns, inProgressRuns, ...additionalDeployRuns] = await Promise.all([
    workflowRuns(workflows.shadowCrawler),
    workflowRuns(workflows.pipelineHealth),
    github(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`),
    ...additionalDeployWorkflows.map((filename) => workflowRuns(filename)),
  ]);
  const latestShadowRun = shadowRuns[0] ?? null;
  const verifiedDeployRuns = newestRunsFirst([
    ...shadowRuns,
    ...pipelineHealthRuns,
    ...additionalDeployRuns.flat(),
  ]);
  const [latestShadowCrawl, latestV2Publish, latestVerifiedDeploy] = await Promise.all([
    latestStageSuccess(shadowRuns, shadowStageSteps.crawl),
    latestStageSuccess(shadowRuns, shadowStageSteps.publish),
    latestStageSuccess(verifiedDeployRuns, shadowStageSteps.verifiedDeploy),
  ]);

  const crawlerIssues = [];
  if (!latestShadowCrawl) {
    crawlerIssues.push("No successful shadow crawl stage found");
  } else if (hoursSince(latestShadowCrawl.completedAt) > shadowMaxAgeHours) {
    crawlerIssues.push(`shadow crawl is stale (${hoursSince(latestShadowCrawl.completedAt).toFixed(1)}h)`);
  }

  crawlerIssues.push(...stuckShadowWorkflowIssues(inProgressRuns.workflow_runs ?? []));

  sections.crawlers = crawlerIssues.length
    ? degraded(crawlerIssues, {
        lastSuccessfulShadowRunAt: latestShadowCrawl?.completedAt ?? null,
        latestWorkflowConclusion: latestShadowRun?.conclusion ?? null,
      })
    : ok({
        lastSuccessfulShadowRunAt: latestShadowCrawl?.completedAt ?? null,
        latestWorkflowConclusion: latestShadowRun?.conclusion ?? null,
      });
  issues.push(...crawlerIssues.map((issue) => `crawlers: ${issue}`));

  const shadowCutover = buildShadowCutoverState({ latestV2Publish, latestVerifiedDeploy, latestShadowRun });
  const shadowIssues = shadowCutover.issues;

  sections.shadowCutover = shadowIssues.length
    ? degraded(shadowIssues, {
        lastSuccessfulV2PublishAt: shadowCutover.publishAt,
        lastSuccessfulDeployAt: shadowCutover.deployAt,
        lastSuccessfulLiveVerifyAt: shadowCutover.verifyAt,
        latestLiveVerifyConclusion: shadowCutover.verifyConclusion,
      })
    : ok({
        lastSuccessfulV2PublishAt: shadowCutover.publishAt,
        lastSuccessfulDeployAt: shadowCutover.deployAt,
        lastSuccessfulLiveVerifyAt: shadowCutover.verifyAt,
        latestLiveVerifyConclusion: shadowCutover.verifyConclusion,
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
    lastShadowCrawlerSuccessAt: latestShadowCrawl?.completedAt ?? null,
    lastV2PublishAt: latestV2Publish?.completedAt ?? null,
    lastV2DeployAt: latestVerifiedDeploy?.completedAt ?? null,
    lastLiveVerifyAt: latestVerifiedDeploy?.completedAt ?? null,
    latestShadowWorkflowConclusion: latestShadowRun?.conclusion ?? null,
  };

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `health_status=${status}`,
      `health_message<<EOF`,
      message,
      `EOF`,
      `last_shadow_crawler_success_at=${latestShadowCrawl?.completedAt ?? ""}`,
      `last_v2_publish_at=${latestV2Publish?.completedAt ?? ""}`,
      `last_v2_deploy_at=${latestVerifiedDeploy?.completedAt ?? ""}`,
      `last_live_verify_at=${latestVerifiedDeploy?.completedAt ?? ""}`,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`check-pipeline-health: ${error.message}`);
    process.exit(1);
  });
}

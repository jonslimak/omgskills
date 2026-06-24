#!/usr/bin/env node

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const shadowMaxAgeHours = Number(process.env.SHADOW_MAX_AGE_HOURS ?? 12);
const stuckMaxMinutes = Number(process.env.STUCK_MAX_MINUTES ?? 90);
const checkedAt = new Date().toISOString();

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
};

const shadowStageSteps = {
  crawl: "Run shadow crawl",
  publish: "Publish hosted v2 app data",
  deploy: "Deploy site to Netlify",
  verify: "Verify live v2 manifest",
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

function latestStepConclusion(jobs, stepName) {
  let latestStep = null;
  for (const job of jobs) {
    for (const step of job.steps ?? []) {
      if (step.name !== stepName) continue;
      if (!latestStep || (step.started_at ?? "") > (latestStep.started_at ?? "")) {
        latestStep = step;
      }
    }
  }
  return latestStep?.conclusion ?? null;
}

async function latestStageSuccess(runs, stepName) {
  for (const run of runs) {
    const jobs = await jobsForRun(run.id);
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

async function main() {
  const issues = [];
  const sections = {};

  const [shadowRuns, inProgressRuns] = await Promise.all([
    workflowRuns(workflows.shadowCrawler),
    github(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`),
  ]);
  const latestShadowRun = shadowRuns[0] ?? null;
  const latestShadowRunJobs = latestShadowRun ? await jobsForRun(latestShadowRun.id) : [];
  const [latestShadowCrawl, latestV2Publish, latestV2Deploy] = await Promise.all([
    latestStageSuccess(shadowRuns, shadowStageSteps.crawl),
    latestStageSuccess(shadowRuns, shadowStageSteps.publish),
    latestStageSuccess(shadowRuns, shadowStageSteps.deploy),
  ]);

  const crawlerIssues = [];
  if (!latestShadowCrawl) {
    crawlerIssues.push("No successful shadow crawl stage found");
  } else if (hoursSince(latestShadowCrawl.completedAt) > shadowMaxAgeHours) {
    crawlerIssues.push(`shadow crawl is stale (${hoursSince(latestShadowCrawl.completedAt).toFixed(1)}h)`);
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
        lastSuccessfulShadowRunAt: latestShadowCrawl?.completedAt ?? null,
        latestWorkflowConclusion: latestShadowRun?.conclusion ?? null,
      })
    : ok({
        lastSuccessfulShadowRunAt: latestShadowCrawl?.completedAt ?? null,
        latestWorkflowConclusion: latestShadowRun?.conclusion ?? null,
      });
  issues.push(...crawlerIssues.map((issue) => `crawlers: ${issue}`));

  const shadowIssues = [];
  const publishAt = latestV2Publish?.completedAt ?? null;
  const deployAt = latestV2Deploy?.completedAt ?? null;
  const verifyConclusion = latestStepConclusion(latestShadowRunJobs, shadowStageSteps.verify);
  if (!publishAt) shadowIssues.push("No successful v2 publish stage found");
  if (!deployAt) shadowIssues.push("No successful deploy stage found");
  if (verifyConclusion !== "success") shadowIssues.push("Latest live v2 verify step did not pass");

  sections.shadowCutover = shadowIssues.length
    ? degraded(shadowIssues, {
        lastSuccessfulV2PublishAt: publishAt,
        lastSuccessfulDeployAt: deployAt,
        latestLiveVerifyConclusion: verifyConclusion,
      })
    : ok({
        lastSuccessfulV2PublishAt: publishAt,
        lastSuccessfulDeployAt: deployAt,
        latestLiveVerifyConclusion: verifyConclusion,
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
    lastV2DeployAt: latestV2Deploy?.completedAt ?? null,
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
      `last_v2_deploy_at=${latestV2Deploy?.completedAt ?? ""}`,
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

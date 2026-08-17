import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShadowCutoverState,
  latestStageSuccess,
  newestRunsFirst,
  stuckShadowWorkflowIssues,
} from "./check-pipeline-health.mjs";

const run = (id, status = "completed") => ({ id, status });
const stage = (id, completedAt) => ({ run: run(id), completedAt });

test("keeps health ok while the latest shadow run is waiting for its guarded deploy", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "in_progress"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestVerifiedDeploy: stage(1, "2026-07-09T04:00:00.000Z"),
  });

  assert.deepEqual(state.issues, []);
});

test("degrades when a completed publish has no later successful guarded deploy", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "completed"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestVerifiedDeploy: stage(1, "2026-07-09T04:00:00.000Z"),
  });

  assert.deepEqual(state.issues, ["Latest v2 publish has no successful verified production deploy"]);
});

test("keeps health ok when the guarded deploy completes after publish", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "completed"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestVerifiedDeploy: stage(2, "2026-07-09T10:05:00.000Z"),
  });

  assert.deepEqual(state.issues, []);
  assert.equal(state.deployAt, "2026-07-09T10:05:00.000Z");
  assert.equal(state.verifyAt, "2026-07-09T10:05:00.000Z");
});

test("degrades when there is no successful guarded deploy in recent runs", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "completed"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestVerifiedDeploy: null,
  });

  assert.deepEqual(state.issues, ["No successful verified production deploy found"]);
});

test("stuck shadow crawl still degrades crawler section", () => {
  const issues = stuckShadowWorkflowIssues(
    [
      {
        name: "shadow-crawl-health",
        path: ".github/workflows/shadow-crawl-health.yml",
        run_started_at: "2026-07-09T08:00:00.000Z",
      },
    ],
    new Date("2026-07-09T10:00:00.000Z").getTime(),
    90,
  );

  assert.deepEqual(issues, ["workflow stuck: shadow-crawl-health for 120m"]);
});

test("uses a newer guarded deploy from pipeline health", async () => {
  const shadowRun = { id: 1, created_at: "2026-08-17T10:00:00.000Z" };
  const pipelineRun = { id: 2, created_at: "2026-08-17T11:00:00.000Z" };
  const jobs = new Map([
    [
      1,
      [{ steps: [{ name: "Deploy site to Netlify", conclusion: "failure", completed_at: null }] }],
    ],
    [
      2,
      [{
        steps: [{
          name: "Deploy site to Netlify",
          conclusion: "success",
          completed_at: "2026-08-17T11:05:00.000Z",
        }],
      }],
    ],
  ]);

  const result = await latestStageSuccess(
    newestRunsFirst([shadowRun, pipelineRun]),
    "Deploy site to Netlify",
    async (runId) => jobs.get(runId) ?? [],
  );

  assert.equal(result.run.id, 2);
  assert.equal(result.completedAt, "2026-08-17T11:05:00.000Z");
});

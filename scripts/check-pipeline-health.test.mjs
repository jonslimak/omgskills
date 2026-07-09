import assert from "node:assert/strict";
import test from "node:test";

import { buildShadowCutoverState, stuckShadowWorkflowIssues } from "./check-pipeline-health.mjs";

const run = (id, status = "completed") => ({ id, status });
const stage = (id, completedAt) => ({ run: run(id), completedAt });

test("keeps health ok when latest shadow run is still waiting for live verify", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "in_progress"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestV2Deploy: stage(2, "2026-07-09T10:04:00.000Z"),
    latestLiveVerify: stage(1, "2026-07-09T04:00:00.000Z"),
  });

  assert.deepEqual(state.issues, []);
});

test("degrades when latest completed publish/deploy has no later successful live verify", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "completed"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestV2Deploy: stage(2, "2026-07-09T10:04:00.000Z"),
    latestLiveVerify: stage(1, "2026-07-09T04:00:00.000Z"),
  });

  assert.deepEqual(state.issues, ["Latest live v2 verify step did not pass"]);
});

test("keeps health ok when live verify is newer than publish and deploy", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "completed"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestV2Deploy: stage(2, "2026-07-09T10:04:00.000Z"),
    latestLiveVerify: stage(2, "2026-07-09T10:05:00.000Z"),
  });

  assert.deepEqual(state.issues, []);
});

test("degrades when there is no successful live verify in recent runs", () => {
  const state = buildShadowCutoverState({
    latestShadowRun: run(2, "completed"),
    latestV2Publish: stage(2, "2026-07-09T10:03:00.000Z"),
    latestV2Deploy: stage(2, "2026-07-09T10:04:00.000Z"),
    latestLiveVerify: null,
  });

  assert.deepEqual(state.issues, ["No successful live v2 verify stage found"]);
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

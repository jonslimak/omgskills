import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/pipeline-health.yml", "utf8");

test("health can inspect current workflow activity", () => {
  assert.match(workflow, /permissions:\n\s+actions: read/);
});

test("health checks cannot enter the shared writer queue", () => {
  assert.match(workflow, /health:\n\s+concurrency:\n\s+group: pipeline-health-check-/);
  assert.match(workflow, /group: pipeline-health-check-[^\n]+\n\s+cancel-in-progress: true/);
});

test("health deploy joins the writer queue only after an idle check", () => {
  assert.match(workflow, /deploy-health:\n\s+needs: health/);
  assert.match(workflow, /needs\.health\.outputs\.writer_busy == 'false'/);
  assert.match(workflow, /deploy-health:[\s\S]*?group: app-data-writers/);
  assert.match(workflow, /name: Check data writer activity[\s\S]*?check-active-data-writers\.mjs/);
});

test("generated health replaces the restored live snapshot before build", () => {
  const prepare = workflow.indexOf("name: Prepare release assets for Netlify deploy");
  const download = workflow.indexOf("name: Download generated health snapshot");
  const build = workflow.indexOf("name: Build combined Netlify artifact");
  const deploy = workflow.indexOf("name: Deploy site to Netlify");

  assert.ok(download !== -1 && download < prepare);
  assert.ok(prepare < build);
  assert.ok(build < deploy);
});

test("health snapshots remain available for guarded deploy recovery", () => {
  assert.match(workflow, /pipeline-health-snapshot-[\s\S]*?retention-days: 7/);
});

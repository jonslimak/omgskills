import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/policy-observation.yml", import.meta.url),
  "utf8",
);

test("policy observation is manual-only and read-only", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.doesNotMatch(workflow, /group: app-data-writers/);
  assert.doesNotMatch(workflow, /\b(?:git add|git commit|git push)\b/);
  assert.doesNotMatch(workflow, /\b(?:publish|deploy:production|netlify-cli deploy|drizzle|migrate)\b/i);
});

test("policy observation checks writers once before crawler work", () => {
  const guardIndex = workflow.indexOf("Refuse to start while a production writer is active");
  const v2Index = workflow.indexOf("Run v2 report-only observation");
  const crawl4Index = workflow.indexOf("Run Crawl 4 report-only observation");
  assert.ok(guardIndex >= 0);
  assert.ok(guardIndex < v2Index);
  assert.ok(guardIndex < crawl4Index);
  assert.equal(workflow.match(/Refuse to start while a production writer is active/g)?.length, 1);
  for (const writer of [
    "scrape.yml",
    "shadow-crawl-health.yml",
    "content-reports.yml",
    "x-refresh.yml",
    "pipeline-health.yml",
  ]) {
    assert.match(workflow, new RegExp(writer.replace(".", "\\.")));
  }
});

test("both policy tracks remain non-publishing and upload their evidence", () => {
  assert.match(workflow, /npm run scrape -- --dry-run/);
  assert.match(workflow, /CRAWL4_POLICY_PRECEDENCE: observe/);
  assert.match(workflow, /v2-policy-input\.shadow\.json/);
  assert.match(workflow, /policy-precedence-input\.shadow\.json/);
  assert.match(workflow, /if-no-files-found: error/g);
});

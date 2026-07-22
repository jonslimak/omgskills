import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/shadow-crawl-health.yml", import.meta.url),
  "utf8",
);

test("shadow crawl stages generated data directories instead of optional asset globs", () => {
  assert.match(workflow, /git add -A -- site\/data\/v2 site\/data\/crawl4/);
  assert.doesNotMatch(workflow, /git add -A --[^\n]*\*\.json/);
});

test("skill equivalence publication is enabled only for its publisher step", () => {
  const step = workflow.match(
    /      - name: Publish skill equivalence\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];

  assert.ok(step, "Publish skill equivalence step missing");
  assert.match(step, /SKILL_EQUIVALENCE_PUBLISH: "1"/);
  assert.equal(workflow.match(/SKILL_EQUIVALENCE_PUBLISH:/g)?.length, 1);
});

test("canonical SHA publication is enabled only for its publisher step", () => {
  const step = workflow.match(
    /      - name: Publish SHA history\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];

  assert.ok(step, "Publish SHA history step missing");
  assert.match(step, /SHA_CANONICAL_PUBLISH: "1"/);
  assert.equal(workflow.match(/SHA_CANONICAL_PUBLISH:/g)?.length, 1);
});

test("policy precedence is observe-only and uploaded for scheduled review", () => {
  const crawlSteps = workflow.match(
    /      - name: Run(?: report-only)? shadow crawl\n[\s\S]*?(?=\n      - name:)/g,
  ) ?? [];

  assert.equal(crawlSteps.length, 2, "scheduled and report-only crawl steps are required");
  for (const crawlStep of crawlSteps) {
    assert.match(crawlStep, /CRAWL4_POLICY_PRECEDENCE: "observe"/);
  }
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE:/g)?.length, 2);
  assert.match(workflow, /Upload policy precedence observation/);
  assert.match(workflow, /Upload report-only policy precedence observation/);
  assert.match(workflow, /policy-precedence\.shadow\.json/);
  assert.match(workflow, /policy-precedence\.shadow\.md/);
  assert.doesNotMatch(workflow, /CRAWL4_POLICY_PRECEDENCE: "(?:admission|enforce)"/);
});

test("report-only dispatch cannot enter the production writer job", () => {
  assert.match(workflow, /report_only:\n[\s\S]*?default: true\n[\s\S]*?type: boolean/);
  assert.match(
    workflow,
    /policy-precedence-report-only:\n    if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.report_only == true \}\}/,
  );
  assert.match(
    workflow,
    /policy-precedence-report-only:[\s\S]*?permissions:\n      contents: read/,
  );
  assert.match(
    workflow,
    /shadow-crawl-health:\n    if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.report_only != true \}\}/,
  );
});

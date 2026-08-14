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

test("skill equivalence publication and impact verification share one explicit mode", () => {
  const writerJob = workflow.match(
    /  shadow-crawl-health:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|\s*$)/,
  )?.[0];

  assert.ok(writerJob, "shadow-crawl-health job missing");
  assert.match(writerJob, /env:\n      # Keep publish and final impact verification[\s\S]*?SKILL_EQUIVALENCE_PUBLISH: "1"/);
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

test("production enforces admission while report-only keeps observing", () => {
  const reportOnlyStep = workflow.match(
    /      - name: Run report-only shadow crawl\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  const writerStep = workflow.match(
    /      - name: Run shadow crawl\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];

  assert.ok(reportOnlyStep, "report-only shadow crawl step missing");
  assert.ok(writerStep, "production shadow crawl step missing");
  assert.match(reportOnlyStep, /CRAWL4_POLICY_PRECEDENCE: "observe"/);
  assert.match(writerStep, /CRAWL4_POLICY_PRECEDENCE: "admission"/);
  assert.match(reportOnlyStep, /CRAWL4_QUALITY_TIERS: "1"/);
  assert.match(writerStep, /CRAWL4_QUALITY_TIERS: "1"/);
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE:/g)?.length, 2);
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE: "observe"/g)?.length, 1);
  assert.equal(workflow.match(/CRAWL4_POLICY_PRECEDENCE: "admission"/g)?.length, 1);
  assert.match(workflow, /Upload policy precedence observation/);
  assert.match(workflow, /Upload report-only policy precedence observation/);
  assert.match(workflow, /policy-precedence\.shadow\.json/);
  assert.match(workflow, /policy-precedence\.shadow\.md/);
  assert.doesNotMatch(workflow, /CRAWL4_POLICY_PRECEDENCE: "enforce"/);
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

test("creator coverage maintenance is bounded, weekly, manual, and stays inside the writer job", () => {
  const writerJob = workflow.match(
    /  shadow-crawl-health:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|\s*$)/,
  )?.[0];

  assert.ok(writerJob, "shadow-crawl-health job missing");
  assert.match(workflow, /creator_coverage:\n[\s\S]*?default: false\n[\s\S]*?type: boolean/);
  assert.match(writerJob, /EVENT_SCHEDULE: \$\{\{ github\.event\.schedule \|\| '' \}\}/);
  assert.match(writerJob, /\[ "\$EVENT_SCHEDULE" = "0 6 \* \* \*" \].*\[ "\$\(date -u \+%u\)" = "7" \]/);
  assert.match(writerJob, /MANUAL_CREATOR_COVERAGE: \$\{\{ inputs\.creator_coverage == true && '1' \|\| '0' \}\}/);
  assert.match(writerJob, /npm run scrape:shadow -- --cadence=fast/);
  assert.match(writerJob, /npm run crawl4:creator-backfill -- --maintain --limit=125/);
  assert.match(writerJob, /name: Run creator coverage maintenance[\s\S]*?name: Run shadow guard tests/);
  assert.match(writerJob, /name: Upload creator coverage maintenance report/);
});

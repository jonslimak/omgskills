import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateWorkflowWriterSafety } from "./check-workflow-writer-locks.mjs";

const file = fileURLToPath(new URL("../.github/workflows/trending-intake.yml", import.meta.url));
const source = readFileSync(file, "utf8");
const steps = source.split("      - name: ").slice(1);
const names = steps.map(step => step.split("\n")[0]);

test("daily intake is disabled until canary approval; manual runs default to report-only", () => {
  assert.match(source, /schedule:\n    - cron: "7 12 \* \* \*"/);
  assert.match(source, /inputs:\n      apply:\n[^]*?default: false\n        type: boolean/);
  assert.match(source, /if: \$\{\{ github.event_name == 'workflow_dispatch' \|\| vars.CRAWL4_TRENDING_INTAKE_ENABLED == '1' \}\}/);
  assert.match(source, /INTAKE_APPLY: \$\{\{ github.event_name == 'schedule' \|\| inputs.apply == true \}\}/);
  assert.doesNotMatch(source, /npm run scrape:shadow|promote:cutover|publication_impact_override|npm publish/);
});

test("intake uses the shared writer lock, strict gates, and complete guarded artifact", () => {
  assert.deepEqual(validateWorkflowWriterSafety(source, file), []);
  const before = (a, b) => assert.ok(names.indexOf(a) >= 0 && names.indexOf(a) < names.indexOf(b), `${a} must precede ${b}`);
  before("Sync latest main", "Refresh Trending only");
  before("Validate policy and snapshot publication baselines", "Verify up to 20 unreviewed Trending candidates");
  before("Publish and verify both tracks", "Check publication impact");
  before("Check publication impact", "Upload publication assets");
  before("Commit verified intake", "Build combined Netlify artifact");
  before("Prepare release assets for Netlify deploy", "Build combined Netlify artifact");
  before("Build combined Netlify artifact", "Deploy site to Netlify");
  for (const name of ["Commit verified intake", "Publish and verify both tracks", "Deploy site to Netlify"]) {
    assert.match(steps[names.indexOf(name)], /\n        if: env.INTAKE_APPLY == 'true'\n/);
  }
  assert.match(source, /if: always\(\) && steps\.production_deploy\.outcome != 'skipped'/);
});

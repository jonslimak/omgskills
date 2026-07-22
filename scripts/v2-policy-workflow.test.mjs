import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/scrape.yml", import.meta.url),
  "utf8",
);

test("scheduled v2 policy remains observe-only and uploads its report before publishing", () => {
  const scrapeStep = workflow.match(
    /      - name: Run scraper\n[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  assert.ok(scrapeStep, "Run scraper step missing");
  assert.match(scrapeStep, /V2_POLICY_MODE: "observe"/);
  assert.equal(workflow.match(/V2_POLICY_MODE:/g)?.length, 1);
  assert.doesNotMatch(workflow, /V2_POLICY_MODE: "enforce"/);
  assert.match(workflow, /Upload v2 policy observation/);
  assert.match(workflow, /v2-policy-diff\.shadow\.json/);
  assert.ok(workflow.indexOf("Upload v2 policy observation") < workflow.indexOf("Publish hosted app data"));
});

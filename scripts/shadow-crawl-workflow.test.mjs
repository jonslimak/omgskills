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

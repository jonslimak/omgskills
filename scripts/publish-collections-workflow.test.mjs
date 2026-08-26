import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = "../.github/workflows/publish-collections.yml";
const workflow = await readFile(new URL(path, import.meta.url), "utf8");

function position(value) {
  const index = workflow.indexOf(value);
  assert.notEqual(index, -1, `workflow is missing ${value}`);
  return index;
}

test("collection publisher uses the shared writer and exact source commit", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /expected_sha:/);
  assert.match(workflow, /group: app-data-writers/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /node-version: "20\.19\.5"/);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /git reset --hard origin\/main/);
  assert.match(workflow, /git rev-parse HEAD[^\n]*EXPECTED_SHA/);
  assert.match(workflow, /git rev-parse origin\/main[^\n]*EXPECTED_SHA/);
});

test("collection publisher validates, publishes one shared asset, then pushes", () => {
  const validate = position("npm run collections:verify-images");
  const publish = position("npm run publish:collections");
  const verify = position("- name: Verify generated collection assets");
  const commit = position("- name: Commit and push collection assets");
  const push = position("git push origin HEAD:main");
  const deploy = position("npm run deploy:production");

  assert.ok(validate < publish && publish < verify && verify < commit && commit < push && push < deploy);
  assert.match(workflow, /v2 and Crawl 4 must reference one shared collections asset/);
  assert.match(workflow, /cmp "site\/data\/v2\/\$v2_asset" "site\/data\/crawl4\/\$crawl4_asset"/);
  assert.match(workflow, /unexpected publisher change/);
  assert.match(workflow, /publisher produced no changes/);
  assert.match(workflow, /PUBLICATION_IMPACT_OVERRIDE: \$\{\{ inputs\.publication_impact_override == true && '1' \|\| '' \}\}/);
  assert.match(workflow, /PUBLICATION_IMPACT_OVERRIDE_REASON: \$\{\{ inputs\.publication_impact_override_reason \|\| '' \}\}/);
});

test("collection publisher uses the combined deploy and verifies its narrow contract", () => {
  const deploy = position("npm run deploy:production");
  const liveImages = position("npm run collections:verify-images -- --live");
  const appcast = position("- name: Confirm public appcast is unchanged");

  assert.ok(deploy < liveImages && liveImages < appcast);
  assert.doesNotMatch(workflow, /VITE_SKILLGROUPS_AUTH_ENABLED/);
  assert.match(workflow, /name: Upload production deploy receipt[\s\S]*?dist\/netlify-deploy-receipt\.json/);
  assert.doesNotMatch(workflow, /git tag|--tag-release|netlify-cli deploy/);
});

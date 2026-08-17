import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy-current-main.yml", import.meta.url), "utf8");
const wrapper = await readFile(new URL("./deploy-current-main-prod.sh", import.meta.url), "utf8");

test("recovery deploy is manual, serialized, and pinned to reviewed main", () => {
  assert.match(workflow, /workflow_dispatch:[\s\S]*?expected_sha:/);
  assert.match(workflow, /group: app-data-writers/);
  assert.match(workflow, /git reset --hard origin\/main/);
  assert.match(workflow, /git rev-parse HEAD[\s\S]*?EXPECTED_SHA/);
  assert.doesNotMatch(workflow, /git push|git tag/);
});

test("recovery deploy restores health, builds the combined site, and uploads its receipt", () => {
  const restore = workflow.indexOf("Restore latest health snapshot");
  const prepare = workflow.indexOf("Prepare release assets for Netlify deploy");
  const build = workflow.indexOf("npm run build:netlify");
  const deploy = workflow.indexOf("npm run deploy:production");
  assert.ok(restore !== -1 && restore < prepare);
  assert.ok(prepare < build && build < deploy);
  assert.match(workflow, /dist\/netlify-deploy-receipt\.json/);
  assert.match(workflow, /Confirm public appcast is unchanged/);
});

test("local dispatcher requires a clean checkout exactly at origin main", () => {
  assert.match(wrapper, /git status --porcelain/);
  assert.match(wrapper, /git fetch origin main/);
  assert.match(wrapper, /expected_sha[\s\S]*?origin_sha/);
  assert.match(wrapper, /git remote get-url origin/);
  assert.doesNotMatch(wrapper, /gh repo view/);
  assert.match(wrapper, /gh workflow run deploy-current-main\.yml/);
  assert.match(wrapper, /gh run watch/);
  assert.doesNotMatch(wrapper, /netlify|git push|git tag/);
});

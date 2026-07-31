import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-site-prod.sh", import.meta.url), "utf8");
const workflowPaths = [
  "../.github/workflows/scrape.yml",
  "../.github/workflows/content-reports.yml",
  "../.github/workflows/x-refresh.yml",
  "../.github/workflows/shadow-crawl-health.yml",
  "../.github/workflows/pipeline-health.yml",
  "../.github/workflows/publish-collections.yml",
];

test("manual production deploy uses the guarded combined artifact in order", () => {
  const commands = [
    "node ./scripts/prepare-netlify-site-deploy.mjs",
    "npm ci",
    "npm run build:netlify",
    "npm run deploy:production",
  ];

  let previousIndex = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    assert.notEqual(index, -1, `missing command: ${command}`);
    assert.ok(index > previousIndex, `command is out of order: ${command}`);
    previousIndex = index;
  }

  assert.doesNotMatch(script, /--dir=site(?:\s|$)/);
  assert.doesNotMatch(script, /netlify-cli deploy --prod/);
});

test("manual production deploy never tags a Mac release without explicit opt-in", () => {
  const optIn = 'if [ "${1:-}" = "--tag-release" ]';
  const guard = 'if [ "$TAG_RELEASE" = true ]';
  const tag = 'git tag "v$VERSION"';

  assert.match(script, /TAG_RELEASE=false/);
  assert.notEqual(script.indexOf(optIn), -1);
  assert.notEqual(script.indexOf(guard), -1);
  assert.ok(script.indexOf(tag) > script.indexOf(guard));
  assert.match(script, /Mac release tagging skipped/);
  assert.match(script, /Usage: \.\/scripts\/deploy-site-prod\.sh \[--tag-release\]/);
});

test("manual production deploy keeps Skill Groups auth disabled", () => {
  const gate = "export VITE_SKILLGROUPS_AUTH_ENABLED=0";
  const build = "npm run build:netlify";

  assert.notEqual(script.indexOf(gate), -1);
  assert.ok(script.indexOf(gate) < script.indexOf(build));
});

test("manual production deploy checks generated config and every deploy input", () => {
  assert.match(script, /\.netlify\/netlify\.toml/);
  assert.match(script, /PRODUCTION_ORIGIN="https:\/\/omgskills\.com"/);
  assert.doesNotMatch(script, /\$\{PRODUCTION_ORIGIN/);
  for (const input of [".github/workflows", "netlify", "package-lock.json", "portal", "scripts", "site"]) {
    assert.match(script, new RegExp(`\\n  ${input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n`));
  }
});

test("all seven production paths use the shared deploy helper", async () => {
  assert.match(script, /npm run deploy:production/);
  assert.doesNotMatch(script, /netlify-cli deploy --prod/);

  for (const workflowPath of workflowPaths) {
    const source = await readFile(new URL(workflowPath, import.meta.url), "utf8");
    assert.match(source, /npm run deploy:production/, workflowPath);
    assert.doesNotMatch(source, /netlify-cli deploy --prod/, workflowPath);
    assert.match(source, /dist\/netlify-deploy-receipt\.json/, workflowPath);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-site-prod.sh", import.meta.url), "utf8");
const netlifyConfig = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const workflowPaths = [
  "../.github/workflows/deploy-current-main.yml",
  "../.github/workflows/scrape.yml",
  "../.github/workflows/content-reports.yml",
  "../.github/workflows/x-refresh.yml",
  "../.github/workflows/shadow-crawl-health.yml",
  "../.github/workflows/pipeline-health.yml",
  "../.github/workflows/publish-collections.yml",
];

test("manual production deploy uses the guarded combined artifact in order", () => {
  const commands = [
    "node ./scripts/restore-health-snapshot.mjs",
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

test("production deploy paths use the tracked feature configuration", async () => {
  const productionFeatures = JSON.parse(
    await readFile(new URL("../config/production-features.json", import.meta.url), "utf8"),
  );
  assert.equal(productionFeatures.skillGroupsAuthEnabled, false);
  assert.doesNotMatch(script, /VITE_SKILLGROUPS_AUTH_ENABLED/);
  for (const workflowPath of workflowPaths) {
    const source = await readFile(new URL(workflowPath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /VITE_SKILLGROUPS_AUTH_ENABLED/, workflowPath);
  }
});

test("manual production deploy checks generated config and every deploy input", () => {
  assert.match(script, /\.netlify\/netlify\.toml/);
  assert.match(script, /PRODUCTION_ORIGIN="https:\/\/omgskills\.com"/);
  assert.doesNotMatch(script, /\$\{PRODUCTION_ORIGIN/);
  for (const input of [".github/workflows", "config", "netlify", "package-lock.json", "portal", "scripts", "site"]) {
    assert.match(script, new RegExp(`\\n  ${input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n`));
  }
});

test("all production paths prepare, build, and use the shared deploy helper in order", async () => {
  assert.match(script, /npm run deploy:production/);
  assert.doesNotMatch(script, /netlify-cli deploy --prod/);

  for (const workflowPath of workflowPaths) {
    const source = await readFile(new URL(workflowPath, import.meta.url), "utf8");
    const restoreIndex = source.indexOf("Restore latest health snapshot");
    const prepareIndex = source.indexOf("node ./scripts/prepare-netlify-site-deploy.mjs");
    const buildIndex = source.indexOf("npm run build:netlify");
    const deployIndex = source.indexOf("npm run deploy:production");

    if (!workflowPath.endsWith("pipeline-health.yml")) {
      assert.notEqual(restoreIndex, -1, `${workflowPath}: missing health restore step`);
      assert.ok(restoreIndex < prepareIndex, `${workflowPath}: health restore must run before prepare`);
    }
    assert.notEqual(prepareIndex, -1, `${workflowPath}: missing prepare step`);
    assert.notEqual(buildIndex, -1, `${workflowPath}: missing build step`);
    assert.notEqual(deployIndex, -1, `${workflowPath}: missing deploy step`);
    assert.ok(prepareIndex < buildIndex, `${workflowPath}: prepare must run before build`);
    assert.ok(buildIndex < deployIndex, `${workflowPath}: build must run before deploy`);
    assert.match(source, /npm run deploy:production/, workflowPath);
    assert.doesNotMatch(source, /netlify-cli deploy --prod/, workflowPath);
    assert.match(source, /dist\/netlify-deploy-receipt\.json/, workflowPath);
  }
});

test("manual deploys package health auth and keep health JSON private", () => {
  assert.match(netlifyConfig, /\[build\][\s\S]*?edge_functions = "netlify\/edge-functions"/);
  assert.match(netlifyConfig, /path = "\/health\/\*"\s+function = "health-basic-auth"/);
  assert.match(netlifyConfig, /path = "\/data\/health\.json"\s+function = "health-basic-auth"/);

  const generalDataHeaders = netlifyConfig.indexOf('for = "/data/*"');
  const healthHeaders = netlifyConfig.indexOf('for = "/data/health.json"');
  assert.ok(generalDataHeaders !== -1 && healthHeaders > generalDataHeaders);
  assert.match(
    netlifyConfig.slice(healthHeaders),
    /for = "\/data\/health\.json"[\s\S]*?Cache-Control = "private, no-store"/,
  );
  assert.match(
    netlifyConfig,
    /for = "\/app\/release-config\.json"[\s\S]*?Cache-Control = "no-store"/,
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("deploy preparation validates policy before generating artifacts", async () => {
  const value = await source("./prepare-netlify-site-deploy.mjs");
  assert.match(value, /--profile", "deploy"/);
  assert.match(value, /runPreparationSequence\(\{[\s\S]*?verifyPolicy,/);
  assert.ok(value.indexOf("await steps.verifyPolicy()") < value.indexOf("await steps.verifyCreatorHandleReservations()"));
  assert.ok(value.indexOf("await steps.verifyCollectionImages()") < value.indexOf("await steps.runWebLibraryBuild()"));
});

test("scheduled v2 crawl validates policy before scraping", async () => {
  const value = await source("../.github/workflows/scrape.yml");
  assert.ok(value.indexOf("npm run policy:validate -- --profile scheduled-data") < value.indexOf("npm run scrape\n"));
});

test("scheduled Crawl 4 validates policy before crawling", async () => {
  const value = await source("../.github/workflows/shadow-crawl-health.yml");
  assert.ok(value.indexOf("npm run policy:validate -- --profile scheduled-data") < value.indexOf("npm run scrape:shadow"));
});

test("health and manual deploys install policy validator dependencies first", async () => {
  const health = await source("../.github/workflows/pipeline-health.yml");
  assert.ok(health.indexOf("Install policy validation dependencies") < health.indexOf("Prepare release assets for Netlify deploy"));

  const manual = await source("./deploy-site-prod.sh");
  assert.ok(manual.indexOf("npm --prefix index ci") < manual.indexOf("node ./scripts/prepare-netlify-site-deploy.mjs"));
});

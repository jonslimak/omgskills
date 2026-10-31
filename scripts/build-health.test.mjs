import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./build-health.mjs", import.meta.url));
const crawlAt = "2026-10-31T12:36:02Z";
const publishAt = "2026-10-31T12:36:19Z";
const previousDeployAt = "2026-10-31T06:39:00Z";
const checkedAt = "2026-10-31T12:57:53Z";

function buildHealth(t, { crawl = crawlAt, publish = publishAt, deploy = previousDeployAt } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omgskills-build-health-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function save(path, value) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  }
  const assets = Object.fromEntries(["skills", "trending", "skillSignals", "authorSignals", "authorLeaderboards"]
    .map(name => [name, { path: `${name}.json` }]));
  save("site/data/manifest.json", assets);
  save("site/data/v2/manifest.json", { generatedAt: publish, skills: assets.skills, trending: assets.trending });
  for (const asset of Object.values(assets)) save(`site/data/${asset.path}`, [{}]);
  for (const name of ["skills", "trending"]) save(`site/data/v2/${assets[name].path}`, [{}]);
  save("index/gold-basket.json", [{ gh_enriched_at: crawlAt }]);
  save("index/stats.json", {});
  save("index/dashboard.html", "fixture");
  save("site/data/health.json", {
    sections: { crawlerPublishSummary: { lastPassedAt: previousDeployAt } },
  });
  const pipeline = {
    status: "ok",
    lastShadowCrawlerSuccessAt: crawl,
    lastV2PublishAt: publish,
    lastV2DeployAt: deploy,
    sections: { crawlers: { status: "ok" }, shadowCutover: { status: "ok" } },
  };
  const product = {
    status: "ok",
    sections: Object.fromEntries(["release", "v2AppData", "search"].map(name => [name, { status: "ok" }])),
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("HEALTH_") && name !== "GITHUB_OUTPUT"));
  execFileSync(process.execPath, [script], {
    cwd: root,
    env: { ...env, HEALTH_CHECKED_AT: checkedAt, HEALTH_PIPELINE_JSON: JSON.stringify(pipeline), HEALTH_PRODUCT_JSON: JSON.stringify(product) },
  });
  return JSON.parse(readFileSync(join(root, "site/data/health.json"), "utf8"));
}

test("a published crawl awaiting its guarded deploy has an accurate non-passing summary", t => {
  const health = buildHealth(t);
  const summary = health.sections.crawlerPublishSummary;
  assert.equal(summary.status, "degraded");
  assert.equal(summary.message, "v2 publish is awaiting a verified production deploy");
  assert.deepEqual(summary.issues, [summary.message]);
  assert.equal(summary.lastPassedAt, previousDeployAt);
  assert.equal(health.status, "degraded");
  assert.match(health.message, /awaiting a verified production deploy/);
  assert.doesNotMatch(health.message, /status unavailable/);
});

test("a successful verified deployment clears the pending summary", t => {
  const health = buildHealth(t, { deploy: "2026-10-31T13:02:41Z" });
  const summary = health.sections.crawlerPublishSummary;
  assert.equal(summary.status, "ok");
  assert.equal(summary.message, "v2 publish is current");
  assert.deepEqual(summary.issues, []);
  assert.equal(summary.lastPassedAt, checkedAt);
  assert.equal(health.status, "ok");
});

test("a deploy before publication cannot verify the newly published catalog", t => {
  const health = buildHealth(t, { deploy: "2026-10-31T12:36:05Z" });
  assert.equal(health.sections.crawlerPublishSummary.status, "degraded");
  assert.match(health.message, /awaiting a verified production deploy/);
  assert.equal(health.status, "degraded");
});

test("equivalent timestamp formats recognize the same verified publication instant", t => {
  const health = buildHealth(t, { deploy: "2026-10-31T12:36:19.000Z" });
  assert.equal(health.sections.crawlerPublishSummary.status, "ok");
  assert.equal(health.status, "ok");
});

test("a missing verified deploy timestamp still fails explicitly", t => {
  const health = buildHealth(t, { deploy: null });
  assert.equal(health.sections.crawlerPublishSummary.status, "degraded");
  assert.match(health.message, /deploy timestamp unavailable/);
  assert.equal(health.status, "degraded");
});

test("a stale publication still fails even when deployment succeeded", t => {
  const health = buildHealth(t, { publish: "2026-10-31T11:00:00Z", deploy: "2026-10-31T13:02:41Z" });
  assert.equal(health.sections.crawlerPublishSummary.status, "degraded");
  assert.match(health.message, /shadow crawl is newer than live v2 publish/);
  assert.equal(health.status, "degraded");
});

test("a missing crawl timestamp does not become a pending or successful deployment", t => {
  const health = buildHealth(t, { crawl: null });
  assert.equal(health.sections.crawlerPublishSummary.status, "degraded");
  assert.match(health.message, /last shadow crawl timestamp unavailable/);
  assert.equal(health.status, "degraded");
});

test("genuinely unavailable timestamps retain the unknown non-passing state", t => {
  const health = buildHealth(t, { crawl: null, publish: null, deploy: null });
  assert.equal(health.sections.crawlerPublishSummary.status, "unknown");
  assert.equal(health.sections.crawlerPublishSummary.message, "crawler/publish status unavailable");
  assert.equal(health.status, "degraded");
});

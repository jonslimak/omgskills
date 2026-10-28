import test from "node:test";
import assert from "node:assert/strict";
import { breakdownRows, isWebAppPage, webAppFunnel } from "./check-funnel-health.mjs";

test("breakdown fetching uses the supported limit without invented pagination", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const rows = Array.from({ length: 50 }, () => ({ path: "/", page_views: 1 }));
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: rows }));
  };
  try {
    assert.deepEqual(await breakdownRows("https://example.invalid/breakdown?start=today", {}), rows);
    assert.deepEqual(calls, ["https://example.invalid/breakdown?start=today&limit=50"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("documented API paths and flat click rows are counted", () => {
  const funnel = webAppFunnel([
    { path: "/", page_views: 10, unique_visitors: 8 },
    { path: "/app/library/", page_views: 4, unique_visitors: 2 },
    { path: "/library/anthropics/", page_views: 3, unique_visitors: 2 },
  ], [
    { page: "/library/anthropics/", target: "App Search", clicks: 2 },
    { page: "/library/anthropics/", target: "App Skill Open", clicks: 3 },
  ]);
  assert.equal(funnel.webVisitors, 8);
  assert.equal(funnel.webAppPageViews, 17);
  assert.equal(funnel.webSearches, 2);
  assert.equal(funnel.webSkillOpens, 3);
});

test("the web app funnel counts the front door, app pages and named app events", () => {
  const pages = [
    { page: "/", page_group: "root", page_views: 10, unique_visitors: 8 },
    { page: "/developers/", page_group: "root", page_views: 2, unique_visitors: 2 },
    { page: "/app/library/trending/", page_group: "app", page_views: 3, unique_visitors: 1 },
    { page: "/home/", page_group: "root", page_views: 50, unique_visitors: 40 },
  ];
  const clicks = [
    { page: "/", top_targets: [{ target: "App Search", clicks: 2 }, { target: "Hero Download Mac DMG", clicks: 9 }] },
    { page: "/app/library/anthropics/", top_targets: [{ target: "App Search", clicks: 1 }, { target: "App Skill Open", clicks: 3 },
      { target: "App Copy Install", clicks: 1 }, { target: "App Setup Download", clicks: 1 }] },
  ];
  const funnel = webAppFunnel(pages, clicks);
  assert.equal(funnel.webVisitors, 8);
  assert.equal(funnel.webAppPageViews, 15);
  assert.equal(funnel.webSearches, 3);
  assert.equal(funnel.webSkillOpens, 3);
  assert.equal(funnel.webCopyInstalls, 1);
  assert.equal(funnel.webSetupDownloads, 1);
  assert.equal(funnel.webInstallStarts, 0);
  assert.equal(funnel.webSearchRate, 0.375);
  assert.equal(isWebAppPage({ page: "/home/", page_group: "root" }), false);
});

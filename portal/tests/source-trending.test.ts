import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { sourceTrendingUrl, type SourceTrendingFeed } from "../../scripts/source-trending-format.mjs";
import { loadSourceTrending, sourceTrendingDestination, sourceTrendingIsStale } from "../src/app/unified/source-trending";
import { SourceTrendingRows } from "../src/app/unified/SourceTrending";

const feed: SourceTrendingFeed = { version: 1, source: "skills.sh", board: "trending", fetchedAt: "2026-11-09T10:00:00Z",
  entries: [{ source: "new/repo", skillId: "new", name: "New skill", rank: 1, installs24h: 123,
    sourceUrl: sourceTrendingUrl("new/repo", "new") }, { source: "known/repo", skillId: "known", name: "Known skill", rank: 13,
    installs24h: 12, sourceUrl: sourceTrendingUrl("known/repo", "known"), catalogId: "known/repo:known" }] };
const bytes = JSON.stringify(feed), sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = { sourceTrending: { path: `source-trending-${sha256.slice(0, 12)}.json`, sha256, bytes: Buffer.byteLength(bytes) } };

test("loads verified raw feed, not legacy Trending, with no authenticated requests", async () => {
  const urls: string[] = [];
  const result = await loadSourceTrending(new AbortController().signal, async (url, init) => {
    urls.push(url); assert.equal(init?.credentials, "omit");
    return new Response(JSON.stringify(url.endsWith("manifest.json") ? manifest : feed));
  });
  assert.deepEqual(result, feed);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes("source-trending-"));
});

test("falls back to the v2 source feed, never substitutes the old filtered feed", async () => {
  const urls: string[] = [];
  const result = await loadSourceTrending(new AbortController().signal, async url => {
    urls.push(url);
    if (url.startsWith("/data/crawl4/")) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(url.endsWith("manifest.json") ? manifest : feed));
  });
  assert.deepEqual(result, feed); assert.equal(urls.length, 3);
  await assert.rejects(loadSourceTrending(new AbortController().signal, async () => new Response(JSON.stringify({ trending: manifest.sourceTrending }))), /unavailable/);
});

test("rejects tampering and unsafe manifest paths, and aborts without fallback", async () => {
  await assert.rejects(loadSourceTrending(new AbortController().signal, async url =>
    new Response(url.endsWith("manifest.json") ? JSON.stringify(manifest) : bytes + " ")), /unavailable/);
  let assetFetches = 0;
  await assert.rejects(loadSourceTrending(new AbortController().signal, async url => {
    if (!url.endsWith("manifest.json")) assetFetches++;
    return new Response(JSON.stringify({ sourceTrending: { ...manifest.sourceTrending, path: "https://evil.test/data.json" } }));
  }), /unavailable/);
  assert.equal(assetFetches, 0);
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(loadSourceTrending(controller.signal, async () => { calls++; controller.abort(); throw new Error("cancelled"); }), /cancelled/);
  assert.equal(calls, 1);
});

test("old successful fetches remain visibly stale regardless of manifest publication time", () => {
  assert.equal(sourceTrendingIsStale(feed, Date.parse("2026-11-09T11:00:00Z")), false);
  assert.equal(sourceTrendingIsStale(feed, Date.parse("2026-11-11T11:00:00Z")), true);
});

test("unindexed entries render source links only, while indexed entries open catalog details", () => {
  const html = renderToStaticMarkup(createElement(SourceTrendingRows, { entries: feed.entries, onOpen() {} }));
  // Our list counts 1, 2, 3 even when source ranks have gaps (13 here).
  assert.match(html, /<span class="ua-rank">2<\/span>/);
  assert.doesNotMatch(html, />13</);
  assert.match(html, /href="https:\/\/github.com\/new\/repo"/);
  assert.match(html, /aria-label="View New skill on GitHub, not reviewed"/);
  assert.match(html, /Not reviewed/);
  assert.match(html, /<button[^>]+aria-label="Open Known skill"/);
  assert.doesNotMatch(html, /Open New skill|Install|omgskills:\/\//);
  assert.ok(html.indexOf("New skill") < html.indexOf("Known skill"));
});

test("links known repositories and domains directly, without guessing a skill file path", () => {
  assert.deepEqual(sourceTrendingDestination({ source: "Owner/Repo", skillId: "nested-skill" }),
    { href: "https://github.com/Owner/Repo", label: "GitHub" });
  assert.deepEqual(sourceTrendingDestination({ source: "uizze.sh", skillId: "ui-taste" }),
    { href: "https://uizze.sh/", label: "uizze.sh" });
  assert.deepEqual(sourceTrendingDestination({ source: "open.feishu.cn", skillId: "lark-shared" }),
    { href: "https://open.feishu.cn/", label: "open.feishu.cn" });
  assert.deepEqual(sourceTrendingDestination({ source: "opaque-label", skillId: "skill" }),
    { href: "https://skills.sh/opaque-label/skill", label: "skills.sh" });
  for (const source of ["javascript:alert(1)", "https://evil.test", "../repo", "owner/..", "localhost", "127.0.0.1"]) {
    const destination = sourceTrendingDestination({ source, skillId: "skill" });
    assert.equal(new URL(destination.href).origin, "https://skills.sh");
  }
});

test("non-GitHub entries use the original website and remain unreviewed external links", () => {
  const entry = { ...feed.entries[0], source: "uizze.sh", skillId: "ui-taste", name: "UI taste" };
  const html = renderToStaticMarkup(createElement(SourceTrendingRows, { entries: [entry], onOpen() {} }));
  assert.match(html, /href="https:\/\/uizze.sh\/"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /View UI taste on uizze.sh, not reviewed/);
  assert.doesNotMatch(html, /<button|Install|omgskills:\/\//);
});

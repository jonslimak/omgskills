import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIndexStateMatchesSitemap,
  isNoindexPage,
} from "./web-library-index-verification.mjs";

const canonical = "https://omgskills.com/skills/example/repo/skill/";
const sitemapEntry = `<url><loc>${canonical}</loc></url>`;

test("detects generated noindex metadata", () => {
  assert.equal(isNoindexPage('<meta name="robots" content="noindex,follow">'), true);
  assert.equal(isNoindexPage("<title>Indexable</title>"), false);
});

test("accepts an indexable page present in the sitemap", () => {
  assert.doesNotThrow(() => assertIndexStateMatchesSitemap({
    html: "<title>Indexable</title>",
    sitemap: sitemapEntry,
    canonical,
    label: "test sitemap",
  }));
});

test("accepts a noindex page absent from the sitemap", () => {
  assert.doesNotThrow(() => assertIndexStateMatchesSitemap({
    html: '<meta name="robots" content="noindex,follow">',
    sitemap: "<urlset></urlset>",
    canonical,
    label: "test sitemap",
  }));
});

test("rejects mismatches between page metadata and sitemap membership", () => {
  assert.throws(() => assertIndexStateMatchesSitemap({
    html: '<meta name="robots" content="noindex,follow">',
    sitemap: sitemapEntry,
    canonical,
    label: "test sitemap",
  }), /expected .* to be excluded from the sitemap/);

  assert.throws(() => assertIndexStateMatchesSitemap({
    html: "<title>Indexable</title>",
    sitemap: "<urlset></urlset>",
    canonical,
    label: "test sitemap",
  }), /expected .* to be included in the sitemap/);
});

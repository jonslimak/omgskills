import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, records, sourceAsset } from "./search-catalog.test.mjs";
import { prepareSearchCatalog } from "./search-catalog.mjs";
import { verifyHostedSearchCatalog } from "./verify-hosted-search-catalog.mjs";

test("read-only hosted verification checks the whole closure, mutable manifest and immutable hashes on the supplied origin", async context => {
  const dir = fixture(context), manifest = { skills: sourceAsset(dir, records), generatedAt: "2026-10-16" };
  prepareSearchCatalog(dir, manifest, {}, true, true); writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  let calls = 0, active = 0, maximum = 0;
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, "https://draft.example.test"); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; calls++;
    const path = new URL(url).pathname.split("/").at(-1);
    return new Response(readFileSync(join(dir, path)), { headers: { "content-type": "application/json", "cache-control": path === "manifest.json" ? "public, max-age=60, must-revalidate" : "public, max-age=31536000, immutable" } });
  };
  const receipt = await verifyHostedSearchCatalog({ origin: "https://draft.example.test", dataDir: dir, fetchImpl: fetcher });
  assert.equal(calls, receipt.assets.length + 1); assert.ok(maximum <= 4);
  for (const mode of ["corrupt", "immutable-manifest", "changed-manifest", "wrong-type"]) {
    await assert.rejects(verifyHostedSearchCatalog({ origin: "https://draft.example.test", dataDir: dir, fetchImpl: async (url, init) => {
      const response = await fetcher(url, init);
      if (mode === "immutable-manifest") response.headers.set("cache-control", "immutable");
      if (mode === "wrong-type") response.headers.set("content-type", "text/html");
      if (mode === "changed-manifest" && url.endsWith("manifest.json")) return Response.json({ ...manifest, generatedAt: "changed" });
      if (mode === "corrupt" && !url.endsWith("manifest.json")) return new Response("{}", { headers: response.headers });
      return response;
    } }));
  }
  await assert.rejects(verifyHostedSearchCatalog({ origin: "http://draft.example.test", dataDir: dir, fetchImpl: fetcher }));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import productionFeatures from "../../config/production-features.json";
import { inventoryConnectionRequest, productionConnectedProfile, productionInventoryConsent } from "../src/production-connected";
import { createPairingConsent } from "../src/browser-pairing";
import { catalogInstallAction } from "../src/app/unified/public-install";
import { productionDistribution } from "../src/app/unified/production-distribution";
import { candidateDistribution } from "../src/candidate/distribution";
import { CatalogInstallIntentStore } from "../src/app/unified/catalog-install-intent";
import type { CatalogInstallSetup } from "../src/app/unified/CatalogInstallSetup";
import type { SkillDisplay } from "../src/app/unified/model";

const enabled = { ...productionFeatures, connectedInventoryReadEnabled: true, connectedInventorySyncEnabled: true };
const disabled = { ...enabled, connectedInventoryReadEnabled: false, connectedInventorySyncEnabled: false };

test("production inventory and installs are opt-in, separate from test flags, and keep reads when paused", () => {
  const href = "https://omgskills.com/app/my-skills";
  assert.deepEqual(productionConnectedProfile(href, "pk_live_fixture"), { inventory: true, sync: true });
  assert.deepEqual(productionConnectedProfile(href, "pk_live_fixture", disabled), { inventory: false, sync: false });
  assert.deepEqual(productionConnectedProfile(href, "pk_live_fixture", enabled), { inventory: true, sync: true });
  assert.deepEqual(productionConnectedProfile(href, "pk_live_fixture", { ...enabled, connectedInventorySyncEnabled: false }),
    { inventory: true, sync: false });
  for (const [url, key] of [[href, "pk_test_fixture"], ["https://omgskills-setup-test-f3b.netlify.app/app/", "pk_live_fixture"],
    ["http://127.0.0.1:5203/app/", "pk_live_fixture"]]) {
    assert.deepEqual(productionConnectedProfile(url, key, enabled), { inventory: false, sync: false });
  }
});

test("production consent uses the gated normal API, strips private access and cannot approve while off", async () => {
  assert.equal(inventoryConnectionRequest(""), "none");
  assert.equal(inventoryConnectionRequest("?inventory=3"), "valid");
  assert.equal(inventoryConnectionRequest("?inventory=3&__clerk_handshake=temporary"), "valid");
  assert.equal(inventoryConnectionRequest("?inventory=3&inventory=3"), "invalid");
  assert.equal(inventoryConnectionRequest("?inventory=other"), "invalid");
  const state = "a".repeat(43);
  const hash = `#state=${state}&code_challenge=${"b".repeat(43)}&scope=sync:write&scope=self:revoke&scope=content:read`;
  let called = 0;
  let returned = "";
  const options = { changed() {}, navigate: (url: string) => { returned = url; },
    api: async <T>(path: string, init?: RequestInit) => {
      called++;
      assert.equal(path, "/api/portal/sync-pairing-code?inventory=3");
      assert.deepEqual(JSON.parse(init!.body as string).scopes, ["sync:write", "self:revoke", "content:read"]);
      return { callbackUrl: `omgskills://pair?state=${state}&code=pair_${"c".repeat(43)}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString() } as T;
    } };
  await createPairingConsent(hash, productionInventoryConsent(false), options).approve();
  assert.equal(called, 0);
  await createPairingConsent(hash, productionInventoryConsent(true), options).approve();
  assert.equal(called, 1);
  assert.match(returned, /^omgskills:\/\/pair\?/);
});

test("production install handoff preserves both agents and cannot offer the test download", async () => {
  const skill = { key: "catalog:owner/repo", catalogId: "owner/repo", name: "Skill" } as SkillDisplay;
  for (const agent of ["claude", "codex"] as const) {
    const url = new URL(catalogInstallAction(skill, agent, "production").href!);
    assert.equal(url.protocol, "omgskills:");
    assert.equal(url.host, "catalog-install");
    assert.equal(url.searchParams.get("agent"), agent);
  }
  const storage = new Map<string, string>();
  const getStorage = () => ({ getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } });
  const store = new CatalogInstallIntentStore(getStorage, "production");
  store.save({ version: 1, catalogId: "owner/repo", agent: "claude", createdAt: Date.now(),
    returnRoute: "/app/?view=discover&skill=catalog%3Aowner%2Frepo" });
  assert.equal(new CatalogInstallIntentStore(getStorage, "candidate").read().intent, null);
  const output = await build({ entryPoints: [fileURLToPath(new URL("../src/app/unified/CatalogInstallSetup.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const module = { exports: {} as { CatalogInstallSetup: typeof CatalogInstallSetup } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const before = [...storage.entries()];
  const markup = renderToStaticMarkup(createElement(module.exports.CatalogInstallSetup, { skill, detailReady: true,
    returnRoute: "/app/?view=discover&skill=catalog%3Aowner%2Frepo", store }));
  assert.ok(markup.includes(productionDistribution.url));
  assert.ok(markup.includes(productionDistribution.checksumURL));
  assert.match(markup, /Download OMGSkills 0\.0\.27/);
  assert.match(markup, /Apple silicon Mac, macOS 14\.0 or later/);
  assert.match(markup, /replaces your existing OMGSkills app/);
  assert.match(markup, /installed skills stay in their current folders/);
  assert.match(markup, /Quit OMGSkills[^]*Move <strong>omgskills\.app<\/strong> into <strong>Applications/);
  assert.match(markup, /Try opening again/);
  assert.doesNotMatch(markup, /not been published|Disposable VM|F1 Test|Download test candidate|netlify\.app|omgskills-mac\.dmg/);
  const withCandidate = renderToStaticMarkup(createElement(module.exports.CatalogInstallSetup, { skill, detailReady: true,
    returnRoute: "/app/?view=discover&skill=catalog%3Aowner%2Frepo", store, distribution: candidateDistribution }));
  assert.ok(withCandidate.includes(productionDistribution.url));
  assert.ok(!withCandidate.includes(candidateDistribution.url));
  for (const client of ["f1", "candidate"] as const) {
    const other = new CatalogInstallIntentStore(getStorage, client);
    other.save(store.read().intent!);
    const html = renderToStaticMarkup(createElement(module.exports.CatalogInstallSetup, { skill, detailReady: true,
      returnRoute: "/app/?view=discover&skill=catalog%3Aowner%2Frepo", store: other }));
    assert.ok(!html.includes(productionDistribution.url), client);
  }
  for (const [key, value] of before) assert.equal(storage.get(key), value);
});

test("production setup references only the exact separately published Mac release", () => {
  assert.equal(productionDistribution.url,
    "https://github.com/jonslimak/omgskills/releases/download/connected-v0.0.27/OMGSkills-Connected-0.0.27-27-arm64.zip");
  assert.equal(productionDistribution.checksumURL, productionDistribution.url + ".sha256");
  assert.equal(productionDistribution.filename, "OMGSkills-Connected-0.0.27-27-arm64.zip");
  assert.equal(productionDistribution.version, "0.0.27");
  assert.equal(productionDistribution.build, "27");
  assert.equal(productionDistribution.sha256, "ebcbbdb821f81e2c941d451d9955712c3e44b35d0b4382e94282879378c2ae85");
  assert.equal(productionFeatures.connectedInventoryReadEnabled, true);
  assert.equal(productionFeatures.connectedInventorySyncEnabled, true);
});

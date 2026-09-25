import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadProductionFeatures,
  portalBuildEnvironment,
  publicReleaseConfig,
} from "./production-features.mjs";

async function configUrl(value) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omgskills-features-"));
  const filePath = path.join(directory, "production-features.json");
  await writeFile(filePath, value);
  return new URL(`file://${filePath}`);
}

test("loads the tracked production feature state", async () => {
  const features = await loadProductionFeatures();
  assert.equal(typeof features.skillGroupsWebEnabled, "boolean");
  assert.equal(typeof features.skillGroupsAuthEnabled, "boolean");
  assert.equal(typeof features.portalRedesignEnabled, "boolean");
  assert.deepEqual(publicReleaseConfig(features), {
    version: 1,
    skillGroupsAuthEnabled: features.skillGroupsAuthEnabled,
  });
});

test("loads disabled, web-only, and full production feature states", async () => {
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":true,"skillGroupsAuthEnabled":true}')),
    { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: true, portalRedesignEnabled: false },
  );
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":true,"skillGroupsAuthEnabled":false}')),
    { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false, portalRedesignEnabled: false },
  );
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":false,"skillGroupsAuthEnabled":false}')),
    { skillGroupsWebEnabled: false, skillGroupsAuthEnabled: false, portalRedesignEnabled: false },
  );
});

test("maps the production state to the portal build environment", () => {
  assert.deepEqual(
    portalBuildEnvironment({ skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false }, { KEEP: "yes" }),
    { KEEP: "yes", VITE_SKILLGROUPS_WEB_ENABLED: "1", VITE_SKILLGROUPS_MAC_ENABLED: "0", VITE_PORTAL_REDESIGN_ENABLED: "0" },
  );
  assert.deepEqual(
    portalBuildEnvironment({ skillGroupsWebEnabled: false, skillGroupsAuthEnabled: false }, {}),
    { VITE_SKILLGROUPS_WEB_ENABLED: "0", VITE_SKILLGROUPS_MAC_ENABLED: "0", VITE_PORTAL_REDESIGN_ENABLED: "0" },
  );
});

test("tracked redesign state overrides ambient flags without changing Mac release metadata", async () => {
  for (const enabled of [true, false]) {
    const features = await loadProductionFeatures(await configUrl(JSON.stringify({
      skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false, portalRedesignEnabled: enabled,
    })));
    assert.equal(features.portalRedesignEnabled, enabled);
    const env = portalBuildEnvironment(features, {
      VITE_PORTAL_REDESIGN_ENABLED: enabled ? "0" : "1", VITE_SKILLGROUPS_MAC_ENABLED: "1",
    });
    assert.equal(env.VITE_PORTAL_REDESIGN_ENABLED, enabled ? "1" : "0");
    assert.equal(env.VITE_SKILLGROUPS_MAC_ENABLED, "0");
    assert.deepEqual(publicReleaseConfig(features), { version: 1, skillGroupsAuthEnabled: false });
  }
  assert.equal(portalBuildEnvironment({}, { VITE_PORTAL_REDESIGN_ENABLED: "1" }).VITE_PORTAL_REDESIGN_ENABLED, "0");
});

test("rejects non-boolean redesign configuration", async () => {
  for (const value of [null, "1", 1, {}, []]) {
    await assert.rejects(loadProductionFeatures(await configUrl(JSON.stringify({
      skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false, portalRedesignEnabled: value,
    }))), /portalRedesignEnabled must be a boolean/);
  }
});

test("web-only activation keeps the public Mac release gate disabled", () => {
  assert.deepEqual(
    publicReleaseConfig({ skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false }),
    { version: 1, skillGroupsAuthEnabled: false },
  );
});

test("rejects malformed or ambiguous production feature state", async () => {
  await assert.rejects(
    loadProductionFeatures(await configUrl("{}")),
    /skillGroupsWebEnabled and skillGroupsAuthEnabled as booleans/,
  );
  await assert.rejects(
    loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":false,"skillGroupsAuthEnabled":false,"extra":true}')),
    /unknown keys: extra/,
  );
  await assert.rejects(
    loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":false,"skillGroupsAuthEnabled":true}')),
    /skillGroupsAuthEnabled requires skillGroupsWebEnabled/,
  );
});

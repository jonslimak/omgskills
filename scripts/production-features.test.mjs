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
  assert.deepEqual(publicReleaseConfig(features), {
    version: 1,
    skillGroupsAuthEnabled: features.skillGroupsAuthEnabled,
  });
});

test("loads disabled, web-only, and full production feature states", async () => {
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":true,"skillGroupsAuthEnabled":true}')),
    { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: true },
  );
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":true,"skillGroupsAuthEnabled":false}')),
    { skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false },
  );
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsWebEnabled":false,"skillGroupsAuthEnabled":false}')),
    { skillGroupsWebEnabled: false, skillGroupsAuthEnabled: false },
  );
});

test("maps the production state to the portal build environment", () => {
  assert.deepEqual(
    portalBuildEnvironment({ skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false }, { KEEP: "yes" }),
    { KEEP: "yes", VITE_SKILLGROUPS_WEB_ENABLED: "1", VITE_SKILLGROUPS_MAC_ENABLED: "0" },
  );
  assert.deepEqual(
    portalBuildEnvironment({ skillGroupsWebEnabled: false, skillGroupsAuthEnabled: false }, {}),
    { VITE_SKILLGROUPS_WEB_ENABLED: "0", VITE_SKILLGROUPS_MAC_ENABLED: "0" },
  );
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

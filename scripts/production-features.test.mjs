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
  assert.equal(typeof features.skillGroupsAuthEnabled, "boolean");
  assert.deepEqual(publicReleaseConfig(features), {
    version: 1,
    skillGroupsAuthEnabled: features.skillGroupsAuthEnabled,
  });
});

test("loads both supported production feature states", async () => {
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsAuthEnabled":true}')),
    { skillGroupsAuthEnabled: true },
  );
  assert.deepEqual(
    await loadProductionFeatures(await configUrl('{"skillGroupsAuthEnabled":false}')),
    { skillGroupsAuthEnabled: false },
  );
});

test("maps the production state to the portal build environment", () => {
  assert.deepEqual(
    portalBuildEnvironment({ skillGroupsAuthEnabled: true }, { KEEP: "yes" }),
    { KEEP: "yes", VITE_SKILLGROUPS_AUTH_ENABLED: "1" },
  );
  assert.deepEqual(
    portalBuildEnvironment({ skillGroupsAuthEnabled: false }, {}),
    { VITE_SKILLGROUPS_AUTH_ENABLED: "0" },
  );
});

test("rejects malformed or ambiguous production feature state", async () => {
  await assert.rejects(
    loadProductionFeatures(await configUrl("{}")),
    /skillGroupsAuthEnabled as a boolean/,
  );
  await assert.rejects(
    loadProductionFeatures(await configUrl('{"skillGroupsAuthEnabled":false,"extra":true}')),
    /unknown keys: extra/,
  );
});

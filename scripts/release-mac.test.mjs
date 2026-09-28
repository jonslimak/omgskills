import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = await readFile(new URL("./release-mac.sh", import.meta.url), "utf8");
const infoPlist = await readFile(new URL("../menubar/Info.plist", import.meta.url), "utf8");

test("Mac releases require explicit approval when Skill Groups auth is enabled", () => {
  assert.match(script, /Print :OMGSkillsSkillGroupsAuthEnabled/);
  assert.match(script, /OMGSKILLS_ALLOW_SKILLGROUPS_AUTH_RELEASE:-0/);
  assert.match(script, /verify_skillgroups_auth_release_gate/);

  const gateCall = script.lastIndexOf("verify_skillgroups_auth_release_gate");
  const buildCall = script.indexOf("./build.sh");
  assert.ok(gateCall >= 0 && gateCall < buildCall, "auth release gate must run before the app build");
});

test("the checked-in Mac release keeps Skill Groups auth disabled", () => {
  assert.match(
    infoPlist,
    /<key>OMGSkillsSkillGroupsAuthEnabled<\/key>\s*<false\/>/
  );
});

test("public releases finalize appcast assets after Sparkle generation", () => {
  const appcastCall = script.lastIndexOf('"$SPARKLE_TOOLS/generate_appcast"');
  const finalizeCall = script.indexOf("finalize-release-assets.mjs");
  assert.ok(appcastCall >= 0 && finalizeCall > appcastCall);
});

test("existing candidate staging fails closed without approved checksums", () => {
  const env = { ...process.env, OMGSKILLS_RELEASE_RC: "0" };
  delete env.OMGSKILLS_EXPECTED_ZIP_SHA256;
  delete env.OMGSKILLS_EXPECTED_DMG_SHA256;
  const result = spawnSync("bash", [fileURLToPath(new URL("./release-mac.sh", import.meta.url)), "0.0.20", "--stage-existing"], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required environment variable 'OMGSKILLS_EXPECTED_ZIP_SHA256'/);
});

test("existing candidate staging cannot be combined with RC build mode", () => {
  const result = spawnSync("bash", [fileURLToPath(new URL("./release-mac.sh", import.meta.url)), "0.0.20", "--stage-existing"], {
    env: { ...process.env, OMGSKILLS_RELEASE_RC: "1" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot combine RC build mode/);
});

test("candidate staging checks package hashes, metadata and signing before site writes", () => {
  for (const guard of ["OMGSKILLS_EXPECTED_ZIP_SHA256", "OMGSKILLS_EXPECTED_DMG_SHA256", "Candidate version differs", "Candidate ZIP metadata differs", "spctl --assess --type execute", "xcrun stapler validate"]) {
    assert.ok(script.includes(guard), `Missing guard: ${guard}`);
  }
  assert.ok(script.indexOf("verify_existing_candidate\n") < script.indexOf('cp "$DMG" "$SITE_DOWNLOADS/omgskills-mac.dmg"'));
  assert.match(script, /if \[ "\$STAGE_EXISTING" != "--stage-existing" \]; then[\s\S]*\.\/build\.sh[\s\S]*fi\n\nRELEASE_HASH/);
});

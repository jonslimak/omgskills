import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = await readFile(new URL("./release-mac.sh", import.meta.url), "utf8");
const infoPlist = await readFile(new URL("../menubar/Info.plist", import.meta.url), "utf8");
const buildScript = await readFile(new URL("../menubar/build.sh", import.meta.url), "utf8");
const resourcePermissionsCommand = 'find "$APP_BUNDLE/Contents/Resources" -type f -exec chmod u+w {} +';

test("copied app resources become owner-writable before signing", () => {
  const copy = buildScript.indexOf('# Copy any SPM-generated resource bundles');
  const permissions = buildScript.indexOf(resourcePermissionsCommand);
  const signing = buildScript.indexOf('codesign --force --deep --sign');
  assert.ok(copy >= 0 && permissions > copy && signing > permissions);
});

test("resource permissions preserve contents, executable bits and external symlink targets", async (t) => {
  assert.ok(buildScript.includes(resourcePermissionsCommand));
  const root = await mkdtemp(join(tmpdir(), "omgskills-resource-permissions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "omgskills.app");
  const resources = join(app, "Contents", "Resources");
  const bundle = join(resources, "Example.bundle", "en.lproj");
  await mkdir(bundle, { recursive: true });
  const translation = join(bundle, "Localizable.strings");
  const privacy = join(resources, "PrivacyInfo.xcprivacy");
  const executable = join(resources, "helper");
  const external = join(root, "dependency-source");
  const externalDirectory = join(root, "dependency-directory");
  await mkdir(externalDirectory);
  const externalChild = join(externalDirectory, "source.strings");
  for (const file of [translation, privacy, external, externalChild]) {
    await writeFile(file, "unchanged resource");
    await chmod(file, 0o444);
  }
  await writeFile(executable, "unchanged executable");
  await chmod(executable, 0o555);
  await symlink(external, join(resources, "linked-file"));
  await symlink(externalDirectory, join(resources, "linked-directory"));
  const result = spawnSync("bash", ["-eu", "-c", resourcePermissionsCommand], {
    env: { ...process.env, APP_BUNDLE: app }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  for (const file of [translation, privacy]) {
    assert.equal((await stat(file)).mode & 0o777, 0o644);
    assert.equal(await readFile(file, "utf8"), "unchanged resource");
  }
  assert.equal((await stat(executable)).mode & 0o777, 0o755);
  assert.equal(await readFile(executable, "utf8"), "unchanged executable");
  for (const file of [external, externalChild]) {
    assert.equal((await stat(file)).mode & 0o777, 0o444);
  }
});

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

test("release staging archives target-build patches before Sparkle can reuse them", () => {
  const archiveCall = script.indexOf('archive_target_deltas "$(/usr/libexec/PlistBuddy');
  const appcastCall = script.lastIndexOf('"$SPARKLE_TOOLS/generate_appcast"');
  assert.ok(archiveCall >= 0 && archiveCall < appcastCall);
});

test("target patch archival preserves older releases and handles repeated staging", async (t) => {
  const helper = script.match(/^archive_target_deltas\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(helper, "missing target patch archival helper");
  const root = await mkdtemp(join(tmpdir(), "omgskills-delta-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const updates = join(root, "updates");
  const menubar = join(root, "menubar");
  const dist = join(menubar, "dist");
  await mkdir(updates);
  await mkdir(dist, { recursive: true });
  const stale = ["omgskills20-19.delta", "omgskills20-18.delta"];
  const preserved = ["omgskills19-18.delta", "omgskills200-19.delta", "omgskills-0.0.20.zip"];
  for (const name of [...stale, ...preserved]) await writeFile(join(updates, name), name);
  const run = () => spawnSync("bash", ["-eu", "-c", `${helper}\narchive_target_deltas 20`], {
    env: { ...process.env, SITE_UPDATES: updates, MENUBAR_DIR: menubar, APP_NAME: "omgskills" },
    encoding: "utf8",
  });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(updates)).sort(), preserved.sort());
  const archives = await readdir(dist);
  assert.equal(archives.length, 1);
  for (const name of stale) assert.equal(await readFile(join(dist, archives[0], name), "utf8"), name);
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(dist), archives, "no patches means no new archive");
  await writeFile(join(updates, stale[0]), "regenerated patch");
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await readdir(dist)).length, 2);
  assert.equal(await readFile(join(dist, archives[0], stale[0]), "utf8"), stale[0]);
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

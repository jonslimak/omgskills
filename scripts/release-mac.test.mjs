import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  isEnabledConnectRoute,
  isSkillGroupsAuthEnabled
} from "../src/feature-flags.js";

test("Skill Groups auth defaults off and requires the explicit enable value", () => {
  assert.equal(isSkillGroupsAuthEnabled(undefined), false);
  assert.equal(isSkillGroupsAuthEnabled("0"), false);
  assert.equal(isSkillGroupsAuthEnabled("true"), false);
  assert.equal(isSkillGroupsAuthEnabled("1"), true);
});

test("connect routes are unavailable while Skill Groups auth is disabled", () => {
  assert.equal(isEnabledConnectRoute("/app/connect", false), false);
  assert.equal(isEnabledConnectRoute("/connect/", false), false);
  assert.equal(isEnabledConnectRoute("/app/connect", true), true);
  assert.equal(isEnabledConnectRoute("/app/", true), false);
});

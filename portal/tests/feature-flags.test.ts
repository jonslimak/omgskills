import assert from "node:assert/strict";
import test from "node:test";
import {
  isEnabledConnectRoute,
  isFeatureEnabled,
  portalSurface
} from "../src/feature-flags.js";

test("feature flags default off and require the explicit enable value", () => {
  assert.equal(isFeatureEnabled(undefined), false);
  assert.equal(isFeatureEnabled("0"), false);
  assert.equal(isFeatureEnabled("true"), false);
  assert.equal(isFeatureEnabled("1"), true);
});

test("connect routes are unavailable while Skill Groups auth is disabled", () => {
  assert.equal(isEnabledConnectRoute("/app/connect", false), false);
  assert.equal(isEnabledConnectRoute("/connect/", false), false);
  assert.equal(isEnabledConnectRoute("/app/connect", true), true);
  assert.equal(isEnabledConnectRoute("/app/", true), false);
});

test("disabled Skill Groups hide every private portal route", () => {
  assert.equal(portalSurface("/app/", false), "disabled");
  assert.equal(portalSurface("/app/groups/example", false), "disabled");
  assert.equal(portalSurface("/app/connect", false), "disabled");
  assert.equal(portalSurface("/app/connect", true), "connect");
  assert.equal(portalSurface("/app/", true), "dashboard");
});

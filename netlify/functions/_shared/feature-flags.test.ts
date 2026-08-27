import assert from "node:assert/strict";
import test from "node:test";
import {
  isSkillGroupsFeatureEnabled,
  requireSkillGroupsFeature
} from "./feature-flags.js";

test("Skill Groups server access requires an explicit boolean enable", () => {
  assert.equal(isSkillGroupsFeatureEnabled({ skillGroupsAuthEnabled: true }), true);
  assert.equal(isSkillGroupsFeatureEnabled({ skillGroupsAuthEnabled: false }), false);
  assert.equal(isSkillGroupsFeatureEnabled({ skillGroupsAuthEnabled: "true" }), false);
  assert.equal(isSkillGroupsFeatureEnabled({}), false);
});

test("disabled server access fails closed with a retryable response", async () => {
  assert.throws(
    () => requireSkillGroupsFeature({ skillGroupsAuthEnabled: false }),
    (error: unknown) => {
      assert.ok(error instanceof Response);
      assert.equal(error.status, 503);
      assert.equal(error.headers.get("Retry-After"), "300");
      return true;
    }
  );
  assert.doesNotThrow(() => requireSkillGroupsFeature({ skillGroupsAuthEnabled: true }));
});

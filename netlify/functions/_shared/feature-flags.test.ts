import assert from "node:assert/strict";
import test from "node:test";
import {
  isSkillGroupsFeatureEnabled,
  isSkillGroupsWebEnabled,
  requireSkillGroupsWebFeature,
  requireSkillGroupsFeature
} from "./feature-flags.js";

test("web and Mac access are independently gated", () => {
  assert.equal(isSkillGroupsWebEnabled({ skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false }), true);
  assert.equal(isSkillGroupsWebEnabled({ skillGroupsWebEnabled: "true" }), false);
  assert.equal(isSkillGroupsWebEnabled({}), false);
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
  assert.throws(
    () => requireSkillGroupsWebFeature({ skillGroupsWebEnabled: false, skillGroupsAuthEnabled: true }),
    (error: unknown) => error instanceof Response && error.status === 503
  );
  assert.doesNotThrow(() => requireSkillGroupsWebFeature({ skillGroupsWebEnabled: true, skillGroupsAuthEnabled: false }));
});

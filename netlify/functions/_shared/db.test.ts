import assert from "node:assert/strict";
import test from "node:test";
import { selectSkillGroupsConnectionString } from "./db.js";

test("production always uses the managed database", () => {
  assert.equal(
    selectSkillGroupsConnectionString("production", "postgres://override", () => "postgres://managed"),
    "postgres://managed"
  );
});

test("non-production contexts may use an explicit override", () => {
  assert.equal(
    selectSkillGroupsConnectionString("deploy-preview", "postgres://override", () => {
      throw new Error("managed database should not be read");
    }),
    "postgres://override"
  );
  assert.equal(
    selectSkillGroupsConnectionString("branch-deploy", undefined, () => "postgres://managed"),
    "postgres://managed"
  );
});

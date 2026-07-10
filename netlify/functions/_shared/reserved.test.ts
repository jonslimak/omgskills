import assert from "node:assert/strict";
import test from "node:test";
import { isReservedHandleOrSlug, isReservedProfileHandle } from "./reserved.js";

test("creator handles are reserved for profiles case-insensitively", () => {
  assert.equal(isReservedProfileHandle("Anthropics"), true);
  assert.equal(isReservedProfileHandle("jonslimak"), false);
});

test("creator handles do not become reserved group slugs", () => {
  assert.equal(isReservedHandleOrSlug("anthropics"), false);
  assert.equal(isReservedHandleOrSlug("groups"), true);
  assert.equal(isReservedProfileHandle("groups"), true);
});

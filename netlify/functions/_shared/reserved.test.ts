import assert from "node:assert/strict";
import test from "node:test";
import { isReservedGroupSlug, isReservedProfileHandle } from "./reserved.js";

test("creator handles are reserved for profiles case-insensitively", () => {
  assert.equal(isReservedProfileHandle("  Anthropics  "), true);
  assert.equal(isReservedProfileHandle("jonslimak"), false);
});

test("creator handles do not become reserved group slugs", () => {
  assert.equal(isReservedGroupSlug("anthropics"), false);
  assert.equal(isReservedGroupSlug(" groups "), true);
  assert.equal(isReservedProfileHandle("groups"), true);
});

test("structural and app-owned group slugs are reserved independently", () => {
  assert.equal(isReservedGroupSlug("SETS"), true);
  assert.equal(isReservedGroupSlug("favorites"), true);
  assert.equal(isReservedProfileHandle("sets"), false);
  assert.equal(isReservedProfileHandle("favorites"), false);
});

test("top-level routes are not automatically reserved as profile handles", () => {
  assert.equal(isReservedProfileHandle("library"), false);
  assert.equal(isReservedProfileHandle("collections"), false);
  assert.equal(isReservedGroupSlug("library"), false);
  assert.equal(isReservedGroupSlug("collections"), false);
});

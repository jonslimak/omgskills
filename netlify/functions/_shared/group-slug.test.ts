import assert from "node:assert/strict";
import test from "node:test";
import { resolveCreateGroupSlug } from "./group-slug.js";

test("normal groups reject structural and app-owned slugs", () => {
  assert.throws(
    () => resolveCreateGroupSlug("Sets", undefined, false),
    (error) => error instanceof Response && error.status === 400
  );
  assert.throws(
    () => resolveCreateGroupSlug("My group", " Favorites ", false),
    (error) => error instanceof Response && error.status === 400
  );
});

test("the app-owned Favorites group keeps its fixed slug", () => {
  assert.equal(resolveCreateGroupSlug("Anything", "sets", true), "favorites");
});

test("creator handles remain available as group slugs", () => {
  assert.equal(resolveCreateGroupSlug("Anthropics", undefined, false), "anthropics");
});

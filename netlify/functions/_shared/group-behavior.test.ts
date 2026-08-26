import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGroupCanBeDeleted,
  parseGroupPatch,
  parseGroupVisibility,
  requireGroupItemId,
  validateCompleteItemOrder,
} from "./group-behavior.js";

const normalGroup = { isFavorites: false, visibility: "private" as const };
const favorites = { isFavorites: true, visibility: "public" as const };

async function responseFrom(run: () => unknown) {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Response
      ? { status: error.status, message: await error.text() }
      : null;
  }
}

test("accepts every stable group visibility and rejects unknown values", async () => {
  assert.equal(parseGroupVisibility("public"), "public");
  assert.equal(parseGroupVisibility("restricted"), "restricted");
  assert.equal(parseGroupVisibility("private"), "private");
  assert.deepEqual(await responseFrom(() => parseGroupVisibility("hidden")), {
    status: 400,
    message: "visibility is invalid",
  });
});

test("parses partial group updates without changing omitted fields", () => {
  assert.deepEqual(
    parseGroupPatch({ name: "  Review team  ", description: "  Useful skills  " }, normalGroup),
    {
      hasName: true,
      name: "Review team",
      hasDescription: true,
      description: "Useful skills",
      hasVisibility: false,
      visibility: null,
    }
  );
  assert.deepEqual(parseGroupPatch({ visibility: "restricted" }, normalGroup), {
    hasName: false,
    name: null,
    hasDescription: false,
    description: null,
    hasVisibility: true,
    visibility: "restricted",
  });
});

test("protects Favorites identity, visibility, and group record", async () => {
  assert.deepEqual(await responseFrom(() => parseGroupPatch({ name: "Pinned" }, favorites)), {
    status: 409,
    message: "Favorites name and visibility are protected",
  });
  assert.deepEqual(await responseFrom(() => parseGroupPatch({ visibility: "private" }, favorites)), {
    status: 409,
    message: "Favorites name and visibility are protected",
  });
  assert.deepEqual(await responseFrom(() => assertGroupCanBeDeleted(favorites)), {
    status: 409,
    message: "Favorites cannot be deleted",
  });
  assert.equal(assertGroupCanBeDeleted(normalGroup), undefined);
});

test("accepts only a complete, unique item order", async () => {
  assert.deepEqual(validateCompleteItemOrder(["a", "b", "c"], ["c", "a", "b"]), ["c", "a", "b"]);
  assert.equal((await responseFrom(() => validateCompleteItemOrder(["a", "b"], ["a", "a"])))?.status, 400);
  assert.equal((await responseFrom(() => validateCompleteItemOrder(["a", "b"], ["a"])))?.status, 400);
  assert.equal((await responseFrom(() => validateCompleteItemOrder(["a", "b"], ["a", "c"])))?.status, 400);
});

test("rejects malformed group item ids before querying PostgreSQL", async () => {
  assert.equal(
    requireGroupItemId("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000"
  );
  assert.deepEqual(await responseFrom(() => requireGroupItemId("not-a-uuid")), {
    status: 400,
    message: "itemId is invalid",
  });
});

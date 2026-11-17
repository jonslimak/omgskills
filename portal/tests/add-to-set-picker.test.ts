import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/integration/unified/useManagement.tsx", import.meta.url), "utf8");

test("Add to set lists the sets right away instead of a dropdown", () => {
  assert.doesNotMatch(source, /<option value="">Choose a set<\/option>/);
  assert.match(source, /className="ua-set-picker" role="radiogroup"/);
  assert.match(source, /type="radio" name="add-to-set" value=\{set\.id\} checked=\{setId === set\.id\}/);
  // A set that already has the skill can't be picked; Add stays off until a set is picked.
  assert.match(source, /disabled=\{disabled \|\| has\}/);
  assert.match(source, /request\.kind === "add" && \(!targetSet \|\| !targetSkills\.length \|\| \(!request\.set && hasAll\(targetSet\)\)\)/);
  // Only sets the person owns, not Favorites or hidden ones.
  assert.match(source, /const owned = data\.sets\.filter\(set => set\.role === "owner" && !set\.isFavorites && !set\.hidden\)/);
  assert.match(source, /show\(\{ kind: "create", skills: request\.skills \}\)/);
});

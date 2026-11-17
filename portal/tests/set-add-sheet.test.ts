import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchesSearch } from "../src/integration/unified/SetAddSheet";
import type { SkillDisplay } from "../src/app/unified/model";

const skill = { key: "a", name: "app-store-review", description: "Checks iOS code against review guidelines" } as SkillDisplay;

test("the search looks in each skill's name and description", () => {
  assert.equal(matchesSearch(skill, ""), true);
  assert.equal(matchesSearch(skill, "STORE"), true);
  assert.equal(matchesSearch(skill, "ios guidelines"), true);
  assert.equal(matchesSearch(skill, "android"), false);
});

test("Add skill on a Set opens the drawer of My skills; several can be picked", () => {
  const management = readFileSync(new URL("../src/integration/unified/useManagement.tsx", import.meta.url), "utf8");
  assert.match(management, /request\?\.kind === "add" && request\.set && !request\.skills\.length \? <SetAddSheet/);
  assert.match(management, /choices\.filter\(skill => skillKeys\.includes\(skill\.key\)\)/);
  assert.doesNotMatch(management, /<option value="">Choose a skill<\/option>/);
  const sheet = readFileSync(new URL("../src/integration/unified/SetAddSheet.tsx", import.meta.url), "utf8");
  // Skills already in the Set show checked and can't be picked again.
  assert.match(sheet, /checked=\{has \|\| picked\.includes\(skill\.key\)\} disabled=\{disabled \|\| has\}/);
  assert.match(sheet, /placeholder="Search My skills"/);
});

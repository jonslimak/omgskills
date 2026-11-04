import assert from "node:assert/strict";
import test from "node:test";
import { onAMac, type SkillDisplay } from "../src/app/unified/model";

const copy = (isCurrent?: boolean) => ({ id: "x", name: "bflow", description: null, githubUrl: null,
  isLocalOnly: true, source: "Claude", lastSeenAt: "2026-07-16T00:00:00Z", isCurrent });
const display = (...copies: ReturnType<typeof copy>[]) => ({ key: "synced:x", name: "bflow", description: "",
  author: "", githubUrl: null, tags: [],
  installed: { ...copies[0], allSkillIds: ["x"], sourceSkills: copies, sources: ["Claude"] } }) as SkillDisplay;

test("a skill every Mac stopped reporting is left out of the lists; one copy on a Mac keeps it", () => {
  assert.equal(onAMac(display(copy(false), copy(false))), false);
  assert.equal(onAMac(display(copy(false), copy(true))), true);
  // Older inventories don't say; those stay listed.
  assert.equal(onAMac(display(copy(undefined))), true);
  assert.equal(onAMac({ ...display(copy(true)), installed: undefined }), false);
});

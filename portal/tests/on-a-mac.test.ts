import assert from "node:assert/strict";
import test from "node:test";
import { liveSkill, macsReport, onAMac, type SkillDisplay } from "../src/app/unified/model";

const copy = (isCurrent?: boolean, deviceId: string | null = null) => ({ id: "x", deviceId, name: "bflow", description: null, githubUrl: null,
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

test("once a Mac reports per device, copies from the older account-wide sync stop counting", () => {
  const legacy = copy(true), mac = copy(true, "mac-a");
  assert.equal(macsReport([legacy]), false);
  assert.equal(macsReport([legacy, mac]), true);
  assert.equal(macsReport([legacy, copy(false, "mac-a")]), false);
  assert.equal(onAMac(display(legacy), false), true);
  assert.equal(onAMac(display(legacy), true), false);
  assert.equal(onAMac(display(legacy, mac), true), true);
});

test("a skill with live and old copies shows and acts on only the live ones", () => {
  const old = { ...copy(true), id: "old", source: "Codex" }, live = { ...copy(true, "mac-a"), id: "live", source: "Claude" };
  const skill = { ...display(old, live), installed: { ...display(old, live).installed!, id: "old", allSkillIds: ["old", "live"], sources: ["Claude", "Codex"] } };
  const shown = liveSkill(skill, true);
  assert.equal(shown.installed?.id, "live");
  assert.deepEqual(shown.installed?.sources, ["Claude"]);
  assert.deepEqual(shown.installed?.sourceSkills.map((c) => c.id), ["live"]);
  assert.deepEqual(shown.installed?.allSkillIds, ["old", "live"]);
  assert.equal(liveSkill(display({ ...copy(false), id: "gone" }), true).installed, undefined);
  assert.equal(liveSkill(skill, false), skill);
});

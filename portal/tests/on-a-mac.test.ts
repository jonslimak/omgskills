import assert from "node:assert/strict";
import test from "node:test";
import { liveMine, liveSkill, onAMac, type SkillDisplay } from "../src/app/unified/model";

const now = Date.parse("2026-11-04T12:00:00Z");
const recent = "2026-11-01T00:00:00Z", old = "2026-09-28T00:00:00Z";
const copy = (isCurrent: boolean | undefined, deviceId: string | null = null, lastSeenAt = recent, id = "x", source = "Claude") =>
  ({ id, deviceId, name: "bflow", description: null, githubUrl: null, isLocalOnly: true, source, lastSeenAt, isCurrent });
const display = (...copies: ReturnType<typeof copy>[]) => ({ key: "synced:x", name: "bflow", description: "",
  author: "", githubUrl: null, tags: [],
  installed: { ...copies[0], allSkillIds: copies.map((c) => c.id), sourceSkills: copies,
    sources: [...new Set(copies.map((c) => c.source))] } }) as SkillDisplay;

test("a skill no Mac has any more is left out; one live copy keeps it", () => {
  assert.equal(onAMac(display(copy(false, "mac"), copy(false)), now), false);
  assert.equal(onAMac(display(copy(false, "mac"), copy(true, "mac")), now), true);
  assert.equal(onAMac({ ...display(copy(true, "mac")), installed: undefined }, now), false);
});

test("old account-wide copies count only while a Mac still refreshes them", () => {
  // A Mac still on the old sync keeps its skills listed.
  assert.equal(onAMac(display(copy(true, null, recent)), now), true);
  // Copies no Mac refreshed for over 30 days are history, even when still marked current.
  assert.equal(onAMac(display(copy(true, null, old)), now), false);
  assert.deepEqual(liveMine([display(copy(true, null, old)), display(copy(true, "mac"))], now).length, 1);
});

test("a skill with live and old copies shows and acts on only the live ones", () => {
  const stale = copy(true, null, old, "old", "Codex"), live = copy(true, "mac-a", recent, "live", "Claude");
  const skill = display(stale, live);
  skill.installed = { ...skill.installed!, catalogSkillId: "owner/repo:bflow", githubUrl: "https://github.com/owner/repo" };
  const shown = liveSkill(skill, now);
  assert.equal(shown.installed?.id, "live");
  assert.deepEqual(shown.installed?.sources, ["Claude"]);
  assert.deepEqual(shown.installed?.sourceSkills.map((c) => c.id), ["live"]);
  // Set membership still matches the old copy; the catalog identity stays the group's.
  assert.deepEqual(shown.installed?.allSkillIds, ["old", "live"]);
  assert.equal(shown.installed?.catalogSkillId, "owner/repo:bflow");
  assert.equal(shown.installed?.githubUrl, "https://github.com/owner/repo");
  assert.equal(liveSkill(display(copy(false, "mac")), now).installed, undefined);
  const allLive = display(copy(true, "mac"));
  assert.equal(liveSkill(allLive, now), allLive);
});

import test from "node:test";
import assert from "node:assert/strict";
import { shouldRunWeeklyHighStarSkillMdDiscovery } from "./high-star-schedule.js";

test("high-star SKILL.md discovery runs on Sunday UTC by default", () => {
  assert.equal(shouldRunWeeklyHighStarSkillMdDiscovery("2026-06-21T12:00:00.000Z"), true);
});

test("high-star SKILL.md discovery skips on non-Sunday UTC days", () => {
  assert.equal(shouldRunWeeklyHighStarSkillMdDiscovery("2026-06-22T12:00:00.000Z"), false);
});

test("high-star SKILL.md discovery supports configured weekly UTC day", () => {
  assert.equal(shouldRunWeeklyHighStarSkillMdDiscovery("2026-06-22T12:00:00.000Z", 1), true);
});

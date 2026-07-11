import assert from "node:assert/strict";
import test from "node:test";
import { groupSyncedSkills, type SyncedSkill } from "../src/synced-skill-grouping.js";

test("groups Claude and Codex rows without discarding either installation", () => {
  const base = {
    name: "review",
    description: "Review a pull request before it is merged.",
    githubUrl: "https://github.com/owner/repo",
    isLocalOnly: false,
    lastSeenAt: "2026-07-11T00:00:00Z"
  };
  const skills: SyncedSkill[] = [
    { ...base, id: "claude-row", source: "Claude" },
    { ...base, id: "codex-row", source: "Codex" }
  ];

  const groups = groupSyncedSkills(skills);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sources, ["Claude", "Codex"]);
  assert.deepEqual(groups[0].allSkillIds, ["claude-row", "codex-row"]);
  assert.equal(groups[0].sourceSkills.length, 2);
});

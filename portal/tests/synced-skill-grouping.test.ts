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

test("groups installations with the same catalog ID without fuzzy matching", () => {
  const skills: SyncedSkill[] = [
    {
      id: "claude-row",
      name: "review",
      description: "Claude-specific description.",
      catalogSkillId: "owner/repo:review",
      githubUrl: null,
      isLocalOnly: false,
      source: "Claude",
      lastSeenAt: "2026-07-11T00:00:00Z"
    },
    {
      id: "codex-row",
      name: "renamed-review",
      description: "Codex-specific description.",
      catalogSkillId: "owner/repo:review",
      githubUrl: "https://github.com/owner/repo",
      isLocalOnly: false,
      source: "Codex",
      lastSeenAt: "2026-07-11T00:00:00Z"
    }
  ];

  const groups = groupSyncedSkills(skills);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].allSkillIds, ["claude-row", "codex-row"]);
});

test("keeps matching descriptions separate when catalog IDs differ", () => {
  const base = {
    name: "health",
    description: "Inspect project health and report actionable problems.",
    githubUrl: null,
    isLocalOnly: false,
    lastSeenAt: "2026-07-11T00:00:00Z"
  };
  const skills: SyncedSkill[] = [
    {
      ...base,
      id: "claude-row",
      catalogSkillId: "owner/first:health",
      source: "Claude"
    },
    {
      ...base,
      id: "codex-row",
      catalogSkillId: "owner/second:health",
      source: "Codex"
    }
  ];

  const groups = groupSyncedSkills(skills);

  assert.equal(groups.length, 2);
});

test("does not fuzzy-merge a catalog skill with an unresolved skill", () => {
  const base = {
    name: "qa",
    description: "Run focused quality assurance checks for this project.",
    githubUrl: null,
    lastSeenAt: "2026-07-11T00:00:00Z"
  };
  const skills: SyncedSkill[] = [
    {
      ...base,
      id: "catalog-row",
      catalogSkillId: "owner/repo:qa",
      isLocalOnly: false,
      source: "Claude"
    },
    {
      ...base,
      id: "local-row",
      catalogSkillId: null,
      identityStatus: "localOnly",
      isLocalOnly: true,
      source: "Codex"
    }
  ];

  const groups = groupSyncedSkills(skills);

  assert.equal(groups.length, 2);
});

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

test("v3 retains same-name/catalog missing, current, other-agent and unknown-Mac physical rows", () => {
  const base: SyncedSkill = { inventoryVersion: 3, id: "missing", deviceId: "mac-a", name: "Same skill",
    description: "Same description", catalogSkillId: "owner/repo:same", githubUrl: null,
    isLocalOnly: true, source: "codex", lastSeenAt: "2026-10-16T12:00:00Z", isCurrent: false };
  const skills = [base, { ...base, id: "other-mac", deviceId: "mac-b", isCurrent: true },
    { ...base, id: "other-agent", source: "claude" }, { ...base, id: "unknown-a", deviceId: null },
    { ...base, id: "unknown-b", deviceId: null }];
  const grouped = groupSyncedSkills(skills);
  assert.equal(grouped.length, 5);
  assert.deepEqual(grouped.map(skill => skill.allSkillIds), skills.map(skill => [skill.id]));
  assert.equal(grouped.find(skill => skill.id === "missing")?.isCurrent, false);
});

test("display-only grouping combines exact catalog matches and preserves every installation unchanged", () => {
  const base: SyncedSkill = { inventoryVersion: 3, id: "claude", deviceId: "mac-a", deviceName: "Work Mac",
    name: "review", description: "Review changes", catalogSkillId: "owner/repo:review", githubUrl: null,
    isLocalOnly: false, source: "claude", lastSeenAt: "2026-10-23T12:00:00Z", isCurrent: false };
  const skills = [base, { ...base, id: "codex", source: "codex", isCurrent: true },
    { ...base, id: "other-mac", deviceId: "mac-b", deviceName: "Home Mac", source: "codex" }];
  const before = structuredClone(skills);
  const [group] = groupSyncedSkills(skills, { groupInstallations: true });
  assert.deepEqual(group.sources, ["claude", "codex"]);
  assert.deepEqual(group.allSkillIds, skills.map(skill => skill.id));
  assert.deepEqual(group.sourceSkills, before);
  assert.ok(group.sourceSkills.every((skill, i) => skill === skills[i]));
  assert.deepEqual(skills, before);
  assert.equal(groupSyncedSkills(skills).length, 3, "Mutation callers still see separate records");
  assert.equal(groupSyncedSkills([...skills, { ...base, id: "different", catalogSkillId: "other/repo:review" }],
    { groupInstallations: true }).length, 2);
});

test("unresolved display groups require identical fingerprints and names, not descriptions or catalog hints", () => {
  const base: SyncedSkill = { inventoryVersion: 3, id: "claude", deviceId: "mac-a", name: "Review",
    description: "Review changes", skillMdSha: "a".repeat(64), catalogSkillId: null, identityStatus: "localOnly",
    catalogSkillIdHint: "owner/repo:review", githubUrl: null, isLocalOnly: true, source: "claude",
    lastSeenAt: "2026-10-23T12:00:00Z", isCurrent: true };
  const skills = [base, { ...base, id: "codex", name: " review ", source: "codex" }];
  assert.equal(groupSyncedSkills(skills, { groupInstallations: true }).length, 1);
  for (const change of [{ skillMdSha: "b".repeat(64) }, { skillMdSha: null }, { skillMdSha: "invalid" },
    { name: "other" }, { catalogSkillId: "owner/repo:review" }]) {
    assert.equal(groupSyncedSkills([base, { ...skills[1], ...change }], { groupInstallations: true }).length, 2);
  }
  assert.equal(groupSyncedSkills(skills.map(skill => ({ ...skill, skillMdSha: null })),
    { groupInstallations: true }).length, 2, "Names and hints alone cannot merge installations");
});

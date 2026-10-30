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
  assert.deepEqual(group.sources, ["Claude", "Codex"]);
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
  for (const length of [40, 64]) {
    assert.equal(groupSyncedSkills(skills.map(skill => ({ ...skill, skillMdSha: "a".repeat(length) })),
      { groupInstallations: true }).length, 1, `Group the ${length}-character fingerprint accepted by inventory uploads`);
  }
  for (const change of [{ skillMdSha: "b".repeat(64) }, { skillMdSha: null }, { skillMdSha: "invalid" },
    { name: "other" }]) {
    assert.equal(groupSyncedSkills([base, { ...skills[1], ...change }], { groupInstallations: true }).length, 2);
  }
  assert.equal(groupSyncedSkills(skills.map(skill => ({ ...skill, skillMdSha: null })),
    { groupInstallations: true }).length, 2, "Names and hints alone cannot merge installations");
});

test("display joins catalog and unresolved copies only with an exact fingerprint and name", () => {
  const current: SyncedSkill = { inventoryVersion: 3, id: "current", deviceId: "mac-a", name: "Review",
    description: "Review changes", skillMdSha: "a".repeat(64), catalogSkillId: null, identityStatus: "localOnly",
    githubUrl: null, isLocalOnly: true, source: "codex", lastSeenAt: "2026-10-30T12:00:00Z", isCurrent: true };
  const historical: SyncedSkill = { ...current, id: "old", inventoryVersion: 2, deviceId: null,
    name: " review ", catalogSkillId: "owner/repo:review", identityStatus: "resolved", isLocalOnly: false,
    source: "Codex", lastSeenAt: "2026-09-01T00:00:00Z", isCurrent: false };
  for (const rows of [[current, historical], [historical, current]]) {
    const before = structuredClone(rows);
    const groups = groupSyncedSkills(rows, { groupInstallations: true });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].catalogSkillId, historical.catalogSkillId);
    assert.equal(groups[0].isLocalOnly, false);
    assert.deepEqual(groups[0].sources, ["Codex"]);
    assert.deepEqual(new Set(groups[0].allSkillIds), new Set(["current", "old"]));
    assert.ok(rows.every(row => groups[0].sourceSkills.includes(row)));
    assert.deepEqual(rows, before);
    assert.equal(groupSyncedSkills(rows).length, 2, "physical grouping remains unchanged");
  }
  for (const change of [{ skillMdSha: "b".repeat(64) }, { skillMdSha: "a".repeat(40) },
    { skillMdSha: null }, { name: "other" }]) {
    assert.equal(groupSyncedSkills([current, { ...historical, ...change }], { groupInstallations: true }).length, 2);
  }
});

test("display groups exact copies across legacy and device-aware upload formats", () => {
  const legacy: SyncedSkill = { id: "legacy", name: "Review", description: "Review changes",
    skillMdSha: "a".repeat(40), catalogSkillId: "owner/repo:review", githubUrl: null,
    isLocalOnly: false, source: "Codex", lastSeenAt: "2026-09-01T00:00:00Z" };
  const current = { ...legacy, id: "device", inventoryVersion: 3 as const, deviceId: "mac-a", source: "codex" };
  assert.equal(groupSyncedSkills([legacy, current], { groupInstallations: true }).length, 1);
  const unresolved = { ...legacy, catalogSkillId: null, isLocalOnly: true };
  assert.equal(groupSyncedSkills([unresolved, { ...current, catalogSkillId: null }], { groupInstallations: true }).length, 1);
  assert.equal(groupSyncedSkills([legacy, current]).length, 2);
});

test("a shared fingerprint cannot bridge conflicting catalog identities", () => {
  const base: SyncedSkill = { inventoryVersion: 3, id: "unresolved", name: "Review", description: "Review",
    skillMdSha: "a".repeat(64), catalogSkillId: null, githubUrl: null, isLocalOnly: true,
    source: "codex", lastSeenAt: "2026-10-30T12:00:00Z" };
  const rows = [base, { ...base, id: "a", catalogSkillId: "a/repo:review" },
    { ...base, id: "b", catalogSkillId: "b/repo:review" }];
  for (const input of [rows, [...rows].reverse()]) {
    assert.equal(groupSyncedSkills(input, { groupInstallations: true }).length, 3);
  }
});

test("display deduplicates known agent labels without changing physical sources", () => {
  const base: SyncedSkill = { inventoryVersion: 3, id: "0", name: "Review", description: "Review",
    catalogSkillId: "owner/repo:review", githubUrl: null, isLocalOnly: false, source: "Codex",
    lastSeenAt: "2026-10-30T12:00:00Z" };
  const rows = ["Codex", " codex ", "Claude", "claude", "Claude Code", "agents", "Agents"].map((source, i) => ({ ...base, id: String(i), source }));
  const before = structuredClone(rows);
  const [group] = groupSyncedSkills(rows, { groupInstallations: true });
  assert.deepEqual(group.sources, ["Agents", "Claude", "Codex"]);
  assert.deepEqual(group.sourceSkills, before);
  assert.deepEqual(rows, before);
});

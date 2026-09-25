import assert from "node:assert/strict";
import test from "node:test";
import { planSyncedReferenceRepairs, type ReconciliationSkill } from "./sync-group-reconciliation.js";

const old: ReconciliationSkill = {
  id: "old", stableKey: "Codex:/Users/test/.codex/skills/example", source: "Codex",
  sha: "a".repeat(40), current: false,
};
const current: ReconciliationSkill = { ...old, id: "new", stableKey: "location:v1:codex:example", current: true };
const item = { id: "item", groupId: "group", syncedSkillId: old.id };
const plan = (skills: ReconciliationSkill[]) => planSyncedReferenceRepairs(skills, [item]);

test("repairs exact legacy agent/folder/content, never the matching Claude copy", () => {
  const claude = { ...current, id: "claude", source: "Claude", stableKey: "location:v1:claude:example" };
  assert.deepEqual(plan([old, claude, current]), [{ ...item, replacementId: "new" }]);
  assert.deepEqual(plan([old, claude]), []);
});

test("does not guess for absent, changed, malformed, or ambiguous content", () => {
  for (const skills of [
    [old], [old, { ...current, sha: "b".repeat(40) }],
    [{ ...old, sha: null }, current], [{ ...old, sha: "unknown" }, current],
    [old, current, { ...current, id: "second" }],
    [old, { ...current, source: "Claude" }],
    [{ ...old, current: true }, current],
  ]) assert.deepEqual(plan(skills), []);
});

test("only known legacy roots migrate, preserving folder case and punctuation", () => {
  for (const stableKey of [
    "Codex:/project/skills/example", "Codex:/Users/test/.claude/skills/example",
    "https://github.com/owner/repo#example", "location:v1:codex:example",
    "Codex:/Users/test/.codex/skills/../example", "Codex:/Users/test/.codex/skills/..",
  ]) assert.deepEqual(plan([{ ...old, stableKey }, current]), []);
  assert.equal(plan([
    { ...old, stableKey: "Codex:/Users/test/.codex/skills/.Example" },
    { ...current, stableKey: "location:v1:codex:.Example" },
  ]).length, 1);
});

test("skips duplicate target membership and many-to-one conflicts per group", () => {
  assert.deepEqual(planSyncedReferenceRepairs([old, current], [item, { ...item, id: "duplicate", syncedSkillId: "new" }]), []);
  const second = { ...old, id: "old2", stableKey: "Codex:/Users/other/.codex/skills/example" };
  assert.deepEqual(planSyncedReferenceRepairs([old, second, current], [item, { ...item, id: "other", syncedSkillId: "old2" }]), []);
  assert.equal(planSyncedReferenceRepairs([old, current], [item, { ...item, id: "other", groupId: "another" }]).length, 2);
});

test("Agents legacy migration uses the installation folder, not display name or catalog identity", () => {
  assert.equal(plan([
    { ...old, source: "Agents", stableKey: "Agents:/Users/test/.agents/skills/example" },
    { ...current, source: "Agents", stableKey: "location:v1:agents:example" },
  ]).length, 1);
});

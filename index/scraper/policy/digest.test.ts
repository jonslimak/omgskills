import assert from "node:assert/strict";
import test from "node:test";
import type { PolicySources } from "./types.js";
import { effectivePolicyDigest } from "./digest.js";

test("effective policy digest is stable across object key order and changes with policy", () => {
  const first = {
    creators: { creators: [] },
    rootSkillInvalid: { repos: [{ repo: "owner/repo", reason: "root-skill-invalid" }] },
  } as unknown as PolicySources;
  const reordered = {
    rootSkillInvalid: { repos: [{ reason: "root-skill-invalid", repo: "owner/repo" }] },
    creators: { creators: [] },
  } as unknown as PolicySources;
  const changed = {
    creators: { creators: [] },
    rootSkillInvalid: { repos: [] },
  } as unknown as PolicySources;

  assert.equal(effectivePolicyDigest(first), effectivePolicyDigest(reordered));
  assert.notEqual(effectivePolicyDigest(first), effectivePolicyDigest(changed));
  assert.match(effectivePolicyDigest(first), /^sha256:[a-f0-9]{64}$/);
});

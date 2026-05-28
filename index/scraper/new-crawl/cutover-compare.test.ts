import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import { buildCutoverCompare } from "./cutover-compare.js";
import type { ShadowCutoverSkillSignal } from "./types.js";

function skill(id: string, author = "owner"): Skill {
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url: `https://github.com/${id.split(":")[0]}`,
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: author,
    tags: [],
    stars: 123,
    last_updated: "2026-05-22T00:00:00Z",
    first_seen: "2026-05-22",
    skill_md_sha: "sha",
  };
}

function cutoverSkill(id: string, author = "owner", provenanceType: "original" | "catalog" | "repackaged" | "mirrored" | "unknown" = "original"): Skill & {
  publisher_handle: string;
  publisher_repo: string;
  upstream_repo: string | null;
  provenance_type: "original" | "catalog" | "repackaged" | "mirrored" | "unknown";
  author_confidence: "high" | "low";
} {
  return {
    ...skill(id, author),
    publisher_handle: "publisher",
    publisher_repo: "publisher/repo",
    upstream_repo: null,
    provenance_type: provenanceType,
    author_confidence: "high",
  };
}

test("compare reports equal counts when baseline and cutover sets match", () => {
  const compare = buildCutoverCompare(
    "2026-05-26T00:00:00Z",
    [skill("owner/repo:one")],
    [cutoverSkill("owner/repo:one")],
    [{ id: "owner/repo:one" }],
    { cutoverValidationPassed: true, cutoverValidationFailureCount: 0 },
  );

  assert.equal(compare.counts.baselineSkillCount, 1);
  assert.equal(compare.counts.cutoverSkillCount, 1);
  assert.equal(compare.counts.countDelta, 0);
  assert.equal(compare.counts.addedSkillCount, 0);
  assert.equal(compare.counts.missingSkillCount, 0);
});

test("added cutover-only ids are counted and sampled correctly", () => {
  const compare = buildCutoverCompare(
    "2026-05-26T00:00:00Z",
    [skill("owner/repo:one")],
    [cutoverSkill("owner/repo:one"), cutoverSkill("owner/repo:two")],
    [{ id: "owner/repo:one" }, { id: "owner/repo:two" }],
    { cutoverValidationPassed: true, cutoverValidationFailureCount: 0 },
  );

  assert.equal(compare.counts.addedSkillCount, 1);
  assert.deepEqual(compare.addedSkillIdsSample, ["owner/repo:two"]);
});

test("missing baseline-only ids are counted and sampled correctly", () => {
  const compare = buildCutoverCompare(
    "2026-05-26T00:00:00Z",
    [skill("owner/repo:one"), skill("owner/repo:two")],
    [cutoverSkill("owner/repo:one")],
    [{ id: "owner/repo:one" }],
    { cutoverValidationPassed: true, cutoverValidationFailureCount: 0 },
  );

  assert.equal(compare.counts.missingSkillCount, 1);
  assert.deepEqual(compare.missingSkillIdsSample, ["owner/repo:two"]);
});

test("changed author_handle is captured in author diff sample", () => {
  const compare = buildCutoverCompare(
    "2026-05-26T00:00:00Z",
    [skill("owner/repo:one", "old-author")],
    [cutoverSkill("owner/repo:one", "new-author")],
    [{ id: "owner/repo:one" }],
    { cutoverValidationPassed: true, cutoverValidationFailureCount: 0 },
  );

  assert.deepEqual(compare.authorDiffSample, [
    {
      id: "owner/repo:one",
      baselineAuthorHandle: "old-author",
      cutoverAuthorHandle: "new-author",
    },
  ]);
});

test("cutover signal summary counts reflect generated cutover signal file", () => {
  const signals: ShadowCutoverSkillSignal[] = [
    { id: "owner/repo:one", isRising: true },
    { id: "owner/repo:two", isCore: true },
    { id: "owner/repo:three" },
  ];
  const compare = buildCutoverCompare(
    "2026-05-26T00:00:00Z",
    [skill("owner/repo:one"), skill("owner/repo:two"), skill("owner/repo:three")],
    [cutoverSkill("owner/repo:one"), cutoverSkill("owner/repo:two"), cutoverSkill("owner/repo:three")],
    signals,
    { cutoverValidationPassed: true, cutoverValidationFailureCount: 0 },
  );

  assert.equal(compare.signalSummary.cutoverSignalCount, 3);
  assert.equal(compare.signalSummary.cutoverRisingSignalCount, 1);
  assert.equal(compare.signalSummary.cutoverCoreSignalCount, 1);
});

test("compare output carries through cutoverValidationPassed state", () => {
  const compare = buildCutoverCompare(
    "2026-05-26T00:00:00Z",
    [skill("owner/repo:one")],
    [cutoverSkill("owner/repo:one")],
    [{ id: "owner/repo:one" }],
    { cutoverValidationPassed: false, cutoverValidationFailureCount: 2 },
  );

  assert.equal(compare.validationSummary.cutoverValidationPassed, false);
  assert.equal(compare.validationSummary.cutoverValidationFailureCount, 2);
});

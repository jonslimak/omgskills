import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkillEquivalenceShadow,
  classifySkillEquivalenceAgent,
  parseSkillEquivalenceOverrides,
  skillEquivalenceGroupId,
  type SkillEquivalenceSkill,
  validateSkillEquivalenceArtifact,
} from "./skill-equivalence.js";

function skill(
  id: string,
  path: string,
  overrides: Partial<SkillEquivalenceSkill> = {},
): SkillEquivalenceSkill {
  const repo = id.split(":")[0]!;
  const name = path.split("/").at(-2) ?? "skill";
  return {
    id,
    name,
    description: "Build and test the same project workflow with reliable local validation.",
    github_url: `https://github.com/${repo}`,
    skill_md_path: path,
    skill_md_sha: id,
    ...overrides,
  };
}

test("classifies explicit and neutral agent paths conservatively", () => {
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", ".claude/skills/a/SKILL.md")), "claude");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", ".codex/skills/a/SKILL.md")), "codex");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", "skills-codex/a/SKILL.md")), "codex");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", "skills-codex-overrides/a/SKILL.md")), "codex");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", "skills/a/SKILL.md")), "neutral");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", ".agent/skills/a/SKILL.md")), "other");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", ".agents/skills/a/SKILL.md")), "other");
  assert.equal(classifySkillEquivalenceAgent(skill("owner/repo:a", ".cursor/skills/a/SKILL.md")), "other");
  assert.equal(
    classifySkillEquivalenceAgent(skill("owner/repo:a", ".opencode/skills-codex/a/SKILL.md")),
    "other",
  );
});

test("publishes an explicit Claude and Codex pair automatically", () => {
  const rows = [
    skill("owner/repo:.claude/skills/build", ".claude/skills/build/SKILL.md", { name: "Build" }),
    skill("owner/repo:.codex/skills/build", ".codex/skills/build/SKILL.md", { name: "build" }),
  ];
  const result = buildSkillEquivalenceShadow(rows, "fixed");

  assert.equal(result.artifact.groups.length, 1);
  assert.equal(result.review.summary.automaticCount, 1);
  assert.equal(result.review.summary.pendingReviewCount, 0);
  assert.deepEqual(result.artifact.groups[0]?.preferredSkillIds, {
    claude: rows[0]!.id,
    codex: rows[1]!.id,
  });
  assert.equal(result.artifact.groups[0]?.representativeSkillId, rows[1]!.id);
});

test("neutral-path pairs stay pending until a committed decision approves or rejects them", () => {
  const rows = [
    skill("owner/repo:skills/build", "skills/build/SKILL.md", { name: "build" }),
    skill("owner/repo:skills-codex/build", "skills-codex/build/SKILL.md", { name: "build" }),
  ];
  const pending = buildSkillEquivalenceShadow(rows, "fixed");
  assert.equal(pending.artifact.groups.length, 0);
  assert.equal(pending.review.pendingReview.length, 1);

  const approved = buildSkillEquivalenceShadow(rows, "fixed", {
    version: 1,
    decisions: [{ memberSkillIds: rows.map((row) => row.id), decision: "approve" }],
  });
  assert.equal(approved.artifact.groups.length, 1);
  assert.equal(approved.review.summary.manuallyApprovedCount, 1);
  assert.ok(approved.artifact.groups[0]?.evidence.includes("manual-approval"));

  const rejected = buildSkillEquivalenceShadow(rows, "fixed", {
    version: 1,
    decisions: [{ memberSkillIds: rows.map((row) => row.id), decision: "reject" }],
  });
  assert.equal(rejected.artifact.groups.length, 0);
  assert.equal(rejected.review.pendingReview.length, 0);
  assert.equal(rejected.review.summary.rejectedCount, 1);
});

test("manual approval cannot bypass core policy checks", () => {
  const rows = [
    skill("owner/repo:skills/build", "skills/build/SKILL.md", {
      name: "build",
      description: "Build the project.",
    }),
    skill("owner/repo:skills-codex/build", "skills-codex/build/SKILL.md", {
      name: "build",
      description: "Manage production database migrations.",
    }),
  ];
  const result = buildSkillEquivalenceShadow(rows, "fixed", {
    version: 1,
    decisions: [{ memberSkillIds: rows.map((row) => row.id), decision: "approve" }],
  });

  assert.equal(result.artifact.groups.length, 0);
  assert.equal(result.review.excluded[0]?.reason, "description-mismatch");
  assert.equal(result.review.summary.staleOverrideCount, 0);
});

test("empty descriptions never establish equivalence", () => {
  const rows = [
    skill("owner/repo:claude", ".claude/skills/build/SKILL.md", {
      name: "build",
      description: "",
    }),
    skill("owner/repo:codex", ".codex/skills/build/SKILL.md", {
      name: "build",
      description: "",
    }),
  ];
  const result = buildSkillEquivalenceShadow(rows, "fixed");
  assert.equal(result.artifact.groups.length, 0);
  assert.equal(result.review.excluded[0]?.reason, "description-mismatch");
});

test("multi-candidate and cross-repo matches stay ungrouped", () => {
  const multi = buildSkillEquivalenceShadow([
    skill("owner/repo:claude", ".claude/skills/build/SKILL.md", { name: "build" }),
    skill("owner/repo:codex", ".codex/skills/build/SKILL.md", { name: "build" }),
    skill("owner/repo:neutral", "skills/build/SKILL.md", { name: "build" }),
  ], "fixed");
  assert.equal(multi.artifact.groups.length, 0);
  assert.equal(multi.review.excluded[0]?.reason, "multiple-candidates");

  const crossRepo = buildSkillEquivalenceShadow([
    skill("one/repo:claude", ".claude/skills/build/SKILL.md", { name: "build" }),
    skill("two/repo:codex", ".codex/skills/build/SKILL.md", { name: "build" }),
  ], "fixed");
  assert.equal(crossRepo.artifact.groups.length, 0);
  assert.equal(crossRepo.review.pendingReview.length, 0);
});

test("exact SHA duplicates stay in shaHistory rather than equivalence", () => {
  const rows = [
    skill("owner/repo:claude", ".claude/skills/build/SKILL.md", {
      name: "build",
      skill_md_sha: "same",
    }),
    skill("owner/repo:codex", ".codex/skills/build/SKILL.md", {
      name: "build",
      skill_md_sha: "same",
    }),
  ];
  const result = buildSkillEquivalenceShadow(rows, "fixed");
  assert.equal(result.artifact.groups.length, 0);
  assert.equal(result.review.excluded[0]?.reason, "same-sha");
});

test("group IDs are deterministic and change with membership", () => {
  const first = skillEquivalenceGroupId(["b", "a"]);
  assert.equal(first, skillEquivalenceGroupId(["a", "b"]));
  assert.notEqual(first, skillEquivalenceGroupId(["a", "c"]));
});

test("override parsing normalizes order and rejects duplicate decisions", () => {
  const parsed = parseSkillEquivalenceOverrides({
    version: 1,
    decisions: [{ memberSkillIds: ["b", "a"], decision: "approve" }],
  });
  assert.deepEqual(parsed.decisions[0]?.memberSkillIds, ["a", "b"]);

  assert.throws(
    () =>
      parseSkillEquivalenceOverrides({
        version: 1,
        decisions: [
          { memberSkillIds: ["a", "b"], decision: "approve" },
          { memberSkillIds: ["b", "a"], decision: "reject" },
        ],
      }),
    /Duplicate skill equivalence override/,
  );
});

test("stale overrides are reported without creating groups", () => {
  const result = buildSkillEquivalenceShadow([], "fixed", {
    version: 1,
    decisions: [{ memberSkillIds: ["old/repo:a", "old/repo:b"], decision: "approve" }],
  });
  assert.equal(result.review.summary.staleOverrideCount, 1);
  assert.equal(result.artifact.groups.length, 0);
});

test("validator catches stale members and invalid preferred variants", () => {
  const rows = [
    skill("owner/repo:claude", ".claude/skills/build/SKILL.md", { name: "build" }),
    skill("owner/repo:codex", ".codex/skills/build/SKILL.md", { name: "build" }),
  ];
  const result = buildSkillEquivalenceShadow(rows, "fixed");
  const group = result.artifact.groups[0]!;
  const failures = validateSkillEquivalenceArtifact(
    {
      ...result.artifact,
      groups: [{
        ...group,
        preferredSkillIds: { claude: "missing", codex: group.preferredSkillIds.codex },
      }],
    },
    rows.slice(1),
  );
  assert.ok(failures.some((failure) => failure.includes("preferred claude skill is not a member")));
  assert.ok(failures.some((failure) => failure.includes("missing from the live catalog")));
});

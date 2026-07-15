import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalPolicyReport,
  validateShaCanonicalArtifact,
} from "./validate-canonical-policy.js";
import {
  buildShaCanonicalArtifact,
  type ShaCanonicalSkill,
} from "./sha-canonical.js";

function skill(id: string, sha: string, stars = 0): ShaCanonicalSkill {
  const [repo, suffix = "skill"] = id.split(":");
  return {
    id,
    name: suffix,
    github_url: `https://github.com/${repo}`,
    skill_md_path: `skills/${suffix}/SKILL.md`,
    stars,
    first_seen: "2026-07-01",
    skill_md_sha: sha,
  };
}

test("policy report promotes only strict high-confidence mappings", () => {
  const skills = [
    skill("same/repo:skill", "same"),
    skill("same/repo:copy", "same"),
    skill("trusted/source:skill", "trusted"),
    skill("copy/repo:skill", "trusted", 5_000),
    skill("leader/repo:skill", "medium", 100),
    skill("small/repo:skill", "medium", 1),
  ];
  const report = buildCanonicalPolicyReport(skills, "fixed", {
    trustedCanonicalHandles: new Set(["trusted"]),
  });
  assert.equal(report.valid, true);
  assert.deepEqual(report.summary, {
    clusterCount: 3,
    promotableHighCount: 1,
    promotableSameRepoCount: 1,
    advisoryTrustedCreatorCount: 1,
    advisoryStarLeaderCount: 1,
    advisoryMediumCount: 2,
    ambiguousCount: 0,
    failureCount: 0,
  });
  assert.deepEqual(report.excludedCandidates, [
    {
      skillMdSha: "medium",
      proposedSkillId: "leader/repo:skill",
      confidence: "medium",
      reason: "clear-star-leader",
    },
    {
      skillMdSha: "trusted",
      proposedSkillId: "trusted/source:skill",
      confidence: "medium",
      reason: "trusted-creator",
    },
  ]);
});

test("validator lists missing members, SHA mismatches, and invalid canonical IDs", () => {
  const skills = [skill("same/repo:skill", "same"), skill("same/repo:copy", "same")];
  const artifact = buildShaCanonicalArtifact(skills, "fixed");
  artifact.clusters[0]!.memberSkillIds.push("missing/repo:skill");
  artifact.clusters[0]!.canonicalSkillId = "outside/repo:skill";
  skills[0]!.skill_md_sha = "changed";
  const failures = validateShaCanonicalArtifact(artifact, skills);
  assert.ok(failures.some((failure) => failure.code === "missing-member-id"));
  assert.ok(failures.some((failure) => failure.code === "member-sha-mismatch"));
  assert.ok(failures.some((failure) => failure.code === "invalid-canonical-id"));
});

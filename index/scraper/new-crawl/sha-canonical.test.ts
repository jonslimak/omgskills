import test from "node:test";
import assert from "node:assert/strict";
import { buildShaCanonicalArtifact, type ShaCanonicalSkill } from "./sha-canonical.js";

function skill(id: string, overrides: Partial<ShaCanonicalSkill> = {}): ShaCanonicalSkill {
  const [repo, suffix = "skill"] = id.split(":");
  return {
    id,
    name: suffix,
    github_url: `https://github.com/${repo}`,
    skill_md_path: `skills/${suffix}/SKILL.md`,
    stars: 0,
    first_seen: "2026-07-01",
    skill_md_sha: "same",
    ...overrides,
  };
}

test("ignores missing SHA and singleton groups", () => {
  const result = buildShaCanonicalArtifact([
    skill("one/repo:one", { skill_md_sha: "" }),
    skill("two/repo:two", { skill_md_sha: "single" }),
  ], "2026-07-09T00:00:00Z");
  assert.equal(result.clusterCount, 0);
});

test("same repo keeps the base id deterministically", () => {
  const result = buildShaCanonicalArtifact([
    skill("owner/repo:deploy-copy", { name: "deploy", stars: 100 }),
    skill("owner/repo:deploy", { name: "deploy", stars: 1 }),
  ], "2026-07-09T00:00:00Z");
  assert.equal(result.clusters[0]?.canonicalSkillId, "owner/repo:deploy");
  assert.equal(result.clusters[0]?.reason, "same-repo");
  assert.equal(result.clusters[0]?.confidence, "high");
});

test("watched creator and aliases beat a higher-star copy", () => {
  const result = buildShaCanonicalArtifact([
    skill("old-handle/source:skill", { stars: 1 }),
    skill("copy/repo:skill", { stars: 500 }),
  ], "2026-07-09T00:00:00Z", {
    trustedCanonicalHandles: new Set(["new-handle"]),
    aliasToCanonicalHandle: new Map([["old-handle", "new-handle"]]),
  });
  assert.equal(result.clusters[0]?.canonicalSkillId, "old-handle/source:skill");
  assert.equal(result.clusters[0]?.reason, "trusted-creator");
  assert.equal(result.clusters[0]?.confidence, "medium");
});

test("trusted creator requires one concrete trusted repository", () => {
  const result = buildShaCanonicalArtifact([
    skill("trusted/older:skill", { stars: 1 }),
    skill("trusted/newer:skill", { stars: 500 }),
    skill("copy/repo:skill", { stars: 5_000 }),
  ], "2026-07-09T00:00:00Z", {
    trustedCanonicalHandles: new Set(["trusted"]),
  });
  assert.equal(result.clusters[0]?.canonicalSkillId, null);
  assert.equal(result.clusters[0]?.confidence, "unresolved");
  assert.equal(result.clusters[0]?.reason, "ambiguous");
});

test("trusted aliases in one concrete repository remain advisory", () => {
  const result = buildShaCanonicalArtifact([
    skill("trusted/old-id:skill", { github_url: "https://github.com/trusted/current" }),
    skill("trusted/current:skill", { github_url: "https://github.com/trusted/current" }),
    skill("copy/repo:skill", { stars: 5_000 }),
  ], "2026-07-09T00:00:00Z", {
    trustedCanonicalHandles: new Set(["trusted"]),
  });
  assert.equal(result.clusters[0]?.canonicalSkillId, "trusted/current:skill");
  assert.equal(result.clusters[0]?.confidence, "medium");
  assert.equal(result.clusters[0]?.reason, "trusted-creator");
});

test("multiple trusted creators remain unresolved", () => {
  const result = buildShaCanonicalArtifact([
    skill("one/source:skill", { stars: 500 }),
    skill("two/source:skill", { stars: 1 }),
  ], "2026-07-09T00:00:00Z", {
    trustedCanonicalHandles: new Set(["one", "two"]),
  });
  assert.equal(result.clusters[0]?.canonicalSkillId, null);
  assert.equal(result.clusters[0]?.reason, "ambiguous");
});

test("catalog repo cannot win clear-star selection", () => {
  const result = buildShaCanonicalArtifact([
    skill("catalog/repo:skill", { stars: 5_000 }),
    skill("direct/repo:skill", { stars: 50 }),
  ], "2026-07-09T00:00:00Z", {
    catalogRepos: new Set(["catalog/repo"]),
  });
  assert.equal(result.clusters[0]?.canonicalSkillId, "direct/repo:skill");
  assert.equal(result.clusters[0]?.reason, "clear-star-leader");
});

test("star leader must have 50 stars and a 10x lead", () => {
  const belowFloor = buildShaCanonicalArtifact([
    skill("one/repo:skill", { stars: 49, first_seen: "2026-07-01" }),
    skill("two/repo:skill", { stars: 1, first_seen: "2026-07-01" }),
  ], "2026-07-09T00:00:00Z");
  const belowRatio = buildShaCanonicalArtifact([
    skill("one/repo:skill", { stars: 100, first_seen: "2026-07-01" }),
    skill("two/repo:skill", { stars: 11, first_seen: "2026-07-01" }),
  ], "2026-07-09T00:00:00Z");
  assert.equal(belowFloor.clusters[0]?.canonicalSkillId, null);
  assert.equal(belowRatio.clusters[0]?.canonicalSkillId, null);
});

test("first_seen differences do not resolve a cluster", () => {
  const result = buildShaCanonicalArtifact([
    skill("one/repo:skill", { first_seen: "2026-06-01" }),
    skill("two/repo:skill", { first_seen: "2026-07-01" }),
  ], "2026-07-09T00:00:00Z");
  assert.equal(result.clusters[0]?.canonicalSkillId, null);
  assert.equal(result.clusters[0]?.reason, "ambiguous");
});

test("output is deterministic regardless of input order", () => {
  const rows = [
    skill("b/repo:skill", { skill_md_sha: "bbb", stars: 1 }),
    skill("a/repo:skill", { skill_md_sha: "bbb", stars: 100 }),
    skill("same/repo:copy", { skill_md_sha: "aaa" }),
    skill("same/repo:skill", { skill_md_sha: "aaa" }),
  ];
  const forward = buildShaCanonicalArtifact(rows, "fixed");
  const reverse = buildShaCanonicalArtifact([...rows].reverse(), "fixed");
  assert.deepEqual(forward, reverse);
  for (const cluster of forward.clusters) {
    assert.deepEqual(cluster.memberSkillIds, [...cluster.memberSkillIds].sort());
    if (cluster.canonicalSkillId) assert.ok(cluster.memberSkillIds.includes(cluster.canonicalSkillId));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import type { ShaCanonicalArtifact, ShaCanonicalCluster } from "./sha-canonical.js";
import {
  evaluateCommitEvidence,
  fetchEarliestCommitEvidence,
  lastPageFromLink,
  selectCommitPilotClusters,
  MINIMUM_CANONICAL_LEAD_SECONDS,
  type CommitEvidence,
  type CommitHistoryRequest,
} from "./audit-canonical-commits.js";

function skill(id: string, path = "skills/test/SKILL.md"): Skill {
  const repo = id.split(":")[0]!;
  return {
    id,
    name: "test",
    description: "test",
    github_url: `https://github.com/${repo}`,
    skill_md_path: path,
    install_cmd: "install",
    author_handle: repo.split("/")[0]!,
    tags: [],
    stars: 0,
    last_updated: "2026-07-01T00:00:00Z",
    first_seen: "2026-07-01",
    skill_md_sha: "sha",
  };
}

function cluster(
  skillMdSha: string,
  memberSkillIds: string[],
  confidence: "medium" | "unresolved" = "unresolved",
  canonicalSkillId: string | null = null,
): ShaCanonicalCluster {
  return {
    skillMdSha,
    memberSkillIds,
    canonicalSkillId,
    confidence,
    reason: confidence === "medium" ? "clear-star-leader" : "ambiguous",
  };
}

function artifact(clusters: ShaCanonicalCluster[]): ShaCanonicalArtifact {
  const high = clusters.filter((row) => row.confidence === "high").length;
  const medium = clusters.filter((row) => row.confidence === "medium").length;
  return {
    version: 1,
    generatedAt: "fixed",
    clusterCount: clusters.length,
    canonicalCandidateCount: high + medium,
    highConfidenceCount: high,
    mediumCandidateCount: medium,
    unresolvedClusterCount: clusters.length - high - medium,
    candidateCountByReason: {
      "same-repo": clusters.filter((row) => row.reason === "same-repo").length,
      "trusted-creator": clusters.filter((row) => row.reason === "trusted-creator").length,
      "clear-star-leader": clusters.filter((row) => row.reason === "clear-star-leader").length,
    },
    clusters,
  };
}

function evidence(skillId: string, earliestCommitAt: string | null, status: CommitEvidence["status"] = "ok"): CommitEvidence {
  return { skillId, repo: skillId.split(":")[0]!, path: "SKILL.md", status, earliestCommitAt };
}

test("parses last page from GitHub link header", () => {
  assert.equal(lastPageFromLink(undefined), 1);
  assert.equal(
    lastPageFromLink('<https://api.github.com/repos/a/b/commits?page=2>; rel="next", <https://api.github.com/repos/a/b/commits?page=9>; rel="last"'),
    9,
  );
});

test("fetches the last commit page and uses its author date", async () => {
  const pages: number[] = [];
  const request: CommitHistoryRequest = async ({ page }) => {
    pages.push(page);
    return page === 1
      ? {
          data: [{ commit: { author: { date: "2026-07-01T00:00:00Z" } } }],
          headers: { link: '<https://api.github.com/repos/a/b/commits?page=3>; rel="last"' },
        }
      : { data: [{ commit: { author: { date: "2025-01-01T00:00:00Z" } } }] };
  };
  const result = await fetchEarliestCommitEvidence(skill("a/b:test"), request);
  assert.deepEqual(pages, [1, 3]);
  assert.equal(result.requestCount, 2);
  assert.equal(result.evidence.earliestCommitAt, "2025-01-01T00:00:00.000Z");
});

test("single-page history uses one request", async () => {
  const request: CommitHistoryRequest = async () => ({
    data: [{ commit: { committer: { date: "2025-02-01T00:00:00Z" } } }],
  });
  const result = await fetchEarliestCommitEvidence(skill("a/b:test"), request);
  assert.equal(result.requestCount, 1);
  assert.equal(result.evidence.status, "ok");
});

test("unique earliest confirms or overturns medium candidates", () => {
  const medium = cluster("sha", ["a/repo:test", "b/repo:test"], "medium", "a/repo:test");
  const confirmed = evaluateCommitEvidence(medium, [
    evidence("a/repo:test", "2025-01-01T00:00:00Z"),
    evidence("b/repo:test", "2025-02-01T00:00:00Z"),
  ]);
  const overturned = evaluateCommitEvidence(medium, [
    evidence("a/repo:test", "2025-03-01T00:00:00Z"),
    evidence("b/repo:test", "2025-02-01T00:00:00Z"),
  ]);
  assert.equal(confirmed.result, "confirmed");
  assert.equal(overturned.result, "overturned");
  assert.equal(overturned.proposedCanonicalSkillId, "b/repo:test");
});

test("unique earliest resolves unresolved cluster", () => {
  const result = evaluateCommitEvidence(cluster("sha", ["a/repo:test", "b/repo:test"]), [
    evidence("a/repo:test", "2025-01-01T00:00:00Z"),
    evidence("b/repo:test", "2025-02-01T00:00:00Z"),
  ]);
  assert.equal(result.result, "resolved");
  assert.equal(result.proposedCanonicalSkillId, "a/repo:test");
});

test("ties and incomplete evidence do not propose winners", () => {
  const target = cluster("sha", ["a/repo:test", "b/repo:test"]);
  const tied = evaluateCommitEvidence(target, [
    evidence("a/repo:test", "2025-01-01T00:00:00Z"),
    evidence("b/repo:test", "2025-01-01T00:00:00Z"),
  ]);
  const incomplete = evaluateCommitEvidence(target, [
    evidence("a/repo:test", "2025-01-01T00:00:00Z"),
    evidence("b/repo:test", null, "missing"),
  ]);
  assert.equal(tied.result, "tie");
  assert.equal(tied.proposedCanonicalSkillId, null);
  assert.equal(incomplete.result, "incomplete");
  assert.equal(incomplete.proposedCanonicalSkillId, null);
});

test("commit winner requires at least a seven-day lead", () => {
  const target = cluster("sha", ["a/repo:test", "b/repo:test"]);
  const weak = evaluateCommitEvidence(target, [
    evidence("a/repo:test", "2025-01-01T00:00:00Z"),
    evidence("b/repo:test", "2025-01-07T23:59:59Z"),
  ]);
  const strong = evaluateCommitEvidence(target, [
    evidence("a/repo:test", "2025-01-01T00:00:00Z"),
    evidence("b/repo:test", "2025-01-08T00:00:00Z"),
  ]);
  assert.equal(weak.result, "weak-lead");
  assert.equal(weak.proposedCanonicalSkillId, null);
  assert.equal(strong.result, "resolved");
  assert.equal(strong.leadSeconds, MINIMUM_CANONICAL_LEAD_SECONDS);
});

test("selection is balanced, deterministic, path-gated, and member-capped", () => {
  const clusters = [
    cluster("m2", ["m/two:a", "m/two:b"], "medium", "m/two:a"),
    cluster("m3", ["m/three:a", "m/three:b", "m/three:c"], "medium", "m/three:a"),
    cluster("u2", ["u/two:a", "u/two:b"]),
    cluster("u3", ["u/three:a", "u/three:b", "u/three:c"]),
    cluster("missing", ["x/repo:a", "x/repo:b"]),
  ];
  const skills = clusters.flatMap((row) => row.memberSkillIds.map((id) => skill(id)));
  skills.find((row) => row.id === "x/repo:b")!.skill_md_path = undefined;
  const selected = selectCommitPilotClusters(artifact(clusters), skills, { maxPerBucket: 1, maxMembers: 6 });
  assert.deepEqual(selected.selected.map((row) => row.cluster.skillMdSha), ["m3", "u3"]);
  assert.equal(selected.skippedMissingPathCount, 1);
});

test("selection offset advances both balanced buckets", () => {
  const clusters = [
    cluster("m1", ["m/one:a", "m/one:b"], "medium", "m/one:a"),
    cluster("m2", ["m/two:a", "m/two:b"], "medium", "m/two:a"),
    cluster("u1", ["u/one:a", "u/one:b"]),
    cluster("u2", ["u/two:a", "u/two:b"]),
  ];
  const skills = clusters.flatMap((row) => row.memberSkillIds.map((id) => skill(id)));
  const selected = selectCommitPilotClusters(artifact(clusters), skills, {
    maxPerBucket: 1,
    offsetPerBucket: 1,
  });
  assert.deepEqual(selected.selected.map((row) => row.cluster.skillMdSha), ["m2", "u2"]);
});

test("trusted candidate audit bucket excludes same-repo and star-leader clusters", () => {
  const trustedCandidate: ShaCanonicalCluster = {
    skillMdSha: "trusted",
    memberSkillIds: ["trusted/source:a", "copy/repo:a"],
    canonicalSkillId: "trusted/source:a",
    confidence: "medium",
    reason: "trusted-creator",
  };
  const sameRepoHigh: ShaCanonicalCluster = {
    skillMdSha: "same",
    memberSkillIds: ["same/repo:a", "same/repo:b"],
    canonicalSkillId: "same/repo:a",
    confidence: "high",
    reason: "same-repo",
  };
  const medium = cluster("medium", ["medium/one:a", "medium/two:a"], "medium", "medium/one:a");
  const clusters = [trustedCandidate, sameRepoHigh, medium];
  const skills = clusters.flatMap((row) => row.memberSkillIds.map((id) => skill(id)));
  const selected = selectCommitPilotClusters(artifact(clusters), skills, {
    buckets: ["trusted-candidate"],
  });
  assert.deepEqual(selected.selected.map((row) => row.cluster.skillMdSha), ["trusted"]);
  assert.equal(selected.eligibleTrustedCandidateCount, 1);
  assert.equal(selected.eligibleMediumCount, 1);
});

test("commit evidence can confirm a trusted candidate", () => {
  const trustedCandidate: ShaCanonicalCluster = {
    skillMdSha: "trusted",
    memberSkillIds: ["trusted/source:a", "copy/repo:a"],
    canonicalSkillId: "trusted/source:a",
    confidence: "medium",
    reason: "trusted-creator",
  };
  const result = evaluateCommitEvidence(trustedCandidate, [
    evidence("trusted/source:a", "2025-01-01T00:00:00Z"),
    evidence("copy/repo:a", "2025-02-01T00:00:00Z"),
  ]);
  assert.equal(result.priorConfidence, "medium");
  assert.equal(result.result, "confirmed");
});

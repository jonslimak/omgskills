import assert from "node:assert/strict";
import test from "node:test";
import {
  createPolicyObservationSnapshot,
  snapshotFreshness,
  validatePolicyObservationSnapshot,
} from "./observation-snapshot.js";

function snapshot(capturedAt = "2026-07-24T12:00:00.000Z") {
  return createPolicyObservationSnapshot({
    version: 1,
    track: "v2",
    capturedAt,
    sourceCommit: "abc123",
    policyDigest: "sha256:policy",
    payload: {
      legacySkills: [{
        id: "owner/repo:skill",
        github_url: "https://github.com/owner/repo",
        skill_md_path: "skills/skill/SKILL.md",
      }],
      candidates: [],
    },
  });
}

test("snapshot id is deterministic and validates its complete payload", () => {
  assert.equal(snapshot().snapshotId, snapshot().snapshotId);
  assert.equal(
    snapshot("2026-07-24T12:00:00.000Z").snapshotId,
    snapshot("2026-07-25T12:00:00.000Z").snapshotId,
  );
  assert.deepEqual(validatePolicyObservationSnapshot(snapshot()), snapshot());
});

test("Crawl 4 snapshot identity ignores non-policy generation timestamps", () => {
  const crawlSnapshot = (generatedAt: string) => createPolicyObservationSnapshot({
    version: 1,
    track: "crawl4",
    capturedAt: generatedAt,
    sourceCommit: "abc123",
    policyDigest: "sha256:policy",
    payload: {
      admissionCandidates: [],
      repoIndex: { generatedAt, repoCount: 0, repos: [] },
      qualitySkills: [],
      goldBasketRepos: [],
      goldBasketSkillIds: [],
      installAdmissionEnabled: false,
      qualityTiersEnabled: true,
    },
  });
  assert.equal(
    crawlSnapshot("2026-07-24T12:00:00.000Z").snapshotId,
    crawlSnapshot("2026-07-25T12:00:00.000Z").snapshotId,
  );
});

test("tampered and partial snapshots fail closed", () => {
  const valid = snapshot();
  assert.throws(
    () => validatePolicyObservationSnapshot({
      ...valid,
      payload: { ...valid.payload, legacySkills: [] },
    }),
    /digest mismatch/,
  );
  assert.throws(
    () => validatePolicyObservationSnapshot({
      version: 1,
      track: "v2",
    }),
    /metadata is incomplete/,
  );
  const incompletePayload = createPolicyObservationSnapshot({
    version: 1,
    track: "v2",
    capturedAt: "2026-07-24T12:00:00.000Z",
    sourceCommit: "abc123",
    policyDigest: "sha256:policy",
    payload: {
      legacySkills: [],
    },
  } as never);
  assert.throws(
    () => validatePolicyObservationSnapshot(incompletePayload),
    /payload is incomplete/,
  );
});

test("stale snapshots warn through metadata but remain replayable", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  assert.equal(snapshotFreshness(snapshot("2026-07-21T13:00:00.000Z"), now, 72), "fresh");
  assert.equal(snapshotFreshness(snapshot("2026-07-21T11:00:00.000Z"), now, 72), "stale");
});

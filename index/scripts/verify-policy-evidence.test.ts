import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPolicyEvidence } from "./verify-policy-evidence.js";

function report(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-07-24T12:00:00.000Z",
    sourceCommit: "abc",
    policyDigest: "sha256:one",
    snapshotId: "sha256:snapshot-one",
    snapshotCapturedAt: "2026-07-24T12:00:00.000Z",
    countsByReason: {},
    legacySkillCount: 10,
    proposedSkillCount: 10,
    effectiveSkillCount: 10,
    potentialAdditionCount: 0,
    removalCount: 0,
    changedCount: 0,
    migration: { enforcementReady: true },
    ...overrides,
  };
}

function writeReport(directory: string, name: string, value: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

function verify(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  mode: "policy-diff" | "drift",
  now = new Date("2026-07-24T13:00:00.000Z"),
) {
  const directory = mkdtempSync(join(tmpdir(), "policy-evidence-"));
  return verifyPolicyEvidence({
    mode,
    firstPath: writeReport(directory, "first.json", first),
    secondPath: writeReport(directory, "second.json", second),
    outputDirectory: directory,
    requireReady: false,
    maxAgeHours: 72,
  }, now);
}

test("policy-diff compares different policy over identical facts", () => {
  const summary = verify(
    report(),
    report({ policyDigest: "sha256:two", sourceCommit: "def" }),
    "policy-diff",
  );
  assert.equal(summary.comparisonValid, true);
  assert.equal(summary.readinessEligible, false);
});

test("drift compares different snapshots under identical policy", () => {
  const summary = verify(
    report(),
    report({
      snapshotId: "sha256:snapshot-two",
      snapshotCapturedAt: "2026-07-24T12:30:00.000Z",
      sourceCommit: "def",
    }),
    "drift",
  );
  assert.equal(summary.comparisonValid, true);
  assert.equal(summary.readinessEligible, true);
});

test("no-op comparison and incomplete migration fail validation", () => {
  const noOp = verify(report(), report(), "drift");
  assert.equal(noOp.comparisonValid, false);
  assert.match(noOp.issues.join("\n"), /no-op/);

  const incomplete = verify(
    report(),
    report({
      snapshotId: "sha256:snapshot-two",
      migration: { enforcementReady: false },
    }),
    "drift",
  );
  assert.equal(incomplete.comparisonValid, false);
  assert.match(incomplete.issues.join("\n"), /migration coverage is incomplete/);
});

test("stale snapshots remain comparable but cannot count as readiness", () => {
  const summary = verify(
    report({ snapshotCapturedAt: "2026-07-20T00:00:00.000Z" }),
    report({
      snapshotId: "sha256:snapshot-two",
      snapshotCapturedAt: "2026-07-20T01:00:00.000Z",
    }),
    "drift",
  );
  assert.equal(summary.comparisonValid, true);
  assert.equal(summary.readinessEligible, false);
  assert.deepEqual(summary.freshness, {
    first: "stale",
    second: "stale",
    maxAgeHours: 72,
  });
  assert.match(summary.readinessIssues.join("\n"), /stale/);
});

test("operational threshold overruns block readiness without invalidating evidence", () => {
  const summary = verify(
    report({
      legacySkillCount: 100,
      removalCount: 3,
      countsByReason: { "do-not-crawl": 3 },
    }),
    report({
      snapshotId: "sha256:snapshot-two",
      snapshotCapturedAt: "2026-07-24T12:30:00.000Z",
      legacySkillCount: 100,
      removalCount: 3,
      countsByReason: { "do-not-crawl": 3 },
    }),
    "drift",
  );
  assert.equal(summary.comparisonValid, true);
  assert.equal(summary.readinessEligible, false);
  assert.match(summary.readinessIssues.join("\n"), /tighter limit 2/);
});

test("Crawl 4 additions above the review threshold block readiness", () => {
  const crawlReport = (overrides: Record<string, unknown> = {}) => report({
    legacySkillCount: undefined,
    removalCount: undefined,
    migration: undefined,
    admissionChangeCount: 0,
    admissionObservationCount: 0,
    admissionAdditionCount: 0,
    admissionRemovalCount: 0,
    skippedSuppressedCandidateCount: 0,
    repoStateChangeCount: 0,
    qualityTierChangeCount: 0,
    ...overrides,
  });
  const summary = verify(
    crawlReport({
      admissionChangeCount: 51,
      admissionObservationCount: 51,
      admissionAdditionCount: 51,
      countsByReason: { "install-signal": 51 },
    }),
    crawlReport({
      snapshotId: "sha256:snapshot-two",
      snapshotCapturedAt: "2026-07-24T12:30:00.000Z",
      admissionChangeCount: 51,
      admissionObservationCount: 51,
      admissionAdditionCount: 51,
      countsByReason: { "install-signal": 51 },
    }),
    "drift",
  );
  assert.equal(summary.comparisonValid, true);
  assert.equal(summary.readinessEligible, false);
  assert.match(summary.readinessIssues.join("\n"), /additions 51 exceed the review limit 50/);
});

test("partial reports fail before evidence files are written", () => {
  const directory = mkdtempSync(join(tmpdir(), "policy-evidence-partial-"));
  const firstPath = writeReport(directory, "first.json", report());
  const secondPath = writeReport(directory, "second.json", { policyDigest: "sha256:two" });
  assert.throws(
    () => verifyPolicyEvidence({
      mode: "policy-diff",
      firstPath,
      secondPath,
      outputDirectory: directory,
      requireReady: false,
    }),
    /missing required evidence metadata/,
  );
  assert.equal(existsSync(join(directory, "policy-evidence.json")), false);
  assert.equal(existsSync(join(directory, "policy-evidence.md")), false);
});

test("reason totals must explain every reported observation", () => {
  const summary = verify(
    report({ removalCount: 1 }),
    report({
      snapshotId: "sha256:snapshot-two",
      snapshotCapturedAt: "2026-07-24T12:30:00.000Z",
      removalCount: 1,
    }),
    "drift",
  );
  assert.equal(summary.comparisonValid, false);
  assert.match(summary.issues.join("\n"), /reason count 0 does not explain 1/);
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { effectivePolicyDigest } from "../scraper/policy/digest.js";
import { loadPolicySources, typedPolicySources } from "../scraper/policy/loader.js";
import {
  createPolicyObservationSnapshot,
  writePolicyObservationSnapshot,
  type Crawl4PolicyObservationSnapshot,
  type V2PolicyObservationSnapshot,
} from "../scraper/policy/observation-snapshot.js";
import { replayPolicyObservation } from "./replay-policy-observation.js";

const indexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(indexRoot, "scraper", "policy", "fixtures");
const policyDigest = effectivePolicyDigest(typedPolicySources(loadPolicySources()));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureRoot, name), "utf8")) as T;
}

function replayTwice(snapshot: V2PolicyObservationSnapshot | Crawl4PolicyObservationSnapshot) {
  const directory = mkdtempSync(join(tmpdir(), "policy-replay-"));
  const snapshotPath = join(directory, "snapshot.json");
  const firstOutput = join(directory, "first");
  const secondOutput = join(directory, "second");
  writePolicyObservationSnapshot(snapshotPath, snapshot);
  const first = replayPolicyObservation({
    snapshotPath,
    outputDirectory: firstOutput,
    maxAgeHours: 1_000_000,
  });
  const second = replayPolicyObservation({
    snapshotPath,
    outputDirectory: secondOutput,
    maxAgeHours: 1_000_000,
  });
  assert.equal(
    readFileSync(first.reportPath, "utf8"),
    readFileSync(second.reportPath, "utf8"),
  );
  return JSON.parse(readFileSync(first.reportPath, "utf8")) as Record<string, unknown>;
}

test("v2 replay is deterministic and uses current shared policy", () => {
  const snapshot = createPolicyObservationSnapshot({
    version: 1,
    track: "v2",
    capturedAt: "2026-07-24T12:00:00.000Z",
    sourceCommit: "fixture",
    policyDigest,
    payload: fixture<V2PolicyObservationSnapshot["payload"]>("v2-replay-facts.json"),
  }) as V2PolicyObservationSnapshot;
  const report = replayTwice(snapshot);
  assert.equal(report.snapshotId, snapshot.snapshotId);
  assert.equal(report.policyDigest, policyDigest);
  assert.equal(report.removalCount, 1);
  assert.equal(report.potentialAdditionCount, 1);
});

test("crawl4 replay is deterministic and reports precedence changes", () => {
  const snapshot = createPolicyObservationSnapshot({
    version: 1,
    track: "crawl4",
    capturedAt: "2026-07-24T12:00:00.000Z",
    sourceCommit: "fixture",
    policyDigest,
    payload: fixture<Crawl4PolicyObservationSnapshot["payload"]>("crawl4-replay-facts.json"),
  }) as Crawl4PolicyObservationSnapshot;
  const report = replayTwice(snapshot);
  assert.equal(report.snapshotId, snapshot.snapshotId);
  assert.equal(report.policyDigest, policyDigest);
  assert.equal(report.repoStateChangeCount, 1);
});

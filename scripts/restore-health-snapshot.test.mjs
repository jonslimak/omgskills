import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_MAX_AGE_MS,
  restoreLatestHealthSnapshot,
  validateArtifactSnapshot,
} from "./restore-health-snapshot.mjs";

function snapshot(checkedAt, status = "ok") {
  return JSON.stringify({ status, checkedAt, sections: { v2AppData: { status: "ok" } } });
}

test("restores the newest valid pipeline-health artifact", async () => {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "restore-health-site-"));
  const checkedAt = "2026-08-17T12:00:00Z";
  const result = await restoreLatestHealthSnapshot({
    siteDir,
    repository: "owner/repo",
    nowMs: Date.parse("2026-08-17T13:00:00Z"),
    listRuns: async () => [{ databaseId: 42 }],
    downloadRunArtifact: async ({ destination }) => {
      const artifact = path.join(destination, "pipeline-health-snapshot-42", "health.json");
      await mkdir(path.dirname(artifact), { recursive: true });
      await writeFile(artifact, snapshot(checkedAt));
    },
  });

  assert.equal(result.runId, 42);
  assert.equal(
    await readFile(path.join(siteDir, "data", "health.json"), "utf8"),
    snapshot(checkedAt),
  );
});

test("skips invalid artifacts and restores the next valid run", async () => {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "restore-health-fallback-"));
  const result = await restoreLatestHealthSnapshot({
    siteDir,
    repository: "owner/repo",
    nowMs: Date.parse("2026-08-17T13:00:00Z"),
    listRuns: async () => [{ databaseId: 2 }, { databaseId: 1 }],
    downloadRunArtifact: async ({ runId, destination }) => {
      const artifact = path.join(destination, `snapshot-${runId}`, "health.json");
      await mkdir(path.dirname(artifact), { recursive: true });
      await writeFile(
        artifact,
        runId === 2 ? JSON.stringify({ status: "ok" }) : snapshot("2026-08-17T12:00:00Z", "degraded"),
      );
    },
  });
  assert.equal(result.runId, 1);
});

test("rejects stale snapshots and fails closed when no valid artifact exists", async () => {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "restore-health-stale-"));
  await assert.rejects(
    restoreLatestHealthSnapshot({
      siteDir,
      repository: "owner/repo",
      nowMs: Date.parse("2026-08-17T13:00:00Z"),
      listRuns: async () => [{ databaseId: 9 }],
      downloadRunArtifact: async ({ destination }) => {
        await writeFile(
          path.join(destination, "health.json"),
          snapshot(new Date(Date.parse("2026-08-17T13:00:00Z") - DEFAULT_MAX_AGE_MS - 1).toISOString()),
        );
      },
    }),
    /No valid recent pipeline-health snapshot artifact.*stale/,
  );
});

test("requires a valid checkedAt timestamp", () => {
  assert.throws(
    () => validateArtifactSnapshot(snapshot("not-a-date"), "fixture"),
    /valid checkedAt/,
  );
});

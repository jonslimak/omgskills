import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureHealthSnapshot, parseHealthSnapshot } from "./health-snapshot-guard.mjs";

const validSnapshot = JSON.stringify({
  status: "ok",
  checkedAt: "2026-07-15T12:00:00Z",
  sections: { v2AppData: { status: "ok" } },
});

test("keeps an existing valid health snapshot without fetching", async () => {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "health-snapshot-existing-"));
  const target = path.join(siteDir, "data", "health.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, validSnapshot);

  const result = await ensureHealthSnapshot({
    siteDir,
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });

  assert.equal(result.restored, false);
  assert.equal(await readFile(target, "utf8"), validSnapshot);
});

test("restores a missing health snapshot from production", async () => {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "health-snapshot-restore-"));
  let requestedUrl = "";

  const result = await ensureHealthSnapshot({
    siteDir,
    productionOrigin: "https://example.test/",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(validSnapshot, { status: 200 });
    },
  });

  assert.equal(result.restored, true);
  assert.equal(requestedUrl, "https://example.test/data/health.json");
  assert.equal(await readFile(path.join(siteDir, "data", "health.json"), "utf8"), validSnapshot);
});

test("rejects an invalid existing or downloaded health snapshot", async () => {
  const invalidSiteDir = await mkdtemp(path.join(os.tmpdir(), "health-snapshot-invalid-"));
  const invalidTarget = path.join(invalidSiteDir, "data", "health.json");
  await mkdir(path.dirname(invalidTarget), { recursive: true });
  await writeFile(invalidTarget, JSON.stringify({ status: "ok" }));

  await assert.rejects(
    ensureHealthSnapshot({ siteDir: invalidSiteDir }),
    /missing sections/,
  );

  const missingSiteDir = await mkdtemp(path.join(os.tmpdir(), "health-snapshot-bad-download-"));
  await assert.rejects(
    ensureHealthSnapshot({
      siteDir: missingSiteDir,
      fetchImpl: async () => new Response("not json", { status: 200 }),
    }),
    /Invalid health snapshot JSON/,
  );
});

test("parses degraded snapshots so real failures remain publishable", () => {
  const snapshot = parseHealthSnapshot(JSON.stringify({ status: "degraded", sections: {} }));
  assert.equal(snapshot.status, "degraded");
});

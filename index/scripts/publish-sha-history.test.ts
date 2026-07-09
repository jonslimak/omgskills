import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertShaHistoryDoesNotShrink,
  buildShaHistoryAsset,
  pruneSupersededShaHistoryAssets,
  writeShaHistoryAsset,
  type ShaHistoryAsset,
} from "./publish-sha-history.js";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

function asset(generatedAt: string, shaToSkillIds: Record<string, string[]>): ShaHistoryAsset {
  return { version: 1, generatedAt, shaToSkillIds };
}

test("appends current mappings while preserving and deduping history", () => {
  const result = buildShaHistoryAsset(
    [asset("2026-07-01T00:00:00.000Z", { [shaA]: ["owner/repo:one"] })],
    [
      { id: "owner/repo:one", skill_md_sha: shaA.toUpperCase() },
      { id: "owner/repo:two", skill_md_sha: shaB },
    ],
    "2026-07-09T00:00:00.000Z",
  );

  assert.equal(result.changed, true);
  assert.equal(result.asset.generatedAt, "2026-07-09T00:00:00.000Z");
  assert.deepEqual(result.asset.shaToSkillIds, {
    [shaA]: ["owner/repo:one"],
    [shaB]: ["owner/repo:two"],
  });
});

test("unchanged mappings preserve generatedAt and hashed filename", () => {
  const existing = asset("2026-07-01T00:00:00.000Z", { [shaA]: ["owner/repo:one"] });
  const result = buildShaHistoryAsset(
    [existing],
    [{ id: "owner/repo:one", skill_md_sha: shaA }],
    "2026-07-09T00:00:00.000Z",
  );
  const dir = mkdtempSync(join(tmpdir(), "sha-history-test-"));

  try {
    const before = writeShaHistoryAsset(dir, existing);
    const after = writeShaHistoryAsset(dir, result.asset);

    assert.equal(result.changed, false);
    assert.equal(result.asset.generatedAt, existing.generatedAt);
    assert.equal(after.path, before.path);
    assert.deepEqual(readdirSync(dir), [before.path]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("divergent track histories converge into one new asset", () => {
  const result = buildShaHistoryAsset(
    [
      asset("2026-07-01T00:00:00.000Z", { [shaA]: ["owner/repo:one"] }),
      asset("2026-07-02T00:00:00.000Z", { [shaB]: ["owner/repo:two"] }),
    ],
    [],
    "2026-07-09T00:00:00.000Z",
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.asset.shaToSkillIds, {
    [shaA]: ["owner/repo:one"],
    [shaB]: ["owner/repo:two"],
  });
});

test("shrink protection fails clearly unless explicitly allowed", () => {
  assert.throws(
    () => assertShaHistoryDoesNotShrink({ shaCount: 2, pairCount: 3 }, { shaCount: 1, pairCount: 1 }, false),
    /refusing to shrink sha history/,
  );
  assert.doesNotThrow(() =>
    assertShaHistoryDoesNotShrink({ shaCount: 2, pairCount: 3 }, { shaCount: 1, pairCount: 1 }, true)
  );
});

test("pruning keeps only current and immediately previous assets", () => {
  const dir = mkdtempSync(join(tmpdir(), "sha-history-prune-test-"));
  const current = "sha-history-current.json";
  const previous = "sha-history-previous.json";

  try {
    for (const file of [current, previous, "sha-history-old.json", "skills-unrelated.json"]) {
      writeFileSync(join(dir, file), "{}\n");
    }
    pruneSupersededShaHistoryAssets(dir, [current, previous]);

    assert.deepEqual(readdirSync(dir).sort(), [current, previous, "skills-unrelated.json"].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

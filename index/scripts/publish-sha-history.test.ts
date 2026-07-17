import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertShaHistoryDoesNotShrink,
  buildCanonicalBySha,
  buildShaHistoryAsset,
  patchManifest,
  previousShaHistoryAssetPath,
  pruneSupersededShaHistoryAssets,
  shouldPublishCanonicalBySha,
  writeShaHistoryAsset,
  type CanonicalShaEntry,
  type ShaHistoryAsset,
} from "./publish-sha-history.js";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const shaC = "c".repeat(40);

function asset(
  generatedAt: string,
  shaToSkillIds: Record<string, string[]>,
  canonicalBySha?: Record<string, CanonicalShaEntry>,
): ShaHistoryAsset {
  return canonicalBySha === undefined
    ? { version: 1, generatedAt, shaToSkillIds }
    : { version: 1, generatedAt, shaToSkillIds, canonicalBySha };
}

function canonical(skillId: string): CanonicalShaEntry {
  return { skillId, confidence: "high", reason: "same-repo" };
}

function canonicalSkill(id: string, sha: string, repo: string, stars = 0) {
  return {
    id,
    name: id.split(":").at(-1) ?? id,
    github_url: `https://github.com/${repo}`,
    skill_md_path: "SKILL.md",
    skill_md_sha: sha,
    stars,
    first_seen: "2026-07-01T00:00:00.000Z",
  };
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
    assert.equal(result.asset.canonicalBySha, undefined);
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

test("a complete existing track converges without asset churn", () => {
  const complete = asset("2026-07-01T00:00:00.000Z", {
    [shaA]: ["owner/repo:one"],
    [shaB]: ["owner/repo:two"],
  });
  const partial = asset("2026-07-02T00:00:00.000Z", {
    [shaA]: ["owner/repo:one"],
  });
  const result = buildShaHistoryAsset(
    [complete, partial],
    [],
    "2026-07-09T00:00:00.000Z",
  );

  assert.equal(result.changed, false);
  assert.equal(result.asset.generatedAt, complete.generatedAt);
  assert.deepEqual(result.asset.shaToSkillIds, complete.shaToSkillIds);
});

test("canonical publication flag is opt-in only", () => {
  assert.equal(shouldPublishCanonicalBySha({}), false);
  assert.equal(shouldPublishCanonicalBySha({ SHA_CANONICAL_PUBLISH: "0" }), false);
  assert.equal(shouldPublishCanonicalBySha({ SHA_CANONICAL_PUBLISH: "true" }), false);
  assert.equal(shouldPublishCanonicalBySha({ SHA_CANONICAL_PUBLISH: "1" }), true);
});

test("publishes only validated high-confidence same-repository mappings", () => {
  const result = buildCanonicalBySha(
    [
      canonicalSkill("same/repo:one", shaA, "same/repo", 10),
      canonicalSkill("same/repo:two", shaA, "same/repo", 5),
      canonicalSkill("trusted/source:one", shaB, "trusted/source", 10),
      canonicalSkill("copy/repo:one", shaB, "copy/repo", 5),
      canonicalSkill("left/repo:one", shaC, "left/repo", 1),
      canonicalSkill("right/repo:one", shaC, "right/repo", 1),
    ],
    { trustedCanonicalHandles: new Set(["trusted"]) },
  );

  assert.deepEqual(result, {
    [shaA]: canonical("same/repo:one"),
  });
});

test("unchanged canonical payload reuses its timestamp and hash", () => {
  const canonicalBySha = { [shaA]: canonical("owner/repo:one") };
  const existing = asset(
    "2026-07-01T00:00:00.000Z",
    { [shaA]: ["owner/repo:one", "owner/repo:two"] },
    canonicalBySha,
  );
  const result = buildShaHistoryAsset(
    [existing],
    [],
    "2026-07-09T00:00:00.000Z",
    canonicalBySha,
  );
  const dir = mkdtempSync(join(tmpdir(), "sha-history-canonical-test-"));

  try {
    const before = writeShaHistoryAsset(dir, existing);
    const after = writeShaHistoryAsset(dir, result.asset);
    assert.equal(result.changed, false);
    assert.equal(result.asset.generatedAt, existing.generatedAt);
    assert.equal(after.path, before.path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recomputed canonical mappings can disappear without shrinking membership", () => {
  const existing = asset(
    "2026-07-01T00:00:00.000Z",
    { [shaA]: ["owner/repo:one", "owner/repo:two"] },
    { [shaA]: canonical("owner/repo:one") },
  );
  const result = buildShaHistoryAsset(
    [existing],
    [],
    "2026-07-09T00:00:00.000Z",
    {},
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.asset.shaToSkillIds, existing.shaToSkillIds);
  assert.deepEqual(result.asset.canonicalBySha, {});
});

test("disabling publication removes canonical data as a kill switch", () => {
  const existing = asset(
    "2026-07-01T00:00:00.000Z",
    { [shaA]: ["owner/repo:one", "owner/repo:two"] },
    { [shaA]: canonical("owner/repo:one") },
  );
  const result = buildShaHistoryAsset(
    [existing],
    [],
    "2026-07-09T00:00:00.000Z",
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.asset.shaToSkillIds, existing.shaToSkillIds);
  assert.equal(result.asset.canonicalBySha, undefined);
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

test("a no-op rerun retains the newest real previous asset", () => {
  const dir = mkdtempSync(join(tmpdir(), "sha-history-rerun-prune-test-"));
  const current = asset("2026-07-03T00:00:00.000Z", { [shaA]: ["owner/repo:one"] });
  const previous = asset("2026-07-02T00:00:00.000Z", { [shaA]: ["owner/repo:one"] });
  const oldest = asset("2026-07-01T00:00:00.000Z", { [shaA]: ["owner/repo:one"] });

  try {
    const currentFile = writeShaHistoryAsset(dir, current).path;
    const previousFile = writeShaHistoryAsset(dir, previous).path;
    writeShaHistoryAsset(dir, oldest);

    const retainedPrevious = previousShaHistoryAssetPath(dir, currentFile);
    pruneSupersededShaHistoryAssets(dir, [currentFile, retainedPrevious ?? ""]);

    assert.equal(retainedPrevious, previousFile);
    assert.deepEqual(readdirSync(dir).sort(), [currentFile, previousFile].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest patch preserves unrelated optional assets", () => {
  const dir = mkdtempSync(join(tmpdir(), "sha-history-manifest-test-"));
  const manifest = {
    version: 1,
    skills: { path: "skills.json", sha256: "skills", bytes: 1 },
    collections: { path: "collections.json", sha256: "collections", bytes: 2 },
    futureAsset: { path: "future.json", sha256: "future", bytes: 3 },
    shaHistory: { path: "old.json", sha256: "old", bytes: 4 },
  };
  const next = { path: "next.json", sha256: "next", bytes: 5 };

  try {
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    patchManifest(dir, next);
    const patched = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.deepEqual(patched, { ...manifest, shaHistory: next });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

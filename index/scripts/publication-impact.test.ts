import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  authorizedAssetRemovals,
  evaluatePublicationImpact,
  parsePublicationImpactOverride,
  snapshotPublicationDirectory,
  type PublicationSnapshot,
} from "./publication-impact.js";

const metadata = {
  sourceCommit: "abc123",
  policyDigest: `sha256:${"a".repeat(64)}`,
};

function fixture(t: TestContext, input: {
  skills?: string[];
  generatedAt?: string;
  collections?: Record<string, string[]>;
  extraAssets?: Record<string, unknown>;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "publication-impact-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest: Record<string, unknown> = {
    version: 1,
    generatedAt: input.generatedAt ?? "2026-07-23T00:00:00.000Z",
  };
  const writeAsset = (key: string, value: unknown) => {
    const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const path = `${key}.json`;
    writeFileSync(join(dataDir, path), data);
    manifest[key] = {
      path,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
    };
  };
  writeAsset("skills", (input.skills ?? ["owner/repo:one"]).map((id) => ({ id })));
  writeAsset("trending", []);
  if (input.collections) {
    writeAsset("collections", {
      version: 1,
      generatedAt: "2026-07-23T00:00:00.000Z",
      collections: Object.entries(input.collections).map(([id, skillIds]) => ({
        id,
        type: "topic",
        featuredSkillIds: [],
        skillIds,
      })),
    });
  }
  for (const [key, value] of Object.entries(input.extraAssets ?? {})) writeAsset(key, value);
  writeFileSync(join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    dataDir,
    snapshot: () => snapshotPublicationDirectory({ track: "root", dataDir, metadata }),
  };
}

function proposed(
  snapshot: PublicationSnapshot,
  overrides: Partial<PublicationSnapshot>,
): PublicationSnapshot {
  return { ...snapshot, capturedAt: "2026-07-23T01:00:00.000Z", ...overrides };
}

test("unchanged content with an equal timestamp passes", (t) => {
  const baseline = fixture(t).snapshot();
  const report = evaluatePublicationImpact({ baseline, proposed: proposed(baseline, {}) });
  assert.equal(report.blocked, false);
});

test("changed content with an equal timestamp blocks", (t) => {
  const baseline = fixture(t).snapshot();
  const report = evaluatePublicationImpact({
    baseline,
    proposed: proposed(baseline, { manifestContentDigest: `sha256:${"b".repeat(64)}` }),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((issue) => issue.code === "changed-content-with-equal-timestamp"));
});

test("older and missing timestamps block", (t) => {
  const baseline = fixture(t).snapshot();
  for (const manifestGeneratedAt of ["2026-07-22T00:00:00.000Z", null]) {
    const report = evaluatePublicationImpact({
      baseline,
      proposed: proposed(baseline, { manifestGeneratedAt }),
    });
    assert.equal(report.blocked, true);
  }
});

test("a missing baseline timestamp blocks", (t) => {
  const baseline = fixture(t).snapshot();
  const report = evaluatePublicationImpact({
    baseline: { ...baseline, manifestGeneratedAt: null },
    proposed: proposed(baseline, {}),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((issue) => issue.code === "missing-baseline-generated-at"));
});

test("skill removals use 500 or two percent whichever is tighter", (t) => {
  const skills = Array.from({ length: 44_000 }, (_, index) => `owner/repo:${index}`);
  const baseline = fixture(t, { skills }).snapshot();
  const common = {
    manifestGeneratedAt: "2026-07-23T01:00:00.000Z",
    manifestContentDigest: `sha256:${"b".repeat(64)}`,
  };
  const below = proposed(baseline, {
    ...common,
    skills: { count: skills.length - 499, ids: skills.slice(499).sort() },
  });
  assert.equal(evaluatePublicationImpact({ baseline, proposed: below }).blocked, false);
  const atLimit = proposed(baseline, {
    ...common,
    skills: { count: skills.length - 500, ids: skills.slice(500).sort() },
  });
  const report = evaluatePublicationImpact({ baseline, proposed: atLimit });
  assert.equal(report.skills.removalThreshold, 500);
  assert.equal(report.blocked, true);
});

test("reviewed override allows threshold removals and records its reason", (t) => {
  const skills = Array.from({ length: 100 }, (_, index) => `owner/repo:${index}`);
  const baseline = fixture(t, { skills }).snapshot();
  const next = proposed(baseline, {
    manifestGeneratedAt: "2026-07-23T01:00:00.000Z",
    manifestContentDigest: `sha256:${"b".repeat(64)}`,
    skills: { count: 97, ids: skills.slice(3).sort() },
  });
  const override = parsePublicationImpactOverride({
    PUBLICATION_IMPACT_OVERRIDE: "1",
    PUBLICATION_IMPACT_OVERRIDE_REASON: "reviewed dedupe batch",
  });
  const report = evaluatePublicationImpact({ baseline, proposed: next, override });
  assert.equal(report.blocked, false);
  assert.equal(report.override.reason, "reviewed dedupe batch");
  assert.ok(report.issues.some((issue) => issue.code === "large-skill-removal" && !issue.blocking));
});

test("incomplete and invalid overrides fail closed", () => {
  assert.ok(parsePublicationImpactOverride({
    PUBLICATION_IMPACT_OVERRIDE: "1",
  }).errors.length);
  assert.ok(parsePublicationImpactOverride({
    PUBLICATION_IMPACT_OVERRIDE: "yes",
    PUBLICATION_IMPACT_OVERRIDE_REASON: "reason",
  }).errors.length);
  assert.ok(parsePublicationImpactOverride({
    PUBLICATION_IMPACT_OVERRIDE_REASON: "orphan",
  }).errors.length);
});

test("unexpected optional asset removal blocks but an explicit kill switch passes", (t) => {
  const baseline = fixture(t, {
    extraAssets: { skillEquivalence: { version: 1, generatedAt: "now", groups: [] } },
  }).snapshot();
  const assets = { ...baseline.assets };
  delete assets.skillEquivalence;
  const next = proposed(baseline, {
    manifestGeneratedAt: "2026-07-23T01:00:00.000Z",
    manifestContentDigest: `sha256:${"b".repeat(64)}`,
    assets,
  });
  assert.equal(evaluatePublicationImpact({ baseline, proposed: next }).blocked, true);
  const report = evaluatePublicationImpact({
    baseline,
    proposed: next,
    authorizedRemovals: authorizedAssetRemovals({ SKILL_EQUIVALENCE_PUBLISH: "0" }),
  });
  assert.equal(report.blocked, false);
  assert.deepEqual(report.assets.authorizedRemovedKeys, ["skillEquivalence"]);
});

test("collection ID and large membership removals require review", (t) => {
  const baseline = fixture(t, {
    collections: {
      first: ["owner/repo:1", "owner/repo:2", "owner/repo:3"],
      second: ["owner/repo:4", "owner/repo:5"],
    },
  }).snapshot();
  const report = evaluatePublicationImpact({
    baseline,
    proposed: proposed(baseline, {
      manifestGeneratedAt: "2026-07-23T01:00:00.000Z",
      manifestContentDigest: `sha256:${"b".repeat(64)}`,
      collections: {
        ids: ["first"],
        memberIdsByCollection: { first: ["owner/repo:1"] },
        membershipCount: 1,
      },
    }),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((issue) => issue.code === "collection-id-removal"));
  assert.ok(report.issues.some((issue) => issue.code === "large-collection-membership-removal"));
});

test("snapshot rejects corrupt referenced assets", (t) => {
  const { dataDir } = fixture(t);
  const manifestPath = join(dataDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.skills.sha256 = "0".repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => snapshotPublicationDirectory({ track: "root", dataDir, metadata }),
    /sha256 mismatch/,
  );
});

test("snapshot rejects a manifest asset whose referenced file is missing", (t) => {
  const { dataDir } = fixture(t);
  rmSync(join(dataDir, "skills.json"));
  assert.throws(
    () => snapshotPublicationDirectory({ track: "root", dataDir, metadata }),
    /skills asset file is missing/,
  );
});

test("snapshot rejects a malformed known asset descriptor", (t) => {
  const { dataDir } = fixture(t);
  const manifestPath = join(dataDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.collections = "collections.json";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => snapshotPublicationDirectory({ track: "root", dataDir, metadata }),
    /collections manifest asset descriptor is missing or malformed/,
  );
});

test("invalid optional-asset kill switch values fail closed", () => {
  assert.throws(
    () => authorizedAssetRemovals({ SKILL_EQUIVALENCE_PUBLISH: "true" }),
    /invalid SKILL_EQUIVALENCE_PUBLISH/,
  );
  assert.throws(
    () => authorizedAssetRemovals({ COLLECTIONS_PUBLISH: "yes" }),
    /invalid COLLECTIONS_PUBLISH/,
  );
});

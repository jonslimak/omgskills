import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test, { mock } from "node:test";
import type { Skill } from "../types.js";
import { buildFinalShadowSkills } from "./build-shadow.js";
import { resolveShadowProvenance } from "./provenance.js";
import { loadTrustedSeeds } from "./seeds.js";

function skill(index: number): Skill {
  return {
    id: `snapshot/repo:skill-${index}`,
    name: `skill-${index}`,
    description: "Keep the indexed content unchanged",
    github_url: "https://github.com/snapshot/repo",
    skill_md_path: `skills/skill-${index}/SKILL.md`,
    skill_md_sha: "a".repeat(40),
    install_cmd: "install",
    author_handle: "snapshot",
    tags: [],
    stars: 100,
    last_updated: "2026-10-24T00:00:00Z",
    first_seen: "2026-10-24",
  };
}

function countPolicyReads(run: () => void): number {
  const original = fs.readFileSync;
  let reads = 0;
  const tracked = mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]).endsWith("/seeds/creators.json")) reads++;
    return Reflect.apply(original, fs, args);
  });
  syncBuiltinESMExports();
  try {
    run();
    return reads;
  } finally {
    tracked.mock.restore();
    syncBuiltinESMExports();
  }
}

test("bulk provenance reads one policy snapshot without changing skill output", () => {
  const seeds = loadTrustedSeeds();
  const baseline = Array.from({ length: 64 }, (_, index) => skill(index));
  const bootstrapped = Array.from({ length: 8 }, (_, index) => skill(index + 64));
  const expected = [...baseline, ...bootstrapped].map(row => {
    const provenance = resolveShadowProvenance(row, seeds);
    return { ...row,
      author_handle: provenance.authorHandle,
      publisher_handle: provenance.publisherHandle,
      publisher_repo: provenance.publisherRepo,
      upstream_repo: provenance.upstreamRepo,
      provenance_type: provenance.provenanceType,
      author_confidence: provenance.authorConfidence,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const reads = countPolicyReads(() => {
    assert.deepEqual(buildFinalShadowSkills(baseline, new Map(), bootstrapped), expected);
  });
  assert.equal(reads, 1, "Policy files must not be reloaded for every skill");
});

test("supplied run snapshot is reused for baseline and bootstrapped provenance", () => {
  const seeds = { ...loadTrustedSeeds(), catalogRepoRules: [
    { repo: "snapshot/repo", defaultProvenanceType: "catalog" as const },
  ] };
  const reads = countPolicyReads(() => {
    const result = buildFinalShadowSkills([skill(1)], new Map(), [skill(2)], seeds);
    assert.equal(result.length, 2);
    assert.ok(result.every(row => row.provenance_type === "catalog"));
  });
  assert.equal(reads, 0, "An injected snapshot must not trigger policy reads");
});

test("separate standalone batches load fresh snapshots rather than a global cache", () => {
  const reads = countPolicyReads(() => {
    buildFinalShadowSkills([skill(1)], new Map(), []);
    buildFinalShadowSkills([skill(2)], new Map(), []);
  });
  assert.equal(reads, 2);
});

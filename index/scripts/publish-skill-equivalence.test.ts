import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  patchSkillEquivalenceManifest,
  pruneSupersededSkillEquivalenceAssets,
  publishSkillEquivalence,
  skillEquivalencePublishMode,
  type SkillEquivalenceTrack,
} from "./publish-skill-equivalence.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

function fixtureSkills() {
  return [
    {
      id: "owner/repo:.claude/skills/build",
      name: "build",
      description: "Build and test the project with reliable local validation.",
      github_url: "https://github.com/owner/repo",
      skill_md_path: ".claude/skills/build/SKILL.md",
      skill_md_sha: "a".repeat(40),
      author_handle: "owner",
      provenance_type: "original",
    },
    {
      id: "owner/repo:.codex/skills/build",
      name: "build",
      description: "Build and test the project with reliable local validation.",
      github_url: "https://github.com/owner/repo",
      skill_md_path: ".codex/skills/build/SKILL.md",
      skill_md_sha: "b".repeat(40),
      author_handle: "owner",
      provenance_type: "original",
    },
    {
      id: "owner/repo:skills/review",
      name: "review",
      description: "Review code changes and report correctness risks.",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "skills/review/SKILL.md",
      skill_md_sha: "c".repeat(40),
      author_handle: "owner",
      provenance_type: "original",
    },
    {
      id: "owner/repo:skills-codex/review",
      name: "review",
      description: "Review code changes and report correctness risks.",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "skills-codex/review/SKILL.md",
      skill_md_sha: "d".repeat(40),
      author_handle: "owner",
      provenance_type: "original",
    },
  ];
}

function fixtureOverrides() {
  return {
    version: 1 as const,
    decisions: [{
      memberSkillIds: [
        "owner/repo:skills/review",
        "owner/repo:skills-codex/review",
      ],
      decision: "approve" as const,
    }],
  };
}

function makeTracks(root: string): SkillEquivalenceTrack[] {
  return ["crawl4", "v2"].map((name) => {
    const dir = join(root, "site", "data", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      `${JSON.stringify({ version: 1, generatedAt: "before", futureAsset: { path: "future.json" } }, null, 2)}\n`,
    );
    return { name, dir };
  });
}

function readManifest(track: SkillEquivalenceTrack) {
  return JSON.parse(readFileSync(join(track.dir, "manifest.json"), "utf8"));
}

test("publication mode is tri-state and invalid values fail", () => {
  assert.equal(skillEquivalencePublishMode({}), "noop");
  assert.equal(skillEquivalencePublishMode({ SKILL_EQUIVALENCE_PUBLISH: "" }), "noop");
  assert.equal(skillEquivalencePublishMode({ SKILL_EQUIVALENCE_PUBLISH: "1" }), "publish");
  assert.equal(skillEquivalencePublishMode({ SKILL_EQUIVALENCE_PUBLISH: "0" }), "remove");
  assert.equal(skillEquivalencePublishMode({ SKILL_EQUIVALENCE_PUBLISH: "remove" }), "remove");
  assert.throws(
    () => skillEquivalencePublishMode({ SKILL_EQUIVALENCE_PUBLISH: "true" }),
    /invalid SKILL_EQUIVALENCE_PUBLISH/,
  );
});

test("unset mode is a strict no-op", () => {
  const result = publishSkillEquivalence({
    mode: "noop",
    tracks: [{ name: "missing", dir: "/path/that/does/not/exist" }],
  });
  assert.deepEqual(result, { mode: "noop", changed: false });
});

test("unset mode preserves an existing rollout byte-for-byte", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-noop-rollout-test-"));
  const tracks = makeTracks(root);

  try {
    publishSkillEquivalence({
      mode: "publish",
      tracks,
      skills: fixtureSkills(),
      overrides: fixtureOverrides(),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });
    const before = tracks.map((track) =>
      readFileSync(join(track.dir, "manifest.json"), "utf8"),
    );
    const result = publishSkillEquivalence({ mode: "noop", tracks });
    assert.deepEqual(result, { mode: "noop", changed: false });
    assert.deepEqual(
      tracks.map((track) => readFileSync(join(track.dir, "manifest.json"), "utf8")),
      before,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("publishes identical fixture assets and reuses unchanged timestamps", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-publish-test-"));
  const tracks = makeTracks(root);

  try {
    const first = publishSkillEquivalence({
      mode: "publish",
      tracks,
      skills: fixtureSkills(),
      overrides: fixtureOverrides(),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });
    assert.equal(first.artifact?.groups.length, 2);
    assert.equal(first.review?.summary.publishableCount, first.artifact?.groups.length);
    const firstAssets = tracks.map((track) => readManifest(track).skillEquivalence);
    assert.deepEqual(firstAssets[0], firstAssets[1]);

    const second = publishSkillEquivalence({
      mode: "publish",
      tracks,
      skills: fixtureSkills(),
      overrides: fixtureOverrides(),
      generatedAt: "2026-07-17T00:00:00.000Z",
    });
    assert.equal(second.artifact?.generatedAt, "2026-07-16T00:00:00.000Z");
    assert.deepEqual(tracks.map((track) => readManifest(track).skillEquivalence), firstAssets);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit removal strips only the manifest key and retains asset files", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-remove-test-"));
  const tracks = makeTracks(root);

  try {
    publishSkillEquivalence({
      mode: "publish",
      tracks,
      skills: fixtureSkills(),
      overrides: fixtureOverrides(),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });
    const assetPaths = tracks.map((track) => readManifest(track).skillEquivalence.path);
    const removed = publishSkillEquivalence({ mode: "remove", tracks });
    assert.equal(removed.changed, true);

    tracks.forEach((track, index) => {
      const manifest = readManifest(track);
      assert.equal(manifest.skillEquivalence, undefined);
      assert.deepEqual(manifest.futureAsset, { path: "future.json" });
      assert.ok(existsSync(join(track.dir, assetPaths[index])));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removal preflights every manifest before changing any track", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-remove-preflight-test-"));
  const firstDir = join(root, "v2");
  mkdirSync(firstDir, { recursive: true });
  const before = `${JSON.stringify({
    version: 1,
    skillEquivalence: { path: "skill-equivalence-current.json", sha256: "hash", bytes: 1 },
  }, null, 2)}\n`;
  writeFileSync(join(firstDir, "manifest.json"), before);

  try {
    assert.throws(
      () =>
        publishSkillEquivalence({
          mode: "remove",
          tracks: [
            { name: "v2", dir: firstDir },
            { name: "crawl4", dir: join(root, "missing") },
          ],
        }),
      /missing manifest/,
    );
    assert.equal(readFileSync(join(firstDir, "manifest.json"), "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruning keeps current and previous equivalence assets only", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-prune-test-"));
  try {
    for (const file of [
      "skill-equivalence-current.json",
      "skill-equivalence-previous.json",
      "skill-equivalence-old.json",
      "skills-unrelated.json",
    ]) {
      writeFileSync(join(root, file), "{}\n");
    }
    pruneSupersededSkillEquivalenceAssets(root, [
      "skill-equivalence-current.json",
      "skill-equivalence-previous.json",
    ]);
    assert.deepEqual(readdirSync(root).sort(), [
      "skill-equivalence-current.json",
      "skill-equivalence-previous.json",
      "skills-unrelated.json",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("full v2 and Crawl 4 publishers preserve equivalence manifests and assets", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-preservation-test-"));
  const tracks = makeTracks(root);
  const skills = fixtureSkills();

  try {
    const published = publishSkillEquivalence({
      mode: "publish",
      tracks,
      skills,
      overrides: fixtureOverrides(),
      generatedAt: "2026-07-16T00:00:00.000Z",
    });
    assert.equal(published.artifact?.groups.length, 2);
    const assetsBefore = new Map(
      tracks.map((track) => [track.name, readManifest(track).skillEquivalence]),
    );

    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "index", "shadow"), { recursive: true });
    cpSync(join(repoRoot, "scripts", "publish-data.sh"), join(root, "scripts", "publish-data.sh"));
    cpSync(
      join(repoRoot, "scripts", "publish-crawl4-data.mjs"),
      join(root, "scripts", "publish-crawl4-data.mjs"),
    );
    writeFileSync(join(root, "index", "skills.json"), `${JSON.stringify(skills, null, 2)}\n`);
    writeFileSync(join(root, "index", "trending.json"), "[]\n");
    writeFileSync(
      join(root, "index", "shadow", "skills.cutover.shadow.json"),
      `${JSON.stringify(skills, null, 2)}\n`,
    );
    writeFileSync(
      join(root, "index", "shadow", "shadow-report.json"),
      `${JSON.stringify({ checkedAt: "2026-07-16T00:00:00.000Z", cutoverValidationPassed: true }, null, 2)}\n`,
    );

    const v2 = spawnSync("bash", [join(root, "scripts", "publish-data.sh")], {
      cwd: root,
      env: {
        ...process.env,
        OMGSKILLS_DATA_SUBDIR: "v2",
        MANIFEST_GENERATED_AT: "2026-07-16T00:00:00Z",
      },
      encoding: "utf8",
    });
    assert.equal(v2.status, 0, v2.stderr);

    const crawl4 = spawnSync(process.execPath, [join(root, "scripts", "publish-crawl4-data.mjs")], {
      cwd: root,
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(crawl4.status, 0, crawl4.stderr);

    for (const track of tracks) {
      const preserved = readManifest(track).skillEquivalence;
      assert.deepEqual(preserved, assetsBefore.get(track.name));
      assert.ok(existsSync(join(track.dir, preserved.path)));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest removal is byte-stable when the key is already absent", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-equivalence-manifest-test-"));
  try {
    mkdirSync(root, { recursive: true });
    const path = join(root, "manifest.json");
    const before = `${JSON.stringify({ version: 1, futureAsset: { path: "future.json" } }, null, 2)}\n`;
    writeFileSync(path, before);
    assert.equal(patchSkillEquivalenceManifest(root, null), false);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ShadowRepoIndex,
  ShadowRepoIndexEntry,
  ShadowSkillRecord,
} from "./types.js";
import {
  commitShadowSkillPersistence,
  CREATOR_BACKFILL_SOURCE,
  loadShadowSkillPersistenceSnapshot,
  MANUAL_CURATION_SOURCE,
  prepareShadowSkillPersistence,
  type ShadowSkillPersistencePaths,
  type ShadowSkillPersistenceSnapshot,
} from "./shadow-skill-persistence.js";

const generatedAt = "2026-08-10T20:00:00.000Z";

function skill(id: string, overrides: Partial<ShadowSkillRecord> = {}): ShadowSkillRecord {
  const repo = id.split(":")[0] ?? id;
  const [owner] = repo.split("/");
  return {
    id,
    name: id.split(":").at(-1)?.split("/").at(-1) ?? "skill",
    description: "A useful test skill with enough information.",
    github_url: `https://github.com/${repo}`,
    skill_md_path: id.includes(":") ? `${id.split(":")[1]}/SKILL.md` : "SKILL.md",
    install_cmd: "git clone",
    author_handle: owner ?? "owner",
    tags: [],
    stars: 10,
    last_updated: "2026-08-01T00:00:00Z",
    first_seen: "2026-08-01",
    skill_md_sha: `sha-${id}`,
    publisher_handle: owner ?? "owner",
    publisher_repo: repo.toLowerCase(),
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    ...overrides,
  };
}

function repoEntry(overrides: Partial<ShadowRepoIndexEntry> = {}): ShadowRepoIndexEntry {
  return {
    repo: "owner/repo",
    repoUrl: "https://github.com/owner/repo",
    state: "rising",
    discoveredSources: ["baseline"],
    skillIds: ["owner/repo:existing"],
    skillCount: 1,
    stars: 10,
    lastSeenAt: "2026-08-01T00:00:00Z",
    lastRefreshedAt: "2026-08-01T00:00:00Z",
    lastCheapCheckedAt: "2026-08-01T00:00:00Z",
    lastObservedRepoUpdatedAt: "2026-08-01T00:00:00Z",
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: "owner/repo:existing",
    topSkillStars: 10,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ShadowSkillPersistenceSnapshot> = {}): ShadowSkillPersistenceSnapshot {
  const existing = skill("owner/repo:existing");
  const repoIndex: ShadowRepoIndex = { generatedAt, repoCount: 1, repos: [repoEntry()] };
  return {
    skillOverlay: { generatedAt, skillCount: 0, skills: [] },
    cutoverSkills: [existing],
    repoOverlay: repoIndex,
    repoIndex,
    signals: [],
    revisions: {
      skillOverlay: "missing",
      cutoverSkills: "missing",
      repoOverlay: "missing",
      repoIndex: "missing",
    },
    ...overrides,
  };
}

test("adds multiple backfill skills to one existing repo and preserves state", () => {
  const prepared = prepareShadowSkillPersistence({
    snapshot: snapshot(),
    additions: ["one", "two"].map((name) => ({
      skill: skill(`owner/repo:skills/${name}`),
      repoKey: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      source: CREATOR_BACKFILL_SOURCE,
      isTrustedCreator: true,
    })),
    generatedAt,
    dedupeExactSha: true,
  });

  assert.deepEqual(prepared.outcomes.map((outcome) => outcome.status), ["added", "added"]);
  assert.equal(prepared.next.cutoverSkills.length, 3);
  assert.equal(prepared.next.skillOverlay.skillCount, 2);
  assert.ok(prepared.next.skillOverlay.skills.every((entry) => entry.source_tag === CREATOR_BACKFILL_SOURCE));
  const repo = prepared.next.repoIndex.repos[0];
  assert.equal(repo?.state, "rising");
  assert.equal(repo?.skillCount, 3);
  assert.equal(repo?.isTrustedCreator, false, "existing repo flags remain authoritative");
  assert.ok(repo?.discoveredSources.includes(CREATOR_BACKFILL_SOURCE));
  assert.ok(repo?.promotionReasons.includes(CREATOR_BACKFILL_SOURCE));
});

test("new backfill repo enters library with trusted creator state", () => {
  const empty = snapshot({
    skillOverlay: { generatedAt, skillCount: 0, skills: [] },
    cutoverSkills: [],
    repoOverlay: { generatedAt, repoCount: 0, repos: [] },
    repoIndex: { generatedAt, repoCount: 0, repos: [] },
  });
  const prepared = prepareShadowSkillPersistence({
    snapshot: empty,
    additions: [{
      skill: skill("creator/new-repo:skills/new"),
      repoKey: "creator/new-repo",
      repoUrl: "https://github.com/creator/new-repo",
      source: CREATOR_BACKFILL_SOURCE,
      isTrustedCreator: true,
    }],
    generatedAt,
  });
  const repo = prepared.next.repoIndex.repos[0];
  assert.equal(repo?.state, "library");
  assert.equal(repo?.isTrustedCreator, true);
});

test("exact SHA backfill duplicate is reported and not persisted", () => {
  const duplicate = skill("other/repo:copy", { skill_md_sha: "sha-owner/repo:existing" });
  const prepared = prepareShadowSkillPersistence({
    snapshot: snapshot(),
    additions: [{
      skill: duplicate,
      repoKey: "other/repo",
      repoUrl: "https://github.com/other/repo",
      source: CREATOR_BACKFILL_SOURCE,
    }],
    generatedAt,
    dedupeExactSha: true,
  });
  assert.deepEqual(prepared.outcomes, [{
    id: "other/repo:copy",
    status: "exact-sha-existing",
    existingId: "owner/repo:existing",
  }]);
  assert.equal(prepared.next.cutoverSkills.length, 1);
  assert.equal(prepared.next.repoIndex.repoCount, 1);
});

test("manual source preserves existing source-tag behavior", () => {
  const manual = skill("manual/repo:skill");
  const prepared = prepareShadowSkillPersistence({
    snapshot: snapshot(),
    additions: [{
      skill: manual,
      repoKey: "manual/repo",
      repoUrl: "https://github.com/manual/repo",
      source: MANUAL_CURATION_SOURCE,
    }],
    generatedAt,
  });
  assert.equal(prepared.next.skillOverlay.skills[0]?.source_tag, undefined);
});

test("id conflicts and cutover validation failures happen before writes", () => {
  assert.throws(
    () => prepareShadowSkillPersistence({
      snapshot: snapshot(),
      additions: [{
        skill: skill("owner/repo:existing", { github_url: "https://github.com/other/repo" }),
        repoKey: "other/repo",
        repoUrl: "https://github.com/other/repo",
        source: CREATOR_BACKFILL_SOURCE,
      }],
      generatedAt,
    }),
    /Shadow skill id conflict/,
  );

  assert.throws(
    () => prepareShadowSkillPersistence({
      snapshot: snapshot(),
      additions: [{
        skill: skill("owner/repo:bad", { author_handle: "wrong-owner" }),
        repoKey: "owner/repo",
        repoUrl: "https://github.com/owner/repo",
        source: CREATOR_BACKFILL_SOURCE,
      }],
      generatedAt,
    }),
    /would break cutover validation/,
  );
});

function tempPaths(root: string): ShadowSkillPersistencePaths {
  return {
    skillOverlay: join(root, "skills.overlay.json"),
    cutoverSkills: join(root, "skills.cutover.shadow.json"),
    repoOverlay: join(root, "repo-index.overlay.json"),
    repoIndex: join(root, "repo-index.shadow.json"),
    signals: join(root, "skill-signals.cutover.shadow.json"),
  };
}

function writeInitialState(paths: ShadowSkillPersistencePaths): void {
  const initial = snapshot();
  writeFileSync(paths.skillOverlay, `${JSON.stringify(initial.skillOverlay, null, 2)}\n`);
  writeFileSync(paths.cutoverSkills, `${JSON.stringify(initial.cutoverSkills, null, 2)}\n`);
  writeFileSync(paths.repoOverlay, `${JSON.stringify(initial.repoOverlay, null, 2)}\n`);
  writeFileSync(paths.repoIndex, `${JSON.stringify(initial.repoIndex, null, 2)}\n`);
  writeFileSync(paths.signals, "[]\n");
}

test("transaction rolls every shadow file back after an injected write failure", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-skill-persistence-"));
  try {
    const paths = tempPaths(root);
    writeInitialState(paths);
    const loaded = loadShadowSkillPersistenceSnapshot(paths, generatedAt);
    const prepared = prepareShadowSkillPersistence({
      snapshot: loaded,
      additions: [{
        skill: skill("owner/repo:skills/new"),
        repoKey: "owner/repo",
        repoUrl: "https://github.com/owner/repo",
        source: CREATOR_BACKFILL_SOURCE,
      }],
      generatedAt,
    });
    const before = Object.fromEntries(
      Object.entries(paths).map(([key, path]) => [key, readFileSync(path, "utf8")]),
    );
    assert.throws(
      () => commitShadowSkillPersistence({
        snapshot: loaded,
        prepared,
        paths,
        transactionStateDir: join(root, ".transaction"),
        assertTargetPath: () => {},
        failAfterAppliedFiles: 2,
      }),
      /injected Editool write failure/,
    );
    for (const [key, path] of Object.entries(paths)) {
      assert.equal(readFileSync(path, "utf8"), before[key]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale shadow revisions block overwriting newer state", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-skill-persistence-"));
  try {
    const paths = tempPaths(root);
    writeInitialState(paths);
    const loaded = loadShadowSkillPersistenceSnapshot(paths, generatedAt);
    const prepared = prepareShadowSkillPersistence({
      snapshot: loaded,
      additions: [{
        skill: skill("owner/repo:skills/new"),
        repoKey: "owner/repo",
        repoUrl: "https://github.com/owner/repo",
        source: CREATOR_BACKFILL_SOURCE,
      }],
      generatedAt,
    });
    writeFileSync(paths.repoIndex, "{\"newer\":true}\n");
    assert.throws(
      () => commitShadowSkillPersistence({
        snapshot: loaded,
        prepared,
        paths,
        transactionStateDir: join(root, ".transaction"),
        assertTargetPath: () => {},
      }),
      /policy files changed since they were loaded/,
    );
    assert.equal(readFileSync(paths.repoIndex, "utf8"), "{\"newer\":true}\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

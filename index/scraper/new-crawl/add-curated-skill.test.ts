import assert from "node:assert/strict";
import test from "node:test";
import type { ShadowRepoIndex, ShadowSkillOverlay, ShadowSkillRecord } from "./types.js";
import {
  normalizeSkillSlug,
  parseGithubSkillUrl,
  upsertCutoverSkill,
  upsertRepoEntry,
  upsertShadowSkillOverlay,
} from "./add-curated-skill.js";

function skill(id: string, overrides: Partial<ShadowSkillRecord> = {}): ShadowSkillRecord {
  return {
    id,
    name: id.split(":").at(-1) ?? id,
    description: "Useful test skill",
    github_url: "https://github.com/owner/repo",
    skill_md_path: "skills/example/SKILL.md",
    install_cmd: "git clone https://github.com/owner/repo /tmp/repo",
    author_handle: "owner",
    tags: [],
    stars: 10,
    last_updated: "2026-06-01T00:00:00Z",
    first_seen: "2026-06-01",
    publisher_handle: "owner",
    publisher_repo: "owner/repo",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    ...overrides,
  };
}

test("parseGithubSkillUrl accepts exact GitHub blob SKILL.md links", () => {
  const parsed = parseGithubSkillUrl("https://github.com/Owner/Repo/blob/main/.claude/skills/foo_bar/SKILL.md");

  assert.deepEqual(parsed, {
    owner: "Owner",
    repo: "Repo",
    ref: "main",
    path: ".claude/skills/foo_bar/SKILL.md",
    repoKey: "owner/repo",
    repoUrl: "https://github.com/Owner/Repo",
    skillId: "Owner/Repo:foo-bar",
  });
});

test("parseGithubSkillUrl derives repo-root skill id from repo name", () => {
  const parsed = parseGithubSkillUrl("https://github.com/acme/my-skill/blob/main/SKILL.md");

  assert.equal(parsed.skillId, "acme/my-skill:my-skill");
  assert.equal(parsed.path, "SKILL.md");
});

test("parseGithubSkillUrl rejects non SKILL.md links", () => {
  assert.throws(
    () => parseGithubSkillUrl("https://github.com/acme/repo/blob/main/README.md"),
    /SKILL\.md/,
  );
});

test("normalizeSkillSlug is deterministic", () => {
  assert.equal(normalizeSkillSlug(" Foo_Bar!! "), "foo-bar");
});

test("upsertShadowSkillOverlay inserts and replaces by id", () => {
  const overlay: ShadowSkillOverlay = {
    generatedAt: "old",
    skillCount: 1,
    skills: [skill("a/repo:old")],
  };

  const next = upsertShadowSkillOverlay(overlay, skill("a/repo:new"), "now");
  assert.equal(next.generatedAt, "now");
  assert.equal(next.skillCount, 2);
  assert.deepEqual(next.skills.map((entry) => entry.id), ["a/repo:new", "a/repo:old"]);

  const replaced = upsertShadowSkillOverlay(next, skill("a/repo:new", { name: "updated" }), "later");
  assert.equal(replaced.skillCount, 2);
  assert.equal(replaced.skills.find((entry) => entry.id === "a/repo:new")?.name, "updated");
});

test("upsertCutoverSkill inserts without duplicating ids", () => {
  const next = upsertCutoverSkill([skill("a/repo:one")], skill("a/repo:one", { name: "updated" }));

  assert.equal(next.length, 1);
  assert.equal(next[0]?.name, "updated");
});

test("upsertRepoEntry creates manual library repo entry", () => {
  const repoIndex: ShadowRepoIndex = { generatedAt: "old", repoCount: 0, repos: [] };
  const next = upsertRepoEntry(
    repoIndex,
    skill("Owner/Repo:foo", { stars: 42, last_updated: "2026-06-02T00:00:00Z" }),
    { repoKey: "owner/repo", repoUrl: "https://github.com/Owner/Repo" },
    "2026-06-03T00:00:00Z",
  );

  assert.equal(next.repoCount, 1);
  assert.deepEqual(next.repos[0], {
    repo: "owner/repo",
    repoUrl: "https://github.com/Owner/Repo",
    state: "library",
    discoveredSources: ["manual-curation"],
    skillIds: ["Owner/Repo:foo"],
    skillCount: 1,
    stars: 42,
    lastSeenAt: "2026-06-03T00:00:00Z",
    lastRefreshedAt: "2026-06-03T00:00:00Z",
    lastCheapCheckedAt: "2026-06-03T00:00:00Z",
    lastObservedRepoUpdatedAt: "2026-06-02T00:00:00Z",
    trustSignals: [],
    promotionReasons: ["manual-curation"],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: "Owner/Repo:foo",
    topSkillStars: 42,
  });
});

test("upsertRepoEntry preserves existing repo state and appends skill", () => {
  const repoIndex: ShadowRepoIndex = {
    generatedAt: "old",
    repoCount: 1,
    repos: [
      {
        repo: "owner/repo",
        repoUrl: "https://github.com/Owner/Repo",
        state: "rising",
        discoveredSources: ["baseline"],
        skillIds: ["Owner/Repo:old"],
        skillCount: 1,
        stars: 5,
        lastSeenAt: "old",
        lastRefreshedAt: "old",
        lastCheapCheckedAt: null,
        lastObservedRepoUpdatedAt: null,
        trustSignals: ["trusted"],
        promotionReasons: ["old-reason"],
        staleOrInvalidState: { reason: "skillFileMissing", observedRepoUpdatedAt: "old" },
        isTrustedVendor: true,
        isTrustedCreator: false,
        isGoldBasketRepo: false,
        topSkillId: "Owner/Repo:old",
        topSkillStars: 5,
      },
    ],
  };

  const next = upsertRepoEntry(
    repoIndex,
    skill("Owner/Repo:new", { stars: 20, last_updated: "2026-06-02T00:00:00Z" }),
    { repoKey: "owner/repo", repoUrl: "https://github.com/Owner/Repo" },
    "2026-06-03T00:00:00Z",
  );

  assert.equal(next.repos[0]?.state, "rising");
  assert.deepEqual(next.repos[0]?.skillIds, ["Owner/Repo:new", "Owner/Repo:old"]);
  assert.deepEqual(next.repos[0]?.discoveredSources, ["baseline", "manual-curation"]);
  assert.equal(next.repos[0]?.staleOrInvalidState, null);
  assert.equal(next.repos[0]?.isTrustedVendor, true);
  assert.equal(next.repos[0]?.topSkillId, "Owner/Repo:old");
  assert.equal(next.repos[0]?.topSkillStars, 20);
});

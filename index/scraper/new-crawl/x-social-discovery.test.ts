import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildXSocialDiscoveryCandidates,
  loadXSocialDiscoveryCandidates,
  removeBelowStarXSocialOnlyState,
  X_SOCIAL_MIN_STARS,
} from "./x-social-discovery.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, ShadowSkillRecord } from "./types.js";

test("missing X artifact skips cleanly", () => {
  const result = loadXSocialDiscoveryCandidates(join(tmpdir(), "missing-top-x-skill-tweets.json"));

  assert.deepEqual(result.candidates, []);
  assert.equal(result.skippedCount, 0);
  assert.match(result.warning ?? "", /x-social discovery skipped/);
});

test("valid X repo becomes x-social bootstrap candidate", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "Owner/Repo",
          github_url: "https://github.com/Owner/Repo",
          skill_md_path: "skills/demo/SKILL.md",
          name: "Demo",
          description: "Demo skill",
          stars: X_SOCIAL_MIN_STARS,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.repo, "owner/repo");
  assert.equal(result.candidates[0]?.candidate.source, "x-social");
  assert.equal(result.candidates[0]?.candidate.id, "owner/repo:demo");
  assert.equal(result.candidates[0]?.candidate.skill_md_path, "skills/demo/SKILL.md");
  assert.equal(result.candidates[0]?.stars, X_SOCIAL_MIN_STARS);
});

test("X repos below the star floor are skipped", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "owner/repo",
          github_url: "https://github.com/owner/repo",
          skill_md_path: "SKILL.md",
          name: "Low star",
          description: "Low star",
          stars: X_SOCIAL_MIN_STARS - 1,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedCount, 1);
});

test("X repos without usable paths are skipped", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "owner/repo",
          github_url: "https://github.com/owner/repo",
          skill_md_path: "__RESOLVE__",
          name: "Resolve",
          description: "Resolve",
          stars: 1,
        },
        {
          id: "owner/no-path",
          github_url: "https://github.com/owner/no-path",
          name: "No path",
          description: "No path",
          stars: 1,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 0);
  assert.equal(result.skippedCount, 2);
});

test("X duplicate repo path rows collapse deterministically", () => {
  const result = buildXSocialDiscoveryCandidates([
    {
      valid_skill_repos: [
        {
          id: "owner/repo",
          github_url: "https://github.com/owner/repo",
          skill_md_path: "skills/demo/SKILL.md",
          name: "Demo",
          description: "Demo",
          stars: X_SOCIAL_MIN_STARS,
        },
        {
          id: "OWNER/REPO",
          github_url: "https://github.com/OWNER/REPO",
          skill_md_path: "skills/demo/SKILL.md",
          name: "Demo",
          description: "Demo",
          stars: X_SOCIAL_MIN_STARS + 10,
        },
      ],
    },
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.stars, X_SOCIAL_MIN_STARS + 10);
});

test("X artifact file is parsed", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-social-"));
  const path = join(dir, "top-x-skill-tweets.json");
  writeFileSync(
    path,
    JSON.stringify([
      {
        valid_skill_repos: [
          {
            id: "owner/repo",
            github_url: "https://github.com/owner/repo",
            skill_md_path: "SKILL.md",
            name: "Root",
            description: "Root",
            stars: X_SOCIAL_MIN_STARS,
          },
        ],
      },
    ]),
  );

  const result = loadXSocialDiscoveryCandidates(path);
  assert.equal(result.warning, null);
  assert.equal(result.candidates[0]?.candidate.id, "owner/repo");
});

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "stars">): ShadowRepoIndexEntry {
  const { repo: repoName, stars, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "library",
    discoveredSources: ["x-social"],
    skillIds: [`${repoName}:skill`],
    skillCount: 1,
    stars,
    lastSeenAt: "2026-07-09T00:00:00Z",
    lastRefreshedAt: "2026-07-09T00:00:00Z",
    lastCheapCheckedAt: null,
    lastObservedRepoUpdatedAt: null,
    trustSignals: [],
    promotionReasons: ["new-discovery", "library-admission"],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: `${repoName}:skill`,
    topSkillStars: stars,
    ...rest,
  };
}

function repoIndex(repos: ShadowRepoIndexEntry[]): ShadowRepoIndex {
  return {
    generatedAt: "2026-07-09T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

function skill(id: string, repoName: string, stars: number): ShadowSkillRecord {
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url: `https://github.com/${repoName}`,
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: repoName.split("/")[0]!,
    publisher_handle: repoName.split("/")[0]!,
    publisher_repo: repoName,
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    tags: [],
    stars,
    last_updated: "2026-07-09T00:00:00Z",
    first_seen: "2026-07-09",
    skill_md_sha: "sha",
  };
}

test("below-star x-social-only state is removed from repo index and skills", () => {
  const index = repoIndex([
    repo({ repo: "low/repo", stars: X_SOCIAL_MIN_STARS - 1 }),
    repo({ repo: "high/repo", stars: X_SOCIAL_MIN_STARS }),
  ]);
  const result = removeBelowStarXSocialOnlyState(index, [
    skill("low/repo:skill", "low/repo", X_SOCIAL_MIN_STARS - 1),
    skill("high/repo:skill", "high/repo", X_SOCIAL_MIN_STARS),
  ]);

  assert.deepEqual(result.removedRepos, ["low/repo"]);
  assert.deepEqual(index.repos.map((entry) => entry.repo), ["high/repo"]);
  assert.deepEqual(result.skills.map((entry) => entry.id), ["high/repo:skill"]);
});

test("below-star x-social repo with non-value discovery source is removed", () => {
  const index = repoIndex([
    repo({
      repo: "mixed/repo",
      stars: X_SOCIAL_MIN_STARS - 1,
      discoveredSources: ["topics", "x-social"],
    }),
  ]);
  const result = removeBelowStarXSocialOnlyState(index, [
    skill("mixed/repo:skill", "mixed/repo", X_SOCIAL_MIN_STARS - 1),
  ]);

  assert.deepEqual(result.removedRepos, ["mixed/repo"]);
  assert.equal(index.repoCount, 0);
  assert.equal(result.skills.length, 0);
});

test("below-star x-social trusted repo is preserved", () => {
  const index = repoIndex([
    repo({
      repo: "trusted/repo",
      stars: X_SOCIAL_MIN_STARS - 1,
      isTrustedCreator: true,
    }),
  ]);
  const result = removeBelowStarXSocialOnlyState(index, [
    skill("trusted/repo:skill", "trusted/repo", X_SOCIAL_MIN_STARS - 1),
  ]);

  assert.deepEqual(result.removedRepos, []);
  assert.equal(index.repoCount, 1);
  assert.equal(result.skills.length, 1);
});

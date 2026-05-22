import test from "node:test";
import assert from "node:assert/strict";
import type { EnrichResult } from "../enrich.js";
import type { Skill } from "../types.js";
import { bootstrapRisingRepos, isBootstrapEligibleCandidate, selectBetterBootstrapCandidate } from "./bootstrap.js";
import type { RepoBootstrapCandidate, ShadowRepoIndex, ShadowRepoIndexEntry } from "./types.js";

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "stars">): ShadowRepoIndexEntry {
  const { repo: repoName, stars, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "rising",
    discoveredSources: ["baseline"],
    skillIds: [],
    skillCount: 0,
    stars,
    lastSeenAt: "2026-05-22T00:00:00Z",
    lastRefreshedAt: "2026-05-22T00:00:00Z",
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: null,
    topSkillStars: 0,
    ...rest,
  };
}

function repoIndex(repos: ShadowRepoIndexEntry[]): ShadowRepoIndex {
  return {
    generatedAt: "2026-05-22T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

function candidate(overrides: Partial<RepoBootstrapCandidate> & Pick<RepoBootstrapCandidate, "source" | "id" | "skill_md_path" | "github_url">): RepoBootstrapCandidate {
  return overrides as RepoBootstrapCandidate;
}

function skill(id: string, repo = "owner/repo"): Skill {
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url: `https://github.com/${repo}`,
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 123,
    last_updated: "2026-05-22T00:00:00Z",
    first_seen: "2026-05-22",
    skill_md_sha: "sha",
  };
}

test("best candidate prefers stronger source over higher stars", () => {
  const better = selectBetterBootstrapCandidate(
    candidate({ source: "code", id: "repo:code", skill_md_path: "SKILL.md", github_url: "https://github.com/repo", stars: 999 }),
    candidate({ source: "official", id: "repo:official", skill_md_path: "__RESOLVE__", github_url: "https://github.com/repo", stars: 1 }),
  );

  assert.equal(better.source, "official");
});

test("best candidate uses higher stars within same source", () => {
  const better = selectBetterBootstrapCandidate(
    candidate({ source: "registry", id: "repo:low", skill_md_path: "SKILL.md", github_url: "https://github.com/repo", stars: 10 }),
    candidate({ source: "registry", id: "repo:high", skill_md_path: "SKILL.md", github_url: "https://github.com/repo", stars: 20 }),
  );

  assert.equal(better.id, "repo:high");
});

test("skillssh candidates are excluded from bootstrap eligibility", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "skillssh", id: "repo:skill", skill_md_path: "__RESOLVE__", github_url: "https://github.com/repo" }),
    ),
    false,
  );
});

test("awesome candidates are excluded from bootstrap eligibility", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "awesome", id: "repo:skill", skill_md_path: "SKILL.md", github_url: "https://github.com/repo" }),
    ),
    false,
  );
});

test("official unresolved candidates are excluded from bootstrap eligibility", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "official", id: "repo:skill", skill_md_path: "__RESOLVE__", github_url: "https://github.com/repo" }),
    ),
    false,
  );
});

test("registry and code candidates are eligible for bootstrap", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "registry", id: "repo:skill", skill_md_path: "skills/x/SKILL.md", github_url: "https://github.com/repo" }),
    ),
    true,
  );
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "code", id: "repo:skill", skill_md_path: "skills/x/SKILL.md", github_url: "https://github.com/repo" }),
    ),
    true,
  );
});

test("bootstraps empty-skill rising repo on combined", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);
  const enrich = async (): Promise<EnrichResult> => ({ skill: skill("owner/repo:bootstrapped") });

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "registry", id: "owner/repo:bootstrapped", skill_md_path: "skills/bootstrapped/SKILL.md", skill_name_hint: "bootstrapped", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(index.repos[0]?.skillCount, 1);
  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:bootstrapped"]);
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:bootstrapped");
  assert.equal(index.repos[0]?.topSkillStars, 123);
});

test("failed bootstrap leaves repo empty and reports failure", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);
  const enrich = async (): Promise<EnrichResult> => ({ skill: null, failure: { scope: "candidate", key: "owner/repo", reason: "skill-path-unresolved" } });

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "code", id: "owner/repo:bootstrapped", skill_md_path: "skills/x/SKILL.md", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapFailedRepoSample.length, 1);
  assert.deepEqual(index.repos[0]?.skillIds, []);
});

test("repo with only ineligible candidate is skipped, not failed", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "skillssh", id: "owner/repo:bootstrapped", skill_md_path: "__RESOLVE__", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapFailedRepoSample.length, 0);
  assert.equal(result.bootstrapSkippedRepoSample.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample[0]?.failureReason, "no-eligible-candidate");
});

test("no bootstrap runs on non-combined cadences", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "fast",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "registry", id: "owner/repo:bootstrapped", skill_md_path: "skills/bootstrapped/SKILL.md", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.deepEqual(index.repos[0]?.skillIds, []);
});

test("canonical repo can bootstrap through alias mapping", async () => {
  const index = repoIndex([repo({ repo: "canonical/repo", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["alias/repo", candidate({ source: "registry", id: "alias/repo:bootstrapped", skill_md_path: "skills/bootstrapped/SKILL.md", github_url: "https://github.com/alias/repo" })],
    ]),
    repoAliasByCanonical: new Map([["canonical/repo", "alias/repo"]]),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    enrichCandidateFn: async (c) => ({ skill: skill(c.id, "canonical/repo") }),
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(index.repos[0]?.topSkillId, "alias/repo:bootstrapped");
});

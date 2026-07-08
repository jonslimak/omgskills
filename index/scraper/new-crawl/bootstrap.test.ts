import test from "node:test";
import assert from "node:assert/strict";
import type { EnrichResult } from "../enrich.js";
import type { Skill } from "../types.js";
import {
  bootstrapRisingRepos,
  isBootstrapEligibleCandidate,
  removeFailedNewlyAdmittedRepos,
  repairDeadPersistedRisingSkillLinks,
  selectBetterBootstrapCandidate,
} from "./bootstrap.js";
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

test("unresolved awesome candidates are excluded from bootstrap eligibility", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "awesome", id: "repo:skill", skill_md_path: "__RESOLVE__", github_url: "https://github.com/repo" }),
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

test("creator-watch candidates with concrete paths are eligible for bootstrap", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "creator-watch", id: "repo:skill", skill_md_path: "skills/x/SKILL.md", github_url: "https://github.com/repo" }),
    ),
    true,
  );
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "creator-watch", id: "repo:skill", skill_md_path: "__RESOLVE__", github_url: "https://github.com/repo" }),
    ),
    false,
  );
});

test("x-social candidates with concrete paths are eligible for bootstrap", () => {
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "x-social", id: "repo:skill", skill_md_path: "skills/x/SKILL.md", github_url: "https://github.com/repo" }),
    ),
    true,
  );
  assert.equal(
    isBootstrapEligibleCandidate(
      candidate({ source: "x-social", id: "repo:skill", skill_md_path: "__RESOLVE__", github_url: "https://github.com/repo" }),
    ),
    false,
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
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(index.repos[0]?.skillCount, 1);
  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:bootstrapped"]);
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:bootstrapped");
  assert.equal(index.repos[0]?.topSkillStars, 123);
});

test("bootstraps empty-skill library repo on combined", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0, state: "library" })]);
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
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(index.repos[0]?.skillCount, 1);
});

test("bootstraps creator-watch library repo with concrete path on combined", async () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 1,
      state: "library",
      discoveredSources: ["creator-watch"],
      promotionReasons: ["new-discovery", "library-admission"],
    }),
  ]);
  const enrich = async (): Promise<EnrichResult> => ({ skill: skill("owner/repo:bootstrapped") });

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      [
        "owner/repo",
        candidate({
          source: "creator-watch",
          id: "owner/repo:bootstrapped",
          skill_md_path: "skills/bootstrapped/SKILL.md",
          skill_name_hint: "bootstrapped",
          github_url: "https://github.com/owner/repo",
        }),
      ],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample.length, 0);
  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:bootstrapped"]);
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
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapFailedRepoSample.length, 1);
  assert.deepEqual(index.repos[0]?.skillIds, []);
});

test("bootstrap rejects enriched skill from a different repo", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0, state: "library" })]);
  const enrich = async (): Promise<EnrichResult> => ({
    skill: skill("owner/repo:bootstrapped", "other/repo"),
  });

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "registry", id: "owner/repo:bootstrapped", skill_md_path: "skills/x/SKILL.md", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: enrich,
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapFailedRepoSample[0]?.failureReason, "repo-mismatch");
  assert.deepEqual(index.repos[0]?.skillIds, []);
});

test("removes failed newly admitted repo after bootstrap", () => {
  const index = repoIndex([
    repo({
      repo: "new/repo",
      stars: 500,
      state: "library",
      promotionReasons: ["new-discovery", "library-admission"],
    }),
  ]);

  const removed = removeFailedNewlyAdmittedRepos(index, new Set(["new/repo"]));

  assert.deepEqual(removed, ["new/repo"]);
  assert.equal(index.repoCount, 0);
  assert.deepEqual(index.repos, []);
});

test("keeps successful newly admitted and existing empty repos", () => {
  const index = repoIndex([
    repo({
      repo: "new/success",
      stars: 500,
      state: "library",
      skillIds: ["new/success:skill"],
      skillCount: 1,
      promotionReasons: ["new-discovery", "library-admission"],
    }),
    repo({
      repo: "existing/empty",
      stars: 500,
      state: "library",
      promotionReasons: [],
    }),
  ]);

  const removed = removeFailedNewlyAdmittedRepos(index, new Set(["new/success"]));

  assert.deepEqual(removed, []);
  assert.equal(index.repoCount, 2);
  assert.deepEqual(index.repos.map((entry) => entry.repo), ["new/success", "existing/empty"]);
});

test("removes prior empty library-admission entries", () => {
  const index = repoIndex([
    repo({
      repo: "prior/failed",
      stars: 500,
      state: "library",
      promotionReasons: ["new-discovery", "library-admission"],
    }),
    repo({
      repo: "existing/empty",
      stars: 500,
      state: "library",
      promotionReasons: [],
    }),
  ]);

  const removed = removeFailedNewlyAdmittedRepos(index, new Set());

  assert.deepEqual(removed, ["prior/failed"]);
  assert.equal(index.repoCount, 1);
  assert.equal(index.repos[0]?.repo, "existing/empty");
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
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapFailedRepoSample.length, 0);
  assert.equal(result.bootstrapSkippedRepoSample.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample[0]?.failureReason, "no-eligible-candidate");
});

test("creator-watch unresolved candidate is skipped, not failed", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0, state: "library" })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      [
        "owner/repo",
        candidate({ source: "creator-watch", id: "owner/repo:bootstrapped", skill_md_path: "__RESOLVE__", github_url: "https://github.com/owner/repo" }),
      ],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => "skills/bootstrapped/SKILL.md",
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapFailedRepoSample.length, 0);
  assert.equal(result.bootstrapSkippedRepoSample.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample[0]?.source, "creator-watch");
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
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.deepEqual(index.repos[0]?.skillIds, []);
});

test("stale persisted rising repo with dead skillIds is cleared and becomes bootstrap-eligible", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 100,
      skillIds: ["owner/repo:missing"],
      skillCount: 1,
      topSkillId: "owner/repo:missing",
      topSkillStars: 100,
    }),
  ]);

  const repaired = repairDeadPersistedRisingSkillLinks(index, new Set<string>());

  assert.equal(repaired.repairedRepoSample.length, 1);
  assert.equal(repaired.repairedRepoSample[0]?.repo, "owner/repo");
  assert.deepEqual(repaired.repairedRepoSample[0]?.missingSkillIds, ["owner/repo:missing"]);
  assert.equal(repaired.preservedFirstSeen.get("owner/repo:missing"), "2026-05-22");
  assert.deepEqual(index.repos[0]?.skillIds, []);
  assert.equal(index.repos[0]?.skillCount, 0);
  assert.equal(index.repos[0]?.topSkillId, null);
  assert.equal(index.repos[0]?.topSkillStars, 0);
});

test("library and core repos are not cleared by stale-link repair", () => {
  const index = repoIndex([
    repo({ repo: "library/repo", stars: 10, state: "library", skillIds: ["library/repo:missing"], skillCount: 1, topSkillId: "library/repo:missing" }),
    repo({ repo: "core/repo", stars: 10, state: "core", skillIds: ["core/repo:missing"], skillCount: 1, topSkillId: "core/repo:missing" }),
  ]);

  const repaired = repairDeadPersistedRisingSkillLinks(index, new Set<string>());

  assert.equal(repaired.repairedRepoSample.length, 0);
  assert.deepEqual(index.repos[0]?.skillIds, ["library/repo:missing"]);
  assert.deepEqual(index.repos[1]?.skillIds, ["core/repo:missing"]);
});

test("repo with still-valid persisted skillIds is left untouched", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 10,
      skillIds: ["owner/repo:valid"],
      skillCount: 1,
      topSkillId: "owner/repo:valid",
      topSkillStars: 10,
    }),
  ]);

  const repaired = repairDeadPersistedRisingSkillLinks(index, new Set(["owner/repo:valid"]));

  assert.equal(repaired.repairedRepoSample.length, 0);
  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:valid"]);
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:valid");
});

test("stale persisted rising repo with valid bootstrap candidate gets bootstrapped in same run", async () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 100,
      skillIds: ["owner/repo:missing"],
      skillCount: 1,
      topSkillId: "owner/repo:missing",
      topSkillStars: 100,
    }),
  ]);

  repairDeadPersistedRisingSkillLinks(index, new Set<string>());

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "registry", id: "owner/repo:bootstrapped", skill_md_path: "skills/bootstrapped/SKILL.md", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:bootstrapped"]);
});

test("stale persisted rising repo with no candidate remains empty and follows normal bootstrap paths", async () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 100,
      skillIds: ["owner/repo:missing"],
      skillCount: 1,
      topSkillId: "owner/repo:missing",
      topSkillStars: 100,
    }),
  ]);

  repairDeadPersistedRisingSkillLinks(index, new Set<string>());

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map(),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.deepEqual(index.repos[0]?.skillIds, []);
  assert.equal(index.repos[0]?.skillCount, 0);
});

test("repair preserves prior-known first_seen date for removed skill ids", () => {
  const repaired = repairDeadPersistedRisingSkillLinks(
    repoIndex([
      repo({
        repo: "preserve/repo",
        stars: 50,
        skillIds: ["preserve/repo:missing"],
        skillCount: 1,
        topSkillId: "preserve/repo:missing",
        topSkillStars: 50,
      }),
    ]),
    new Set<string>(),
  );

  assert.equal(repaired.preservedFirstSeen.get("preserve/repo:missing"), "2026-05-22");
});

test("repair-path preserved first_seen only fills gaps in existingFirstSeen", () => {
  const existingFirstSeen = new Map<string, string>();
  const repaired = repairDeadPersistedRisingSkillLinks(
    repoIndex([
      repo({
        repo: "preserve/repo",
        stars: 50,
        skillIds: ["preserve/repo:missing"],
        skillCount: 1,
        topSkillId: "preserve/repo:missing",
        topSkillStars: 50,
      }),
    ]),
    new Set<string>(),
  );

  existingFirstSeen.set("baseline/repo:skill", "2026-05-01");
  for (const [skillId, firstSeen] of repaired.preservedFirstSeen) {
    if (!existingFirstSeen.has(skillId)) {
      existingFirstSeen.set(skillId, firstSeen);
    }
  }

  assert.equal(existingFirstSeen.get("preserve/repo:missing"), "2026-05-22");
  assert.equal(existingFirstSeen.get("baseline/repo:skill"), "2026-05-01");
});

test("baseline existingFirstSeen still wins over preserved repair date", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 100,
      skillIds: ["owner/repo:missing"],
      skillCount: 1,
      topSkillId: "owner/repo:missing",
      topSkillStars: 100,
    }),
  ]);

  const repaired = repairDeadPersistedRisingSkillLinks(index, new Set<string>());
  const existingFirstSeen = new Map<string, string>([["owner/repo:missing", "2026-05-01"]]);
  for (const [skillId, firstSeen] of repaired.preservedFirstSeen) {
    if (!existingFirstSeen.has(skillId)) {
      existingFirstSeen.set(skillId, firstSeen);
    }
  }

  assert.equal(existingFirstSeen.get("owner/repo:missing"), "2026-05-01");
});

test("same-run re-bootstrap of repaired skill id preserves first_seen instead of today", async () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 100,
      skillIds: ["owner/repo:missing"],
      skillCount: 1,
      topSkillId: "owner/repo:missing",
      topSkillStars: 100,
    }),
  ]);

  const repaired = repairDeadPersistedRisingSkillLinks(index, new Set<string>());
  const existingFirstSeen = new Map<string, string>();
  for (const [skillId, firstSeen] of repaired.preservedFirstSeen) {
    if (!existingFirstSeen.has(skillId)) {
      existingFirstSeen.set(skillId, firstSeen);
    }
  }

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-26T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "registry", id: "owner/repo:missing", skill_md_path: "skills/missing/SKILL.md", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen,
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async (_candidate, firstSeenMap): Promise<EnrichResult> => ({
      skill: {
        ...skill("owner/repo:missing"),
        first_seen: firstSeenMap.get("owner/repo:missing") ?? "2026-05-26",
      },
    }),
  });

  assert.equal(result.bootstrappedSkills[0]?.first_seen, "2026-05-22");
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
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async (c) => ({ skill: skill(c.id, "canonical/repo") }),
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(index.repos[0]?.topSkillId, "alias/repo:bootstrapped");
});

test("unresolved skillssh candidate becomes eligible when path resolution succeeds", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "skillssh", id: "owner/repo:bootstrapped", skill_md_path: "__RESOLVE__", skill_name_hint: "bootstrapped", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => "skills/bootstrapped/SKILL.md",
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample.length, 0);
});

test("unresolved official candidate becomes eligible when path resolution succeeds", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "official", id: "owner/repo:bootstrapped", skill_md_path: "__RESOLVE__", skill_name_hint: "bootstrapped", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => "skills/bootstrapped/SKILL.md",
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample.length, 0);
});

test("candidate resolution error (e.g. deleted repo) skips the repo instead of failing the run", async () => {
  const index = repoIndex([repo({ repo: "owner/gone", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/gone", candidate({ source: "official", id: "owner/gone:skill", skill_md_path: "__RESOLVE__", skill_name_hint: "skill", github_url: "https://github.com/owner/gone" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => {
      throw new Error("Not Found - https://docs.github.com/rest/git/trees#get-a-tree");
    },
    enrichCandidateFn: async () => ({ skill: skill("owner/gone:skill") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapSkippedRepoSample.length, 1);
  assert.equal(result.bootstrapSkippedRepoSample[0].failureReason, "no-eligible-candidate");
});

test("unresolved awesome candidate stays skipped when path resolution fails", async () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 0 })]);

  const result = await bootstrapRisingRepos({
    cadence: "combined",
    checkedAt: "2026-05-22T00:00:00Z",
    repoIndex: index,
    bootstrapCandidateByRepo: new Map([
      ["owner/repo", candidate({ source: "awesome", id: "owner/repo:bootstrapped", skill_md_path: "__RESOLVE__", skill_name_hint: "bootstrapped", github_url: "https://github.com/owner/repo" })],
    ]),
    repoAliasByCanonical: new Map(),
    existingFirstSeen: new Map(),
    existingSkills: new Map<string, Skill>(),
    resolveCandidatePathFn: async () => null,
    enrichCandidateFn: async () => ({ skill: skill("owner/repo:bootstrapped") }),
  });

  assert.equal(result.bootstrappedSkills.length, 0);
  assert.equal(result.bootstrapSkippedRepoSample.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  admitDiscoveredRepos,
  buildAdmissionCanonicalizationCandidates,
} from "./build-shadow.js";
import { canonicalizeAdmissionRepos } from "./repo-canonicalization.js";
import type {
  DiscoveredRepoRecord,
  DiscoverySourceName,
  ShadowRepoIndex,
  ShadowRepoIndexEntry,
  TrustedSeeds,
} from "./types.js";

function seeds(overrides: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...overrides,
  };
}

function repoIndexEntry(repo: string): ShadowRepoIndexEntry {
  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    state: "library",
    discoveredSources: ["creator-watch"],
    skillIds: [`${repo}:skill`],
    skillCount: 1,
    stars: 100,
    lastSeenAt: "2026-07-31T00:00:00.000Z",
    lastRefreshedAt: "2026-07-31T00:00:00.000Z",
    trustSignals: ["trusted-creator"],
    promotionReasons: ["library-admission"],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: true,
    isGoldBasketRepo: false,
    topSkillId: `${repo}:skill`,
    topSkillStars: 100,
  };
}

function discoveredRepo(
  repo: string,
  overrides: Partial<DiscoveredRepoRecord> = {},
): DiscoveredRepoRecord {
  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    sources: new Set<DiscoverySourceName>(["awesome"]),
    lanes: new Set(["periodic"]),
    stars: 0,
    bootstrapCandidate: {
      source: "awesome",
      id: `${repo}:skill`,
      skill_md_path: "skills/skill/SKILL.md",
      github_url: `https://github.com/${repo}`,
    },
    ...overrides,
  };
}

test("unchanged repository identity updates canonical URL and candidate casing", async () => {
  const discovered = new Map([
    ["owner/repo", discoveredRepo("owner/repo")],
  ]);

  const report = await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: ["owner/repo"],
    existingRepoKeys: new Set(),
    resolveCanonicalRepoFn: async () => ({
      repo: "Owner/Repo",
      repoUrl: "https://github.com/Owner/Repo",
    }),
  });

  assert.equal(report.checkedCount, 1);
  assert.equal(report.unchangedCount, 1);
  assert.equal(discovered.get("owner/repo")?.repoUrl, "https://github.com/Owner/Repo");
  assert.equal(discovered.get("owner/repo")?.bootstrapCandidate?.id, "owner/repo:skill");
});

test("K-Dense renamed repository merges into its existing canonical repository", async () => {
  const alias = "k-dense-ai/claude-scientific-skills";
  const canonical = "k-dense-ai/scientific-agent-skills";
  const discovered = new Map([[alias, discoveredRepo(alias)]]);

  const report = await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: [alias],
    existingRepoKeys: new Set([canonical]),
    resolveCanonicalRepoFn: async () => ({
      repo: "K-Dense-AI/scientific-agent-skills",
      repoUrl: "https://github.com/K-Dense-AI/scientific-agent-skills",
    }),
  });

  assert.equal(discovered.has(alias), false);
  assert.equal(discovered.has(canonical), true);
  assert.equal(
    discovered.get(canonical)?.bootstrapCandidate?.id,
    "k-dense-ai/scientific-agent-skills:skill",
  );
  assert.equal(report.renamedCount, 1);
  assert.equal(report.mergedIntoExistingCount, 1);
  assert.deepEqual(report.sample[0], {
    aliasRepo: alias,
    canonicalRepo: canonical,
    outcome: "merged-existing",
  });
});

test("K-Dense alias is canonicalized before admission and does not create a duplicate repo", async () => {
  const alias = "k-dense-ai/claude-scientific-skills";
  const canonical = "k-dense-ai/scientific-agent-skills";
  const repoIndex: ShadowRepoIndex = {
    generatedAt: "2026-07-31T00:00:00.000Z",
    repoCount: 1,
    repos: [repoIndexEntry(canonical)],
  };
  const trustedSeeds = seeds({ trustedCreatorHandles: new Set(["k-dense-ai"]) });
  const discovered = new Map([[alias, discoveredRepo(alias, {
    sources: new Set(["creator-watch"]),
    lanes: new Set(["fast"]),
  })]]);

  const candidates = buildAdmissionCanonicalizationCandidates(
    "combined",
    repoIndex,
    discovered,
    new Set(),
    trustedSeeds,
  );
  assert.deepEqual(candidates, [alias]);

  await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: candidates,
    existingRepoKeys: new Set([canonical]),
    resolveCanonicalRepoFn: async () => ({
      repo: canonical,
      repoUrl: `https://github.com/${canonical}`,
    }),
  });
  const admitted = admitDiscoveredRepos(
    "combined",
    "2026-07-31T00:00:00.000Z",
    repoIndex,
    discovered,
    new Set(),
    trustedSeeds,
  );

  assert.deepEqual([...admitted], []);
  assert.deepEqual(repoIndex.repos.map((repo) => repo.repo), [canonical]);
  assert.equal(discovered.has(alias), false);
});

test("renamed new repository is rekeyed with canonical bootstrap candidates", async () => {
  const discovered = new Map([
    ["old/repo", discoveredRepo("old/repo", {
      sources: new Set(["awesome", "skillssh"]),
      stars: 700,
    })],
  ]);

  const report = await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: ["old/repo"],
    existingRepoKeys: new Set(),
    resolveCanonicalRepoFn: async () => ({ repo: "new/repo", repoUrl: "https://github.com/New/Repo" }),
  });

  const canonical = discovered.get("new/repo");
  assert.equal(discovered.has("old/repo"), false);
  assert.equal(canonical?.stars, 700);
  assert.deepEqual([...canonical!.sources].sort(), ["awesome", "skillssh"]);
  assert.equal(canonical?.bootstrapCandidate?.id, "new/repo:skill");
  assert.equal(canonical?.bootstrapCandidate?.github_url, "https://github.com/New/Repo");
  assert.equal(report.sample[0]?.outcome, "renamed");
});

test("admission evaluates a renamed repository under its canonical policy key", async () => {
  const alias = "old-owner/repo";
  const canonical = "new-owner/repo";
  const repoIndex: ShadowRepoIndex = {
    generatedAt: "2026-07-31T00:00:00.000Z",
    repoCount: 0,
    repos: [],
  };
  const trustedSeeds = seeds({
    trustedCreatorHandles: new Set(["old-owner"]),
    doNotCrawlRepos: new Set([canonical]),
  });
  const discovered = new Map([[alias, discoveredRepo(alias, {
    sources: new Set(["creator-watch"]),
    lanes: new Set(["fast"]),
  })]]);

  const candidates = buildAdmissionCanonicalizationCandidates(
    "combined",
    repoIndex,
    discovered,
    new Set(),
    trustedSeeds,
  );
  await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: candidates,
    existingRepoKeys: new Set(),
    resolveCanonicalRepoFn: async () => ({
      repo: canonical,
      repoUrl: `https://github.com/${canonical}`,
    }),
  });
  const admitted = admitDiscoveredRepos(
    "combined",
    "2026-07-31T00:00:00.000Z",
    repoIndex,
    discovered,
    new Set(),
    trustedSeeds,
  );

  assert.deepEqual([...admitted], []);
  assert.equal(repoIndex.repos.length, 0);
});

test("a genuinely new renamed repository is admitted under its canonical key", async () => {
  const alias = "old-owner/repo";
  const canonical = "new-owner/repo";
  const repoIndex: ShadowRepoIndex = {
    generatedAt: "2026-07-31T00:00:00.000Z",
    repoCount: 0,
    repos: [],
  };
  const trustedSeeds = seeds({ trustedCreatorHandles: new Set(["old-owner"]) });
  const discovered = new Map([[alias, discoveredRepo(alias, {
    sources: new Set(["creator-watch"]),
    lanes: new Set(["fast"]),
  })]]);

  const candidates = buildAdmissionCanonicalizationCandidates(
    "combined",
    repoIndex,
    discovered,
    new Set(),
    trustedSeeds,
  );
  await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: candidates,
    existingRepoKeys: new Set(),
    resolveCanonicalRepoFn: async () => ({
      repo: canonical,
      repoUrl: `https://github.com/${canonical}`,
    }),
  });
  const admitted = admitDiscoveredRepos(
    "combined",
    "2026-07-31T00:00:00.000Z",
    repoIndex,
    discovered,
    new Set(),
    trustedSeeds,
  );

  assert.deepEqual([...admitted], [canonical]);
  assert.deepEqual(repoIndex.repos.map((repo) => repo.repo), [canonical]);
  assert.equal(repoIndex.repos[0]?.topSkillId, null);
});

test("multiple aliases merge deterministically into one discovered canonical repository", async () => {
  const discovered = new Map([
    ["old/a", discoveredRepo("old/a", { stars: 5, sources: new Set(["awesome"]) })],
    ["old/b", discoveredRepo("old/b", { stars: 9, sources: new Set(["registry"]) })],
  ]);

  const report = await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: ["old/b", "old/a"],
    existingRepoKeys: new Set(),
    resolveCanonicalRepoFn: async () => ({ repo: "new/repo", repoUrl: "https://github.com/new/repo" }),
  });

  assert.deepEqual([...discovered.keys()], ["new/repo"]);
  assert.equal(discovered.get("new/repo")?.stars, 9);
  assert.deepEqual([...discovered.get("new/repo")!.sources].sort(), ["awesome", "registry"]);
  assert.equal(discovered.get("new/repo")?.bootstrapCandidates?.length, 1);
  assert.equal(report.renamedCount, 2);
  assert.equal(report.mergedIntoDiscoveryCount, 1);
});

test("lookup errors defer only the affected admission candidate", async () => {
  const discovered = new Map([
    ["bad/repo", discoveredRepo("bad/repo")],
    ["good/repo", discoveredRepo("good/repo")],
  ]);

  const report = await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: ["bad/repo", "good/repo"],
    existingRepoKeys: new Set(),
    resolveCanonicalRepoFn: async (repo) => {
      if (repo === "bad/repo") throw new Error("GitHub timeout");
      return { repo, repoUrl: `https://github.com/${repo}` };
    },
  });

  assert.equal(discovered.has("bad/repo"), false);
  assert.equal(discovered.has("good/repo"), true);
  assert.equal(report.deferredByErrorCount, 1);
  assert.equal(report.sample[0]?.detail, "GitHub timeout");
});

test("canonicalization cap deterministically defers unchecked candidates", async () => {
  const discovered = new Map([
    ["owner/a", discoveredRepo("owner/a")],
    ["owner/b", discoveredRepo("owner/b")],
    ["owner/c", discoveredRepo("owner/c")],
  ]);
  const checked: string[] = [];

  const report = await canonicalizeAdmissionRepos({
    discovered,
    candidateRepos: ["owner/c", "owner/a", "owner/b"],
    existingRepoKeys: new Set(),
    maxChecks: 2,
    resolveCanonicalRepoFn: async (repo) => {
      checked.push(repo);
      return { repo, repoUrl: `https://github.com/${repo}` };
    },
  });

  assert.deepEqual(checked, ["owner/a", "owner/b"]);
  assert.equal(discovered.has("owner/c"), false);
  assert.equal(report.deferredByCapCount, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "../types.js";
import {
  buildCreatorBackfillPlan,
  executeCreatorBackfillPlan,
  selectCreatorBackfillCoverageEntries,
  type CreatorBackfillRepoScan,
} from "./creator-backfill-plan.js";
import { parseCreatorBackfillArguments } from "./creator-backfill.js";
import type { TrustedSeeds } from "./types.js";

function seeds(overrides: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    doNotCrawlRepos: new Set(),
    doNotCrawlOwners: new Set(),
    suppressedSkillIds: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...overrides,
  };
}

function scan(overrides: Partial<CreatorBackfillRepoScan> = {}): CreatorBackfillRepoScan {
  return {
    creatorHandle: "creator",
    coverage: "all",
    explicitlyApproved: false,
    repo: "creator/skills",
    repoFullName: "Creator/Skills",
    repoUrl: "https://github.com/Creator/Skills",
    defaultBranch: "main",
    paths: ["skills/one/SKILL.md"],
    ...overrides,
  };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "creator/skills:skills/one",
    name: "one",
    description: "A useful test skill.",
    github_url: "https://github.com/creator/skills",
    skill_md_path: "skills/one/SKILL.md",
    install_cmd: "git clone",
    author_handle: "creator",
    tags: [],
    stars: 1,
    last_updated: "2026-01-01T00:00:00Z",
    first_seen: "2026-01-01",
    ...overrides,
  };
}

function build(scans: CreatorBackfillRepoScan[], existingSkills: Skill[] = [], trustedSeeds = seeds()) {
  return buildCreatorBackfillPlan({
    generatedAt: "2026-08-10T12:00:00.000Z",
    sourceCommit: "abc123",
    policyDigest: "sha256:test",
    initialQuotaRemaining: 4000,
    scans,
    existingSkills,
    seeds: trustedSeeds,
  });
}

test("CLI keeps plan and bounded apply modes separate", () => {
  assert.deepEqual(parseCreatorBackfillArguments(["--plan", "--creators=B,A"]), {
    mode: "plan",
    creatorFilters: ["a", "b"],
    limit: 125,
  });
  assert.deepEqual(parseCreatorBackfillArguments(["--apply", "--limit=50"]), {
    mode: "apply",
    creatorFilters: [],
    limit: 50,
  });
  assert.throws(() => parseCreatorBackfillArguments(["--plan", "--limit=2"]), /only with --apply/);
  assert.throws(() => parseCreatorBackfillArguments(["--apply", "--creators=a"]), /only with --plan/);
  assert.throws(() => parseCreatorBackfillArguments(["--plan", "--apply"]), /Usage/);
});

test("selects all and selected coverage entries and resolves alias filters", () => {
  const entries = [
    { handle: "DisplayName", watch: true, skillCoverage: "all" as const },
    { handle: "Selected", watch: true, skillCoverage: "selected" as const, skillRepos: ["selected/skills"] },
    { handle: "Ignored", watch: true },
  ];
  assert.deepEqual(
    selectCreatorBackfillCoverageEntries(entries, [], new Map()).map((entry) => entry.handle),
    ["DisplayName", "Selected"],
  );
  assert.deepEqual(
    selectCreatorBackfillCoverageEntries(entries, ["old-name"], new Map([["old-name", "displayname"]]))
      .map((entry) => entry.handle),
    ["DisplayName"],
  );
});

test("plans exact SKILL.md files at arbitrary depth deterministically", () => {
  const plan = build([scan({ paths: ["z/SKILL.md", "README.md", "a/deep/SKILL.md", "skill.md", "z/SKILL.md"] })]);
  assert.deepEqual(plan.candidates.map((entry) => entry.path), ["a/deep/SKILL.md", "z/SKILL.md"]);
  assert.deepEqual(plan.candidates.map((entry) => entry.proposedId), [
    "Creator/Skills:a/deep",
    "Creator/Skills:z",
  ]);
});

test("canonical repo aliases prevent already-present paths from returning", () => {
  const plan = build(
    [scan({ repo: "new-owner/skills", repoFullName: "New-Owner/Skills", aliases: ["old-owner/skills"] })],
    [skill({ github_url: "https://github.com/old-owner/skills" })],
  );
  assert.equal(plan.summary.candidateCount, 0);
  assert.equal(plan.exclusions[0]?.reason, "already-present");
});

test("repo policy, catalog policy, and suppressed skills stay excluded", () => {
  const blocked = scan({ repo: "blocked/repo", repoFullName: "Blocked/Repo" });
  const catalog = scan({ repo: "catalog/repo", repoFullName: "Catalog/Repo" });
  const suppressed = scan({ repo: "safe/repo", repoFullName: "Safe/Repo", paths: ["skills/one/SKILL.md"] });
  const plan = build([blocked, catalog, suppressed], [], seeds({
    doNotCrawlRepos: new Set(["blocked/repo"]),
    catalogRepoRules: [{ repo: "catalog/repo", defaultProvenanceType: "catalog" }],
    suppressedSkillIds: new Set(["safe/repo:skills/one"]),
  }));
  assert.equal(plan.summary.candidateCount, 0);
  assert.deepEqual([...new Set(plan.exclusions.map((entry) => entry.reason))].sort(), [
    "catalog-repo",
    "do-not-crawl",
    "suppressed-skill",
  ]);
});

test("truncated trees and unapproved large repos require review", () => {
  const largePaths = Array.from({ length: 151 }, (_, index) => `skills/${index}/SKILL.md`);
  const plan = build([
    scan({ repo: "creator/truncated", repoFullName: "Creator/Truncated", treeTruncated: true }),
    scan({ repo: "creator/large", repoFullName: "Creator/Large", paths: largePaths }),
  ]);
  assert.equal(plan.summary.candidateCount, 0);
  assert.equal(plan.summary.reviewRequiredRepositoryCount, 2);
  assert.deepEqual(plan.exclusions.map((entry) => entry.reason).sort(), [
    "review-required-over-150-skills",
    "review-required-truncated-tree",
  ]);
});

test("empty repositories are recorded as stable exclusions", () => {
  const plan = build([scan({ treeUnavailableReason: "empty-repository", paths: [] })]);
  assert.equal(plan.summary.candidateCount, 0);
  assert.equal(plan.exclusions[0]?.reason, "empty-repository");
  assert.equal(plan.summary.reviewRequiredRepositoryCount, 0);
});

test("explicit selected repo approval allows a large repository", () => {
  const paths = Array.from({ length: 151 }, (_, index) => `skills/${index}/SKILL.md`);
  const plan = build([scan({ coverage: "selected", explicitlyApproved: true, paths })]);
  assert.equal(plan.summary.candidateCount, 151);
  assert.equal(plan.summary.reviewRequiredRepositoryCount, 0);
});

test("duplicate canonical candidates collapse deterministically", () => {
  const plan = build([
    scan({ creatorHandle: "a", aliases: ["old/skills"] }),
    scan({ creatorHandle: "b" }),
  ]);
  assert.equal(plan.summary.candidateCount, 1);
  assert.equal(plan.exclusions.some((entry) => entry.reason === "duplicate-plan-candidate"), true);
});

test("plan output is stable when input order changes", () => {
  const first = build([
    scan({ repo: "creator/z", repoFullName: "Creator/Z", paths: ["b/SKILL.md"] }),
    scan({ repo: "creator/a", repoFullName: "Creator/A", paths: ["a/SKILL.md"] }),
  ]);
  const second = build([
    scan({ repo: "creator/a", repoFullName: "Creator/A", paths: ["a/SKILL.md"] }),
    scan({ repo: "creator/z", repoFullName: "Creator/Z", paths: ["b/SKILL.md"] }),
  ]);
  assert.deepEqual(first, second);
});

test("failed quota preflight cannot write or replace a plan", async () => {
  let collected = false;
  let written = false;
  await assert.rejects(
    () => executeCreatorBackfillPlan({
      preflight: async () => { throw new Error("quota low"); },
      collectScans: async () => { collected = true; return []; },
      build: () => build([]),
      write: () => { written = true; },
    }),
    /quota low/,
  );
  assert.equal(collected, false);
  assert.equal(written, false);
});

test("collection failure cannot write a partial plan", async () => {
  let written = false;
  await assert.rejects(
    () => executeCreatorBackfillPlan({
      preflight: async () => 4000,
      collectScans: async () => { throw new Error("tree failed"); },
      build: () => build([]),
      write: () => { written = true; },
    }),
    /tree failed/,
  );
  assert.equal(written, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEffectiveRepoPolicy, evaluateEffectiveSkillPolicy } from "./effective-policy.js";
import type { TrustedSeeds } from "../new-crawl/types.js";

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

test("effective repository policy applies repo, owner, and override exclusions", () => {
  assert.equal(evaluateEffectiveRepoPolicy("Blocked/Repo", seeds({
    doNotCrawlRepos: new Set(["blocked/repo"]),
  })).reasonCode, "do-not-crawl");
  assert.equal(evaluateEffectiveRepoPolicy("Blocked/Other", seeds({
    doNotCrawlOwners: new Set(["blocked"]),
  })).reasonCode, "do-not-crawl");
  assert.equal(evaluateEffectiveRepoPolicy("Blocked/Repo", seeds({
    repoOverrides: [{ repo: "blocked/repo", exclude: true }],
  })).reasonCode, "repo-override-exclude");
});

test("effective skill policy checks publisher repo and normalized suppression id", () => {
  assert.equal(evaluateEffectiveSkillPolicy({
    id: "upstream/repo:skill",
    github_url: "https://github.com/Blocked/Repo.git",
  }, seeds({ doNotCrawlRepos: new Set(["blocked/repo"]) })).reasonCode, "do-not-crawl");
  assert.equal(evaluateEffectiveSkillPolicy({
    id: "Owner/Repo:Skill",
  }, seeds({ suppressedSkillIds: new Set(["owner/repo:skill"]) })).reasonCode, "suppressed-skill");
});

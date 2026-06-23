import test from "node:test";
import assert from "node:assert/strict";
import { classifyDerivedRepoTier } from "./tiering.js";
import type { TrustedSeeds } from "./types.js";

function seeds(partial: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...partial,
  };
}

test("tier1 official override beats low stars", () => {
  const result = classifyDerivedRepoTier({
    upstreamRepo: "openai/codex",
    stars: 100,
    seeds: seeds({ officialTier1Repos: new Set(["openai/codex"]) }),
  });

  assert.equal(result, "tier1");
});

test("tier1 star threshold maps correctly", () => {
  const result = classifyDerivedRepoTier({
    upstreamRepo: "owner/repo",
    stars: 50_000,
    seeds: seeds(),
  });

  assert.equal(result, "tier1");
});

test("tier2 star threshold maps correctly", () => {
  const result = classifyDerivedRepoTier({
    upstreamRepo: "owner/repo",
    stars: 10_000,
    seeds: seeds(),
  });

  assert.equal(result, "tier2");
});

test("tier2 official override beats low stars", () => {
  const result = classifyDerivedRepoTier({
    upstreamRepo: "browserbase/skills",
    stars: 25,
    seeds: seeds({ officialTier2Repos: new Set(["browserbase/skills"]) }),
  });

  assert.equal(result, "tier2");
});

test("unresolved upstream repo returns longtail", () => {
  const result = classifyDerivedRepoTier({
    upstreamRepo: null,
    stars: 999_999,
    seeds: seeds(),
  });

  assert.equal(result, "longtail");
});

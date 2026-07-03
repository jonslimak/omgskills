import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdmittedLibraryRepoEntry,
  isDiscoveredRepoAdmissionEligible,
  LIBRARY_ADMISSION_MIN_STARS,
} from "./admission.js";
import type { AdmissionDiscoveredRepo } from "./admission.js";
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

function discoveredRepo(overrides: Partial<AdmissionDiscoveredRepo> & Pick<AdmissionDiscoveredRepo, "repo">): AdmissionDiscoveredRepo {
  const { repo, ...rest } = overrides;
  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    sources: new Set(),
    stars: 0,
    bootstrapCandidate: {
      source: "registry",
      id: `${repo}:skill`,
      skill_md_path: "skills/x/SKILL.md",
      github_url: `https://github.com/${repo}`,
    },
    ...rest,
  };
}

test("manual include with clean mapping is admitted", () => {
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "owner/repo", stars: 1 }),
      seeds({ manualIncludeRepos: new Set(["owner/repo"]) }),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    true,
  );
});

test("manual include does not bypass clean mapping gate", () => {
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "owner/repo", bootstrapCandidate: undefined }),
      seeds({ manualIncludeRepos: new Set(["owner/repo"]) }),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    false,
  );
});

test("resolvable bootstrap candidate can pass admission", () => {
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({
        repo: "stars/repo",
        stars: LIBRARY_ADMISSION_MIN_STARS,
        bootstrapCandidate: {
          source: "awesome",
          id: "stars/repo:skill",
          skill_md_path: "__RESOLVE__",
          github_url: "https://github.com/stars/repo",
        },
      }),
      seeds(),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    true,
  );
});

test("official trusted gold and 500-star repos pass the gate", () => {
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "official/repo", stars: 1, sources: new Set(["official"]) }),
      seeds(),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    true,
  );
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "vendor/repo", stars: 1 }),
      seeds(),
      { isTrustedVendor: true, isGoldBasketRepo: false },
    ),
    true,
  );
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "gold/repo", stars: 1 }),
      seeds(),
      { isTrustedVendor: false, isGoldBasketRepo: true },
    ),
    true,
  );
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "stars/repo", stars: LIBRARY_ADMISSION_MIN_STARS }),
      seeds(),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    true,
  );
});

test("known catalog repo does not pass admission by stars alone", () => {
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "sickn33/antigravity-awesome-skills", stars: 50000 }),
      seeds({ catalogRepoRules: [{ repo: "sickn33/antigravity-awesome-skills", defaultProvenanceType: "catalog" }] }),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    false,
  );
});

test("do-not-crawl repo does not pass admission by manual include or stars", () => {
  const blockedSeeds = seeds({
    manualIncludeRepos: new Set(["davila7/claude-code-templates"]),
    doNotCrawlRepos: new Set(["davila7/claude-code-templates"]),
  });

  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "davila7/claude-code-templates", stars: 50000 }),
      blockedSeeds,
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    false,
  );
});

test("low-value repo stays out and momentum alone does not admit", () => {
  assert.equal(
    isDiscoveredRepoAdmissionEligible(
      discoveredRepo({ repo: "small/repo", stars: LIBRARY_ADMISSION_MIN_STARS - 1, sources: new Set(["social"]) }),
      seeds(),
      { isTrustedVendor: false, isGoldBasketRepo: false },
    ),
    false,
  );
});

test("admitted repo entry starts as library", () => {
  const entry = createAdmittedLibraryRepoEntry(
    discoveredRepo({ repo: "owner/repo", stars: LIBRARY_ADMISSION_MIN_STARS, sources: new Set(["registry"]) }),
    "2026-06-04T00:00:00Z",
    { isTrustedVendor: true, isTrustedCreator: false, isGoldBasketRepo: false },
  );

  assert.equal(entry.state, "library");
  assert.deepEqual(entry.skillIds, []);
  assert.ok(entry.promotionReasons.includes("library-admission"));
});

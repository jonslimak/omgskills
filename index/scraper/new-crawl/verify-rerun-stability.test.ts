import test from "node:test";
import assert from "node:assert/strict";
import type { ShadowCutoverCompare, ShadowRunReport, ShadowSkillRecord } from "./types.js";
import {
  firstDiffPath,
  selectComparableCutoverCompare,
  selectComparableCutoverSkills,
  selectComparableShadowReport,
} from "./verify-rerun-stability.js";

function cutoverCompare(overrides: Partial<ShadowCutoverCompare> = {}): ShadowCutoverCompare {
  return {
    checkedAt: "2026-05-27T00:00:00Z",
    counts: {
      baselineSkillCount: 1,
      cutoverSkillCount: 1,
      countDelta: 0,
      addedSkillCount: 0,
      missingSkillCount: 0,
    },
    addedSkillIdsSample: [],
    missingSkillIdsSample: [],
    authorDiffSample: [],
    unresolvedAttributionSummary: {
      baselineUnknownAuthorSkillCount: 0,
      cutoverUnknownAuthorSkillCount: 0,
      cutoverUnresolvedCatalogSkillCount: 0,
    },
    signalSummary: {
      cutoverSignalCount: 1,
      cutoverRisingSignalCount: 0,
      cutoverCoreSignalCount: 0,
    },
    validationSummary: {
      cutoverValidationPassed: true,
      cutoverValidationFailureCount: 0,
    },
    ...overrides,
  };
}

function shadowReport(overrides: Partial<ShadowRunReport> = {}): ShadowRunReport {
  return {
    checkedAt: "2026-05-27T00:00:00Z",
    status: "ok",
    cadence: "combined",
    baselineSkillCount: 1,
    shadowSkillCount: 2,
    inspectableShadowSkillCount: 1,
    excludedInspectableCatalogSkillCount: 1,
    carriedForwardCount: 0,
    correctedCount: 0,
    newlyDiscoveredCount: 0,
    staleInvalidCandidateCount: 0,
    repoCount: 1,
    repoCountsByState: { library: 1, rising: 0, core: 0 },
    trustedVendorRepoCount: 0,
    trustedCreatorRepoCount: 0,
    goldBasketRepoCount: 0,
    unresolvedBaselineSkillCount: 0,
    authorPublisherMismatchCount: 0,
    provenanceCounts: { original: 1, catalog: 0, repackaged: 0, mirrored: 0, unknown: 0 },
    unknownAuthorSkillCount: 0,
    catalogRepoSkillCount: 0,
    unresolvedCatalogSkillCount: 0,
    unresolvedCatalogPublishers: [],
    authorDiffExamples: [],
    catalogRepoExamples: [],
    topCoreRepos: [],
    topRisingRepos: [],
    sourceRuns: [],
    discoveryBudgetApplied: false,
    discoveryBudgetSummary: null,
    partialDiscoveryWarnings: [],
    highStarPathQualitySkippedCount: 0,
    highStarPathQualitySkippedSample: [],
    enrichmentCounts: {
      cheapReposChecked: 0,
      dailyPriorityRepoCount: 0,
      skillsDeepRefreshed: 0,
      monitoredDeepRefreshed: 0,
      cheapTriggeredRefreshCandidateCount: 0,
      cheapTriggeredRefreshDeferredCount: 0,
      cheapTriggeredDeepRefreshed: 0,
      carriedForwardCount: 0,
      correctedCount: 0,
      staleInvalidCandidateCount: 0,
    },
    lowStarValidSkillCount: 0,
    lowStarValidSkillSample: [],
    trustedLowStarSkillCount: 0,
    officialLowStarSkillCount: 0,
    staleInvalidCandidatesSample: [],
    skillFileMissingSample: [],
    staleReasonCounts: { repoMissing: 0, skillFileMissing: 0, validationFailed: 0 },
    priorityReasonCounts: { official: 0, trustedVendor: 0, goldBasket: 0, creatorWatch: 0, momentum: 0, stars: 0 },
    dailyPriorityRepoSample: [],
    dailyPriorityStarsFillSample: [],
    skippedMonitoredRepoCount: 0,
    nextPromotionCandidateCount: 0,
    nextPromotionCandidatesSample: [],
    nextPromotionShortlistCount: 0,
    nextPromotionShortlistSample: [],
    promotedRepoCount: 0,
    promotedToRisingCount: 0,
    newDiscoveredRepoPromotedCount: 0,
    promotedRepoSample: [],
    bootstrappedRepoCount: 0,
    bootstrappedRepoSample: [],
    catalogAdmissionCount: 0,
    catalogAdmissionSample: [],
    bootstrapFailedRepoCount: 0,
    bootstrapFailedRepoSample: [],
    bootstrapSkippedRepoCount: 0,
    bootstrapSkippedRepoSample: [],
    rebootstrapEligibleRepoCount: 0,
    rebootstrapEligibleRepoSample: [],
    shadowRepoOverlayLoaded: false,
    shadowRepoOverlayEntryCount: 0,
    shadowRepoOverlayWrittenCount: 0,
    shadowSkillOverlayLoaded: false,
    shadowSkillOverlayEntryCount: 0,
    shadowSkillOverlayWrittenCount: 0,
    enrichmentWarnings: [],
    discoveredRepoCount: 0,
    discoveredRepoCountByLane: { fast: 0, periodic: 0, background: 0 },
    discoveredRepoCountBySource: {},
    baselineRepoCountMatchedByDiscovery: 0,
    newDiscoveryRepoCount: 0,
    newDiscoveryReposSample: [],
    periodicOnlyReposSample: [],
    backgroundOnlyReposSample: [],
    bootstrapValueRepoCount: 0,
    bootstrapValueReposSample: [],
    fastOnlyRepoCount: 0,
    fastOnlyReposSample: [],
    crawl4Preview: {
      tierCounts: { tier1: 0, tier2: 0, longtail: 0 },
      missingTier1Repos: [],
      missingTier2Repos: [],
      unresolvedCatalogRepos: [],
      momentumCounts: { skillssh: 0, validatedX: 0, both: 0 },
      momentumRepoSample: [],
      currentDailyPriorityRepos: [],
      proposedDailyPriorityRepos: [],
      proposedDailyPriorityScoreSample: [],
      dailyPriorityAdded: [],
      dailyPriorityRemoved: [],
      currentShortlistRepos: [],
      proposedShortlistRepos: [],
      shortlistAdded: [],
      shortlistRemoved: [],
    },
    cutoverValidationPassed: true,
    cutoverValidationFailureCount: 0,
    cutoverValidationFailuresSample: [],
    stageTimings: { build: 1 },
    productionWriteGuardPassed: true,
    ...overrides,
    webLibraryPilotSnippetCoverage: overrides.webLibraryPilotSnippetCoverage ?? {
      selectedSkillCount: 0,
      snippetPresentCount: 0,
      fetchFailureCount: 0,
      intentionalExemptionCount: 0,
      entries: [],
    },
  };
}

test("timestamp-only compare differences normalize away", () => {
  const left = selectComparableCutoverCompare(cutoverCompare({ checkedAt: "2026-05-27T00:00:00Z" }));
  const right = selectComparableCutoverCompare(cutoverCompare({ checkedAt: "2026-05-27T01:00:00Z" }));

  assert.equal(firstDiffPath(left, right), null);
});

test("stage timing differences normalize away", () => {
  const left = selectComparableShadowReport(shadowReport({ stageTimings: { build: 1 } }));
  const right = selectComparableShadowReport(shadowReport({ stageTimings: { build: 999 } }));

  assert.equal(firstDiffPath(left, right), null);
});

test("crawl4 preview differences are compared deterministically", () => {
  const left = selectComparableShadowReport(shadowReport({
    crawl4Preview: {
      tierCounts: { tier1: 1, tier2: 2, longtail: 3 },
      missingTier1Repos: ["a/repo"],
      missingTier2Repos: ["b/repo"],
      unresolvedCatalogRepos: ["catalog/repo"],
      momentumCounts: { skillssh: 1, validatedX: 2, both: 3 },
      momentumRepoSample: ["x/repo"],
      currentDailyPriorityRepos: ["old/repo"],
      proposedDailyPriorityRepos: ["new/repo"],
      proposedDailyPriorityScoreSample: [],
      dailyPriorityAdded: ["new/repo"],
      dailyPriorityRemoved: ["old/repo"],
      currentShortlistRepos: ["old/shortlist"],
      proposedShortlistRepos: ["new/shortlist"],
      shortlistAdded: ["new/shortlist"],
      shortlistRemoved: ["old/shortlist"],
    },
  }));
  const right = selectComparableShadowReport(shadowReport({
    crawl4Preview: {
      tierCounts: { tier1: 1, tier2: 2, longtail: 3 },
      missingTier1Repos: ["a/repo"],
      missingTier2Repos: ["b/repo"],
      unresolvedCatalogRepos: ["catalog/repo"],
      momentumCounts: { skillssh: 1, validatedX: 2, both: 3 },
      momentumRepoSample: ["x/repo"],
      currentDailyPriorityRepos: ["old/repo"],
      proposedDailyPriorityRepos: ["new/repo"],
      proposedDailyPriorityScoreSample: [],
      dailyPriorityAdded: ["new/repo"],
      dailyPriorityRemoved: ["old/repo"],
      currentShortlistRepos: ["old/shortlist"],
      proposedShortlistRepos: ["new/shortlist"],
      shortlistAdded: ["new/shortlist"],
      shortlistRemoved: ["old/shortlist"],
    },
  }));

  assert.equal(firstDiffPath(left, right), null);
});

test("cutover skill star differences normalize away", () => {
  const left: ShadowSkillRecord[] = [
    {
      id: "owner/repo:one",
      name: "Skill",
      description: "Desc",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "SKILL.md",
      install_cmd: "install",
      author_handle: "owner",
      tags: [],
      stars: 10,
      last_updated: "2026-05-27T00:00:00Z",
      first_seen: "2026-05-27",
      skill_md_sha: "sha",
      publisher_handle: "owner",
      publisher_repo: "owner/repo",
      upstream_repo: null,
      provenance_type: "original",
      author_confidence: "high",
    },
  ];
  const right: ShadowSkillRecord[] = [{ ...left[0]!, stars: 25 }];

  assert.equal(firstDiffPath(selectComparableCutoverSkills(left), selectComparableCutoverSkills(right)), null);
});

test("cutover quality tier differences remain comparable", () => {
  const left: ShadowSkillRecord[] = [
    {
      id: "owner/repo:one",
      name: "Skill",
      description: "Desc",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "SKILL.md",
      install_cmd: "install",
      author_handle: "owner",
      tags: [],
      stars: 10,
      last_updated: "2026-05-27T00:00:00Z",
      first_seen: "2026-05-27",
      skill_md_sha: "sha",
      publisher_handle: "owner",
      publisher_repo: "owner/repo",
      upstream_repo: null,
      provenance_type: "original",
      author_confidence: "high",
      quality_tier: "curated",
    },
  ];
  const right: ShadowSkillRecord[] = [{ ...left[0]!, quality_tier: "creator" }];

  assert.equal(
    firstDiffPath(selectComparableCutoverSkills(left), selectComparableCutoverSkills(right)),
    "$[0].quality_tier",
  );
});

test("cutover skill last_updated differences normalize away", () => {
  const left: ShadowSkillRecord[] = [
    {
      id: "owner/repo:one",
      name: "Skill",
      description: "Desc",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "SKILL.md",
      install_cmd: "install",
      author_handle: "owner",
      tags: [],
      stars: 10,
      last_updated: "2026-05-27T00:00:00Z",
      first_seen: "2026-05-27",
      skill_md_sha: "sha",
      publisher_handle: "owner",
      publisher_repo: "owner/repo",
      upstream_repo: null,
      provenance_type: "original",
      author_confidence: "high",
    },
  ];
  const right: ShadowSkillRecord[] = [{ ...left[0]!, last_updated: "2026-05-28T00:00:00Z" }];

  assert.equal(firstDiffPath(selectComparableCutoverSkills(left), selectComparableCutoverSkills(right)), null);
});

test("optional cutover skill key shape differences normalize away", () => {
  const left: ShadowSkillRecord[] = [
    {
      id: "owner/repo:one",
      name: "Skill",
      description: "Desc",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "SKILL.md",
      install_cmd: "install",
      author_handle: "owner",
      tags: [],
      stars: 10,
      last_updated: "2026-05-27T00:00:00Z",
      first_seen: "2026-05-27",
      skill_md_sha: "sha",
      publisher_handle: "owner",
      publisher_repo: "owner/repo",
      upstream_repo: null,
      provenance_type: "original",
      author_confidence: "high",
    },
  ];
  const rightSkill = { ...left[0]! } as Partial<ShadowSkillRecord>;
  delete rightSkill.skill_md_path;
  delete rightSkill.skill_md_sha;
  delete rightSkill.upstream_repo;
  const right = [rightSkill as ShadowSkillRecord];
  const normalizedLeft = [{ ...selectComparableCutoverSkills(left)[0]!, skill_md_path: null, skill_md_sha: null }];

  assert.equal(firstDiffPath(normalizedLeft, selectComparableCutoverSkills(right)), null);
});

test("github url differences normalize away", () => {
  const left: ShadowSkillRecord[] = [
    {
      id: "owner/repo:one",
      name: "Skill",
      description: "Desc",
      github_url: "https://github.com/Owner/Repo",
      skill_md_path: "SKILL.md",
      install_cmd: "install",
      author_handle: "owner",
      tags: [],
      stars: 10,
      last_updated: "2026-05-27T00:00:00Z",
      first_seen: "2026-05-27",
      skill_md_sha: "sha",
      publisher_handle: "owner",
      publisher_repo: "owner/repo",
      upstream_repo: null,
      provenance_type: "original",
      author_confidence: "high",
    },
  ];
  const right: ShadowSkillRecord[] = [{ ...left[0]!, github_url: "https://github.com/other/repo" }];

  assert.equal(firstDiffPath(selectComparableCutoverSkills(left), selectComparableCutoverSkills(right)), null);
});

test("cutover skill install command differences normalize away", () => {
  const left: ShadowSkillRecord[] = [
    {
      id: "owner/repo:one",
      name: "Skill",
      description: "Desc",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "SKILL.md",
      install_cmd: "install old",
      author_handle: "owner",
      tags: [],
      stars: 10,
      last_updated: "2026-05-27T00:00:00Z",
      first_seen: "2026-05-27",
      skill_md_sha: "sha",
      publisher_handle: "owner",
      publisher_repo: "owner/repo",
      upstream_repo: null,
      provenance_type: "original",
      author_confidence: "high",
    },
  ];
  const right: ShadowSkillRecord[] = [{ ...left[0]!, install_cmd: "install new" }];

  assert.equal(firstDiffPath(selectComparableCutoverSkills(left), selectComparableCutoverSkills(right)), null);
});

test("changed skill ids still fail", () => {
  const diff = firstDiffPath([{ id: "owner/repo:one" }], [{ id: "owner/repo:two" }]);
  assert.equal(diff, "$[0].id");
});

test("changed counts still fail", () => {
  const left = selectComparableCutoverCompare(cutoverCompare());
  const right = selectComparableCutoverCompare(
    cutoverCompare({
      counts: {
        baselineSkillCount: 1,
        cutoverSkillCount: 2,
        countDelta: 1,
        addedSkillCount: 1,
        missingSkillCount: 0,
      },
    }),
  );

  assert.match(firstDiffPath(left, right) ?? "", /^\$\.counts\./);
});

test("changed validation state still fail", () => {
  const left = selectComparableShadowReport(shadowReport({ cutoverValidationPassed: true }));
  const right = selectComparableShadowReport(shadowReport({ cutoverValidationPassed: false }));

  assert.equal(firstDiffPath(left, right), "$.cutoverValidationPassed");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Skill } from "../types.js";
import { buildPromotedSkills, promoteCutover } from "./promote-cutover.js";
import type { ShadowRunReport, ShadowSkillRecord } from "./types.js";

function skill(id: string, overrides: Partial<ShadowSkillRecord> = {}): ShadowSkillRecord {
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url: "https://github.com/owner/repo",
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 100,
    last_updated: "2026-05-26T00:00:00Z",
    first_seen: "2026-05-26",
    skill_md_sha: "sha",
    publisher_handle: "owner",
    publisher_repo: "owner/repo",
    upstream_repo: null,
    provenance_type: "original",
    author_confidence: "high",
    ...overrides,
  };
}

function currentSkill(id: string): Skill {
  return {
    id,
    name: "Skill",
    description: "Desc",
    github_url: "https://github.com/owner/repo",
    skill_md_path: "SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 100,
    last_updated: "2026-05-26T00:00:00Z",
    first_seen: "2026-05-26",
    skill_md_sha: "sha",
  };
}

function shadowReport(cutoverValidationPassed: boolean): ShadowRunReport {
  return {
    checkedAt: "2026-05-26T00:00:00Z",
    status: "ok",
    cadence: "combined",
    baselineSkillCount: 0,
    shadowSkillCount: 0,
    inspectableShadowSkillCount: 0,
    excludedInspectableCatalogSkillCount: 0,
    carriedForwardCount: 0,
    correctedCount: 0,
    newlyDiscoveredCount: 0,
    staleInvalidCandidateCount: 0,
    repoCount: 0,
    repoCountsByState: { library: 0, rising: 0, core: 0 },
    trustedVendorRepoCount: 0,
    trustedCreatorRepoCount: 0,
    goldBasketRepoCount: 0,
    unresolvedBaselineSkillCount: 0,
    authorPublisherMismatchCount: 0,
    provenanceCounts: { original: 0, catalog: 0, repackaged: 0, mirrored: 0, unknown: 0 },
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
    priorityReasonCounts: { official: 0, trustedVendor: 0, goldBasket: 0, creatorWatch: 0, stars: 0 },
    dailyPriorityRepoSample: [],
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
    cutoverValidationPassed,
    cutoverValidationFailureCount: cutoverValidationPassed ? 0 : 1,
    cutoverValidationFailuresSample: [],
    stageTimings: {},
    productionWriteGuardPassed: true,
  };
}

function setupPromotionFixture(options: {
  cutoverSkills?: ShadowSkillRecord[];
  currentSkills?: Skill[];
  report?: ShadowRunReport;
}) {
  const root = mkdtempSync(join(tmpdir(), "promote-cutover-"));
  const indexRoot = join(root, "index");
  const shadowRoot = join(indexRoot, "shadow");
  mkdirSync(shadowRoot, { recursive: true });
  writeFileSync(join(indexRoot, "skills.json"), JSON.stringify(options.currentSkills ?? [currentSkill("owner/repo:existing")], null, 2) + "\n");
  if (options.cutoverSkills) {
    writeFileSync(join(shadowRoot, "skills.cutover.shadow.json"), JSON.stringify(options.cutoverSkills, null, 2) + "\n");
  }
  if (options.report) {
    writeFileSync(join(shadowRoot, "shadow-report.json"), JSON.stringify(options.report, null, 2) + "\n");
  }
  return { indexRoot, shadowRoot, skillsPath: join(indexRoot, "skills.json") };
}

test("unresolved catalog skill is filtered", () => {
  const { promotedSkills, summary } = buildPromotedSkills(
    [
      skill("owner/repo:kept-1"),
      skill("owner/repo:kept-2"),
      skill("owner/repo:kept-3"),
      skill("owner/repo:kept-4"),
      skill("catalog/repo:drop", { author_handle: "", provenance_type: "catalog" }),
    ],
    [currentSkill("owner/repo:existing-1"), currentSkill("owner/repo:existing-2")],
  );

  assert.deepEqual(promotedSkills.map((entry) => entry.id), [
    "owner/repo:kept-1",
    "owner/repo:kept-2",
    "owner/repo:kept-3",
    "owner/repo:kept-4",
  ]);
  assert.equal(summary.filteredCatalogCount, 1);
  assert.equal(summary.filteredRepackagedCount, 0);
});

test("unresolved repackaged skill is filtered", () => {
  const { promotedSkills, summary } = buildPromotedSkills(
    [
      skill("owner/repo:kept-1"),
      skill("owner/repo:kept-2"),
      skill("owner/repo:kept-3"),
      skill("owner/repo:kept-4"),
      skill("repackaged/repo:drop", { author_handle: "", provenance_type: "repackaged" }),
    ],
    [currentSkill("owner/repo:existing-1"), currentSkill("owner/repo:existing-2")],
  );

  assert.deepEqual(promotedSkills.map((entry) => entry.id), [
    "owner/repo:kept-1",
    "owner/repo:kept-2",
    "owner/repo:kept-3",
    "owner/repo:kept-4",
  ]);
  assert.equal(summary.filteredCatalogCount, 0);
  assert.equal(summary.filteredRepackagedCount, 1);
});

test("skill with real author_handle is retained", () => {
  const { promotedSkills, summary } = buildPromotedSkills(
    [skill("catalog/repo:kept", { author_handle: "creator", provenance_type: "catalog" })],
    [currentSkill("owner/repo:existing")],
  );

  assert.equal(promotedSkills.length, 1);
  assert.equal(summary.filteredTotal, 0);
});

test("misclassified marketplace rows are filtered once provenance is corrected", () => {
  const { promotedSkills, summary } = buildPromotedSkills(
    [
      skill("owner/repo:kept-1"),
      skill("owner/repo:kept-2"),
      skill("owner/repo:kept-3"),
      skill("owner/repo:kept-4"),
      skill("aiskillstore/marketplace:skills/sickn33/2d-games", {
        github_url: "https://github.com/aiskillstore/marketplace",
        author_handle: "",
        publisher_handle: "aiskillstore",
        publisher_repo: "aiskillstore/marketplace",
        provenance_type: "repackaged",
        author_confidence: "low",
      }),
    ],
    [currentSkill("owner/repo:existing-1"), currentSkill("owner/repo:existing-2")],
  );

  assert.equal(promotedSkills.some((entry) => entry.id.includes("aiskillstore/marketplace:skills/sickn33/2d-games")), false);
  assert.equal(summary.filteredCatalogCount, 0);
  assert.equal(summary.filteredRepackagedCount, 1);
});

test("duplicate promoted skill ids fail", () => {
  assert.throws(
    () =>
      buildPromotedSkills(
        [skill("owner/repo:dup"), skill("owner/repo:dup")],
        [currentSkill("owner/repo:existing"), currentSkill("owner/repo:existing-2")],
      ),
    /duplicate promoted skill id/,
  );
});

test("suspiciously small promoted output fails", () => {
  assert.throws(
    () =>
      buildPromotedSkills(
        [
          skill("owner/repo:kept"),
          skill("catalog/repo:drop-1", { author_handle: "", provenance_type: "catalog" }),
          skill("catalog/repo:drop-2", { author_handle: "", provenance_type: "catalog" }),
          skill("catalog/repo:drop-3", { author_handle: "", provenance_type: "catalog" }),
          skill("catalog/repo:drop-4", { author_handle: "", provenance_type: "catalog" }),
        ],
        [currentSkill("owner/repo:current-1"), currentSkill("owner/repo:current-2")],
      ),
    /below 80% of cutover count/,
  );
});

test("missing skills.cutover.shadow.json fails without writing production skills.json", () => {
  const fixture = setupPromotionFixture({ report: shadowReport(true) });
  const before = readFileSync(fixture.skillsPath, "utf8");

  assert.throws(
    () => promoteCutover({ indexRoot: fixture.indexRoot, shadowRoot: fixture.shadowRoot }),
    /missing cutover skills file/,
  );
  assert.equal(readFileSync(fixture.skillsPath, "utf8"), before);
});

test("missing shadow-report.json fails without writing production skills.json", () => {
  const fixture = setupPromotionFixture({ cutoverSkills: [skill("owner/repo:kept")] });
  const before = readFileSync(fixture.skillsPath, "utf8");

  assert.throws(
    () => promoteCutover({ indexRoot: fixture.indexRoot, shadowRoot: fixture.shadowRoot }),
    /missing shadow report file/,
  );
  assert.equal(readFileSync(fixture.skillsPath, "utf8"), before);
});

test("cutoverValidationPassed false fails without writing production skills.json", () => {
  const fixture = setupPromotionFixture({
    cutoverSkills: [skill("owner/repo:kept")],
    report: shadowReport(false),
  });
  const before = readFileSync(fixture.skillsPath, "utf8");

  assert.throws(
    () => promoteCutover({ indexRoot: fixture.indexRoot, shadowRoot: fixture.shadowRoot }),
    /cutover validation did not pass/,
  );
  assert.equal(readFileSync(fixture.skillsPath, "utf8"), before);
});

test("successful promotion writes only skills.json", () => {
  const fixture = setupPromotionFixture({
    currentSkills: [currentSkill("owner/repo:existing"), currentSkill("owner/repo:existing-2")],
    cutoverSkills: [
      skill("owner/repo:kept-1"),
      skill("owner/repo:kept-2"),
      skill("owner/repo:kept-3"),
      skill("owner/repo:kept-4"),
      skill("catalog/repo:drop", { author_handle: "", provenance_type: "catalog" }),
    ],
    report: shadowReport(true),
  });

  const summary = promoteCutover({ indexRoot: fixture.indexRoot, shadowRoot: fixture.shadowRoot });
  const written = JSON.parse(readFileSync(fixture.skillsPath, "utf8")) as Skill[];

  assert.equal(summary.cutoverSkillCount, 5);
  assert.equal(summary.promotedSkillCount, 4);
  assert.equal(summary.filteredTotal, 1);
  assert.deepEqual(written.map((entry) => entry.id), [
    "owner/repo:kept-1",
    "owner/repo:kept-2",
    "owner/repo:kept-3",
    "owner/repo:kept-4",
  ]);
});

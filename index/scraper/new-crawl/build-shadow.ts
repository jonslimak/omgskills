import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Skill } from "../types.js";
import type { Candidate, EnrichResult } from "../enrich.js";
import { enrichCandidate, getCandidateRepoMeta, resolveCandidateSkillPath } from "../enrich.js";
import { searchByTopics } from "../sources/topics.js";
import { searchBySkillMdFilename } from "../sources/code.js";
import { searchAggregators } from "../sources/aggregators.js";
import { searchSocial } from "../sources/social.js";
import { searchRegistry } from "../sources/registry.js";
import { searchSkillsSh } from "../sources/skillssh.js";
import { searchAwesomeAgentSkills } from "../sources/awesome.js";
import { searchOfficialSkills } from "../sources/official.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";
import { loadTrustedSeeds } from "./seeds.js";
import { resolveShadowProvenance } from "./provenance.js";
import { bootstrapRisingRepos, repairDeadPersistedRisingSkillLinks, selectBetterBootstrapCandidate, toEnrichCandidate } from "./bootstrap.js";
import { buildCutoverCompare, buildCutoverCompareSummary } from "./cutover-compare.js";
import { validateCutoverOutputs } from "./cutover-validation.js";
import {
  applyShadowRepoOverlay,
  buildShadowRepoOverlay,
  loadShadowRepoOverlay,
  shouldReadShadowRepoOverlay,
  shouldWriteShadowRepoOverlay,
} from "./repo-overlay.js";
import {
  applyShortlistPromotions,
  buildDailyPriorityRepos,
  buildNextPromotionCandidates,
  buildNextPromotionShortlist,
  DAILY_PRIORITY_REPO_LIMIT,
  NEXT_PROMOTION_SHORTLIST_LIMIT,
} from "./daily-priority.js";
import type {
  CutoverValidationFailure,
  DailyPriorityRepoSample,
  DiscoveryBudgetSummary,
  DiscoveryLane,
  PriorityReason,
  PriorityReasonCounts,
  PromotedRepoSample,
  RepoBootstrapCandidate,
  ShadowCadence,
  ProvenanceType,
  RepoOverride,
  RepoState,
  BootstrapRepoSample,
  ShadowEnrichmentCounts,
  ShadowRepoIndex,
  ShadowRepoOverlay,
  ShadowAuthorDiffExample,
  ShadowCutoverSkillSignal,
  ShadowCutoverCompare,
  RebootstrapEligibleRepoSample,
  ShadowRepoIndexEntry,
  ShadowSkillRecord,
  ShadowRunReport,
  ShadowSkillSignals,
  ShadowStaleInvalidCandidate,
  SourceRunSummary,
  StageTimings,
  TopRepoSummary,
} from "./types.js";

type DiscoverySourceName =
  | "official"
  | "skillssh"
  | "awesome"
  | "registry"
  | "topics"
  | "code"
  | "social"
  | "aggregators"
  | "trusted-vendors"
  | "trusted-creators"
  | "monitored-repos";

type DiscoveredRepoRecord = {
  repo: string;
  repoUrl: string;
  sources: Set<DiscoverySourceName>;
  lanes: Set<DiscoveryLane>;
  stars: number;
  bootstrapCandidate?: RepoBootstrapCandidate;
};

const CADENCE_LANES: Record<ShadowCadence, DiscoveryLane[]> = {
  fast: ["fast"],
  periodic: ["periodic"],
  background: ["background"],
  combined: ["fast", "periodic", "background"],
};

const EXTERNAL_SOURCES_BY_LANE: Record<DiscoveryLane, DiscoverySourceName[]> = {
  fast: ["official"],
  periodic: ["skillssh", "awesome", "registry"],
  background: ["topics", "code", "social", "aggregators"],
};

const BACKGROUND_DISCOVERY_BUDGET: DiscoveryBudgetSummary = {
  topics: {
    maxQueries: 4,
    maxPagesPerQuery: 2,
  },
  code: {
    includeBroadQuery: false,
    maxFingerprintQueries: 3,
    maxPagesPerQuery: 2,
  },
  social: {
    maxPagesPerQuery: 1,
  },
  aggregators: {
    maxRepos: 10,
  },
};

const LOW_STAR_FLOOR = 5;

function parseCadence(argv: string[]): ShadowCadence {
  const raw = argv.find((arg) => arg.startsWith("--cadence="));
  if (!raw) return "combined";
  const value = raw.split("=", 2)[1]?.trim().toLowerCase();
  if (value === "fast" || value === "periodic" || value === "background" || value === "combined") {
    return value;
  }
  throw new Error(`Unknown cadence "${value}". Expected fast, periodic, background, or combined.`);
}

function writeShadowFile(path: string, content: string) {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function loadSkills(path: string): Skill[] {
  return JSON.parse(readFileSync(path, "utf8")) as Skill[];
}

function cloneRepoIndex(repoIndex: ShadowRepoIndex): ShadowRepoIndex {
  return JSON.parse(JSON.stringify(repoIndex)) as ShadowRepoIndex;
}

function repoKeyFromGithubUrl(githubUrl: string): { repo: string; repoUrl: string } | null {
  try {
    const url = new URL(githubUrl);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return {
      repo: `${owner}/${repo}`.toLowerCase(),
      repoUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

function repoKeyFor(skill: Skill): { repo: string; repoUrl: string } | null {
  return repoKeyFromGithubUrl(skill.github_url);
}

function ownerHandle(repo: string): string {
  return repo.split("/")[0] ?? "";
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function applyOverrideState(entry: ShadowRepoIndexEntry, override: RepoOverride) {
  if (!override.state) return;
  entry.state = override.state;
  entry.promotionReasons = ["override"];
}

function buildSkillSignals(checkedAt: string): ShadowSkillSignals {
  return {
    generatedAt: checkedAt,
    signals: {},
  };
}

function buildCutoverShadowSkills(skills: ShadowSkillRecord[]): ShadowSkillRecord[] {
  return skills;
}

export function buildCutoverSkillSignals(
  skills: ShadowSkillRecord[],
  repoIndex: ShadowRepoIndex,
): ShadowCutoverSkillSignal[] {
  const repoStateByRepo = new Map(repoIndex.repos.map((repo) => [repo.repo, repo.state] as const));

  return skills.map((skill) => {
    const repo = repoKeyFor(skill)?.repo;
    const state = repo ? repoStateByRepo.get(repo) : undefined;
    return {
      id: skill.id,
      ...(state === "rising" ? { isRising: true } : {}),
      ...(state === "core" ? { isCore: true } : {}),
    };
  });
}

export function reconcileRepoIndexSkillIds(
  repoIndex: ShadowRepoIndex,
  skills: ShadowSkillRecord[],
) {
  const skillsByRepo = new Map<string, ShadowSkillRecord[]>();

  for (const skill of skills) {
    const repo = repoKeyFor(skill)?.repo;
    if (!repo) continue;
    const existing = skillsByRepo.get(repo);
    if (existing) {
      existing.push(skill);
    } else {
      skillsByRepo.set(repo, [skill]);
    }
  }

  for (const repo of repoIndex.repos) {
    const repoSkills = (skillsByRepo.get(repo.repo) ?? []).slice().sort(
      (a, b) => b.stars - a.stars || a.id.localeCompare(b.id),
    );
    repo.skillIds = sortUnique(repoSkills.map((skill) => skill.id));
    repo.skillCount = repo.skillIds.length;

    if (repoSkills.length === 0) {
      repo.topSkillId = null;
      repo.topSkillStars = 0;
      continue;
    }

    const topSkill = repoSkills[0]!;
    repo.topSkillId = topSkill.id;
    repo.topSkillStars = topSkill.stars;
    repo.stars = Math.max(repo.stars, topSkill.stars);
    repo.repoUrl = repoKeyFor(topSkill)?.repoUrl ?? repo.repoUrl;
  }
}

function toShadowSkillRecord(skill: Skill): ShadowSkillRecord {
  const seeds = loadTrustedSeeds();
  const provenance = resolveShadowProvenance(skill, seeds);
  return {
    ...skill,
    author_handle: provenance.authorHandle,
    publisher_handle: provenance.publisherHandle,
    publisher_repo: provenance.publisherRepo,
    upstream_repo: provenance.upstreamRepo,
    provenance_type: provenance.provenanceType,
    author_confidence: provenance.authorConfidence,
  };
}

function buildShadowSkills(skills: Skill[]): ShadowSkillRecord[] {
  return skills.map(toShadowSkillRecord);
}

function buildRepoCountsByState(repos: ShadowRepoIndexEntry[]): Record<RepoState, number> {
  return repos.reduce<Record<RepoState, number>>(
    (acc, repo) => {
      acc[repo.state] += 1;
      return acc;
    },
    { library: 0, rising: 0, core: 0 },
  );
}

function buildUnresolvedCatalogPublishers(skills: ShadowSkillRecord[]): { publisherRepo: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    if (skill.author_handle) continue;
    if (skill.provenance_type !== "catalog" && skill.provenance_type !== "repackaged") continue;
    if (!skill.publisher_repo) continue;
    counts.set(skill.publisher_repo, (counts.get(skill.publisher_repo) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([publisherRepo, count]) => ({ publisherRepo, count }));
}

function shouldExcludeFromInspectableShadowLibrary(skill: ShadowSkillRecord): boolean {
  return !skill.author_handle && (skill.provenance_type === "catalog" || skill.provenance_type === "repackaged");
}

function buildInspectableShadowSkills(skills: ShadowSkillRecord[]): ShadowSkillRecord[] {
  return skills.filter((skill) => !shouldExcludeFromInspectableShadowLibrary(skill));
}

function topReposByState(repos: ShadowRepoIndexEntry[], state: RepoState, limit = 10): TopRepoSummary[] {
  return repos
    .filter((repo) => repo.state === state)
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo))
    .slice(0, limit)
    .map((repo) => ({
      repo: repo.repo,
      stars: repo.stars,
      topSkillId: repo.topSkillId,
    }));
}

function countRepos(repos: ShadowRepoIndexEntry[], predicate: (repo: ShadowRepoIndexEntry) => boolean): number {
  return repos.filter(predicate).length;
}

function buildProvenanceCounts(skills: ShadowSkillRecord[]): Record<ProvenanceType, number> {
  return skills.reduce<Record<ProvenanceType, number>>(
    (acc, skill) => {
      acc[skill.provenance_type] += 1;
      return acc;
    },
    { original: 0, catalog: 0, repackaged: 0, mirrored: 0, unknown: 0 },
  );
}

function buildAuthorDiffExamples(skills: Skill[], shadowSkills: ShadowSkillRecord[], limit = 20): ShadowAuthorDiffExample[] {
  const examples: ShadowAuthorDiffExample[] = [];
  for (let i = 0; i < skills.length; i += 1) {
    const current = skills[i];
    const shadow = shadowSkills[i];
    if ((current.author_handle ?? "") === shadow.author_handle) continue;
    examples.push({
      id: shadow.id,
      currentAuthorHandle: current.author_handle ?? "",
      shadowAuthorHandle: shadow.author_handle,
      publisherHandle: shadow.publisher_handle,
      publisherRepo: shadow.publisher_repo,
      upstreamRepo: shadow.upstream_repo,
      provenanceType: shadow.provenance_type,
      authorConfidence: shadow.author_confidence,
    });
    if (examples.length >= limit) break;
  }
  return examples;
}

function buildCatalogRepoExamples(currentSkills: Skill[], shadowSkills: ShadowSkillRecord[], limit = 20): ShadowAuthorDiffExample[] {
  const currentById = new Map(currentSkills.map((skill) => [skill.id, skill]));
  return shadowSkills
    .filter((skill) => skill.provenance_type === "catalog")
    .slice(0, limit)
    .map((skill) => ({
      id: skill.id,
      currentAuthorHandle: currentById.get(skill.id)?.author_handle ?? "",
      shadowAuthorHandle: skill.author_handle,
      publisherHandle: skill.publisher_handle,
      publisherRepo: skill.publisher_repo,
      upstreamRepo: skill.upstream_repo,
      provenanceType: skill.provenance_type,
      authorConfidence: skill.author_confidence,
    }));
}

function buildRepoIndex(
  skills: Skill[],
  goldBasketSkills: Skill[],
  checkedAt: string,
): { repoIndex: ShadowRepoIndex; unresolvedBaselineSkillCount: number } {
  const seeds = loadTrustedSeeds();
  const goldBasketRepos = new Set(
    goldBasketSkills
      .map(repoKeyFor)
      .filter((repoInfo): repoInfo is { repo: string; repoUrl: string } => Boolean(repoInfo))
      .map((repoInfo) => repoInfo.repo),
  );

  const byRepo = new Map<string, ShadowRepoIndexEntry>();
  let unresolvedBaselineSkillCount = 0;

  for (const skill of skills) {
    const repoInfo = repoKeyFor(skill);
    if (!repoInfo) {
      unresolvedBaselineSkillCount += 1;
      continue;
    }

    const existing = byRepo.get(repoInfo.repo);
    if (existing) {
      existing.skillIds.push(skill.id);
      existing.skillCount += 1;
      existing.stars = Math.max(existing.stars, skill.stars);
      if (skill.stars > existing.topSkillStars) {
        existing.topSkillStars = skill.stars;
        existing.topSkillId = skill.id;
      }
      continue;
    }

    const trustedVendor = seeds.trustedVendorHandles.has(ownerHandle(repoInfo.repo));
    const trustedCreator = seeds.trustedCreatorHandles.has(ownerHandle(repoInfo.repo));
    const goldBasketRepo = goldBasketRepos.has(repoInfo.repo);

    byRepo.set(repoInfo.repo, {
      repo: repoInfo.repo,
      repoUrl: repoInfo.repoUrl,
      state: "library",
      discoveredSources: ["baseline"],
      skillIds: [skill.id],
      skillCount: 1,
      stars: skill.stars,
      lastSeenAt: checkedAt,
      lastRefreshedAt: checkedAt,
      trustSignals: sortUnique([
        trustedVendor ? "trusted-vendor" : "",
        trustedCreator ? "trusted-creator" : "",
        goldBasketRepo ? "gold-basket" : "",
      ].filter(Boolean)),
      promotionReasons: [],
      staleOrInvalidState: null,
      isTrustedVendor: trustedVendor,
      isTrustedCreator: trustedCreator,
      isGoldBasketRepo: goldBasketRepo,
      topSkillId: skill.id,
      topSkillStars: skill.stars,
    });
  }

  for (const entry of byRepo.values()) {
    entry.skillIds = sortUnique(entry.skillIds);
    entry.skillCount = entry.skillIds.length;

    if (entry.isGoldBasketRepo) {
      entry.state = "core";
      entry.promotionReasons = sortUnique([...entry.promotionReasons, "gold-basket"]);
    } else if (entry.stars >= 100) {
      entry.state = "core";
      entry.promotionReasons = sortUnique([...entry.promotionReasons, "stars>=100"]);
    } else if (entry.stars >= 30) {
      entry.state = "rising";
      entry.promotionReasons = sortUnique([...entry.promotionReasons, "stars>=30"]);
    }

    if (entry.state !== "core" && entry.isTrustedVendor) {
      entry.state = "rising";
      entry.promotionReasons = sortUnique([...entry.promotionReasons, "trusted-vendor"]);
    }

    if (entry.state !== "core" && entry.isTrustedCreator) {
      entry.state = "rising";
      entry.promotionReasons = sortUnique([...entry.promotionReasons, "trusted-creator"]);
    }
  }

  for (const override of seeds.repoOverrides) {
    const entry = byRepo.get(override.repo);
    if (!entry) continue;
    applyOverrideState(entry, override);
  }

  const repos = [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));

  return {
    repoIndex: {
      generatedAt: checkedAt,
      repoCount: repos.length,
      repos,
    },
    unresolvedBaselineSkillCount,
  };
}

function buildReport(report: Omit<ShadowRunReport, "stageTimings">, stageTimings: StageTimings): ShadowRunReport {
  return {
    ...report,
    stageTimings,
  };
}

function buildSummary(report: ShadowRunReport, repoIndex: ShadowRepoIndex) {
  const corePreview = report.topCoreRepos.slice(0, 5).map((repo) => `- ${repo.repo} (${repo.stars})`);
  const risingPreview = report.topRisingRepos.slice(0, 5).map((repo) => `- ${repo.repo} (${repo.stars})`);
  const diffPreview = report.authorDiffExamples.slice(0, 5).map((row) =>
    `- ${row.id} | current=@${row.currentAuthorHandle || "?"} -> shadow=@${row.shadowAuthorHandle || "?"} | publisher=@${row.publisherHandle || "?"} | ${row.provenanceType}`,
  );

  return [
    "# Shadow Crawl Summary",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Cadence: ${report.cadence}`,
    `- Baseline skills: ${report.baselineSkillCount}`,
    `- Shadow skills: ${report.shadowSkillCount}`,
    `- Inspectable shadow skills: ${report.inspectableShadowSkillCount}`,
    `- Excluded inspectable catalog skills: ${report.excludedInspectableCatalogSkillCount}`,
    `- Carried forward: ${report.carriedForwardCount}`,
    `- Corrected: ${report.correctedCount}`,
    `- Newly discovered: ${report.newlyDiscoveredCount}`,
    `- Stale/invalid candidates: ${report.staleInvalidCandidateCount}`,
    `- Repo index entries: ${repoIndex.repoCount}`,
    `- Repo states: library=${report.repoCountsByState.library}, rising=${report.repoCountsByState.rising}, core=${report.repoCountsByState.core}`,
    `- Trusted vendor repos: ${report.trustedVendorRepoCount}`,
    `- Trusted creator repos: ${report.trustedCreatorRepoCount}`,
    `- Gold basket repos: ${report.goldBasketRepoCount}`,
    `- Unresolved baseline skills: ${report.unresolvedBaselineSkillCount}`,
    `- Author/publisher mismatches: ${report.authorPublisherMismatchCount}`,
    `- Unknown-author skills: ${report.unknownAuthorSkillCount}`,
    `- Catalog repo skills: ${report.catalogRepoSkillCount}`,
    `- Unresolved catalog skills: ${report.unresolvedCatalogSkillCount}`,
    `- Discovered repos: ${report.discoveredRepoCount}`,
    `- Discovery lane counts: fast=${report.discoveredRepoCountByLane.fast}, periodic=${report.discoveredRepoCountByLane.periodic}, background=${report.discoveredRepoCountByLane.background}`,
    `- Discovery matched baseline repos: ${report.baselineRepoCountMatchedByDiscovery}`,
    `- New discovery repos: ${report.newDiscoveryRepoCount}`,
    `- Bootstrap value repos: ${report.bootstrapValueRepoCount}`,
    `- Fast-only repos: ${report.fastOnlyRepoCount}`,
    `- Discovery budget applied: ${report.discoveryBudgetApplied ? "yes" : "no"}`,
    `- Low-star valid skills: ${report.lowStarValidSkillCount}`,
    `- Trusted low-star skills: ${report.trustedLowStarSkillCount}`,
    `- Official low-star skills: ${report.officialLowStarSkillCount}`,
    `- Production write guard: ${report.productionWriteGuardPassed ? "passed" : "failed"}`,
    "",
    "## Unresolved catalog publishers",
    ...(report.unresolvedCatalogPublishers.length
      ? report.unresolvedCatalogPublishers.map((row) => `- ${row.publisherRepo}: ${row.count}`)
      : ["- none"]),
    "",
    "## Source runs",
    "",
    ...(report.sourceRuns.length
      ? report.sourceRuns.map((run) => `- ${run.source} [${run.lane}] ${run.hitCount} hits ${run.durationMs}ms`)
      : ["- none"]),
    "",
    "## Discovery budget",
    "",
    ...(report.discoveryBudgetSummary
      ? [
          `- topics: maxQueries=${report.discoveryBudgetSummary.topics.maxQueries}, maxPagesPerQuery=${report.discoveryBudgetSummary.topics.maxPagesPerQuery}`,
          `- code: includeBroadQuery=${report.discoveryBudgetSummary.code.includeBroadQuery}, maxFingerprintQueries=${report.discoveryBudgetSummary.code.maxFingerprintQueries}, maxPagesPerQuery=${report.discoveryBudgetSummary.code.maxPagesPerQuery}`,
          `- social: maxPagesPerQuery=${report.discoveryBudgetSummary.social.maxPagesPerQuery}`,
          `- aggregators: maxRepos=${report.discoveryBudgetSummary.aggregators.maxRepos}`,
        ]
      : ["- none"]),
    "",
    "## Partial discovery warnings",
    "",
    ...(report.partialDiscoveryWarnings.length
      ? report.partialDiscoveryWarnings.map((warning) => `- ${warning}`)
      : ["- none"]),
    "",
    "## Enrichment",
    "",
    `- Daily priority rule: official (12), gold basket (10), trusted vendor (8), stars fill to ${DAILY_PRIORITY_REPO_LIMIT}`,
    `- Library repos checked: ${report.enrichmentCounts.libraryReposChecked}`,
    `- Daily priority repos: ${report.enrichmentCounts.dailyPriorityRepoCount}`,
    `- Daily priority reasons: ${formatPriorityReasonCounts(report.priorityReasonCounts)}`,
    `- Next promotion candidates: ${report.nextPromotionCandidateCount}`,
    `- Next promotion shortlist: ${report.nextPromotionShortlistCount}`,
    `- Promoted repos: ${report.promotedRepoCount}`,
    `- Promoted to rising: ${report.promotedToRisingCount}`,
    `- New discovered repos promoted: ${report.newDiscoveredRepoPromotedCount}`,
    `- Bootstrapped repos: ${report.bootstrappedRepoCount}`,
    `- Bootstrap failures: ${report.bootstrapFailedRepoCount}`,
    `- Bootstrap skipped: ${report.bootstrapSkippedRepoCount}`,
    `- Shadow repo overlay loaded: ${report.shadowRepoOverlayLoaded ? "yes" : "no"}`,
    `- Shadow repo overlay entries: ${report.shadowRepoOverlayEntryCount}`,
    `- Shadow repo overlay written: ${report.shadowRepoOverlayWrittenCount}`,
    `- Skills deep-refreshed: ${report.enrichmentCounts.skillsDeepRefreshed}`,
    `- Carried forward: ${report.enrichmentCounts.carriedForwardCount}`,
    `- Corrected: ${report.enrichmentCounts.correctedCount}`,
    `- Stale/invalid candidates: ${report.enrichmentCounts.staleInvalidCandidateCount}`,
    `- Skipped monitored repos: ${report.skippedMonitoredRepoCount}`,
    "",
    "## Enrichment warnings",
    "",
    ...(report.enrichmentWarnings.length
      ? report.enrichmentWarnings.map((warning) => `- ${warning}`)
      : ["- none"]),
    "",
    "## Top provisional core repos",
    "",
    ...(corePreview.length ? corePreview : ["- none"]),
    "",
    "## Top provisional rising repos",
    "",
    ...(risingPreview.length ? risingPreview : ["- none"]),
    "",
    "## Sample author diffs",
    "",
    ...(diffPreview.length ? diffPreview : ["- none"]),
    "",
    "## Discovery samples",
    "",
    `- New discovery repos: ${report.newDiscoveryReposSample.join(", ") || "none"}`,
    `- Periodic-only repos: ${report.periodicOnlyReposSample.join(", ") || "none"}`,
    `- Background-only repos: ${report.backgroundOnlyReposSample.join(", ") || "none"}`,
    `- Bootstrap value repos: ${report.bootstrapValueReposSample.join(", ") || "none"}`,
    `- Fast-only repos: ${report.fastOnlyReposSample.join(", ") || "none"}`,
    `- Next promotion candidates: ${report.nextPromotionCandidatesSample.map((row) => `${row.repo} (${row.reason}, ${row.stars})`).join(", ") || "none"}`,
    `- Next promotion shortlist: ${report.nextPromotionShortlistSample.map((row) => `${row.repo} (${row.reason}, ${row.stars})`).join(", ") || "none"}`,
    `- Promoted repos: ${report.promotedRepoSample.map((row) => `${row.repo} (${row.promotionKind}, ${row.priorState}->${row.newState}, ${row.reason}, ${row.stars})`).join(", ") || "none"}`,
    `- Bootstrapped repos: ${report.bootstrappedRepoSample.map((row) => `${row.repo} (${row.source}, ${row.candidateId})`).join(", ") || "none"}`,
    `- Bootstrap failures: ${report.bootstrapFailedRepoSample.map((row) => `${row.repo} (${row.source}, ${row.failureReason ?? "failed"})`).join(", ") || "none"}`,
    `- Bootstrap skipped: ${report.bootstrapSkippedRepoSample.map((row) => `${row.repo} (${row.source}, ${row.failureReason ?? "skipped"})`).join(", ") || "none"}`,
    `- Low-star valid skills: ${report.lowStarValidSkillSample.join(", ") || "none"}`,
    `- Stale/invalid candidates: ${report.staleInvalidCandidatesSample.map((row) => `${row.id} (${row.reason})`).join(", ") || "none"}`,
    `- Daily priority repos: ${report.dailyPriorityRepoSample.map((row) => `${row.repo} (${row.reason})`).join(", ") || "none"}`,
    "",
    "## Stage timings (ms)",
    "",
    ...Object.entries(report.stageTimings).map(([stage, ms]) => `- ${stage}: ${ms}`),
    "",
  ].join("\n");
}

function addDiscoveredRepo(
  discovered: Map<string, DiscoveredRepoRecord>,
  repoInfo: { repo: string; repoUrl: string } | null,
  source: DiscoverySourceName,
  lane: DiscoveryLane,
  stars = 0,
) {
  if (!repoInfo) return;
  const existing = discovered.get(repoInfo.repo);
  if (existing) {
    existing.sources.add(source);
    existing.lanes.add(lane);
    existing.stars = Math.max(existing.stars, stars);
    return;
  }
  discovered.set(repoInfo.repo, {
    repo: repoInfo.repo,
    repoUrl: repoInfo.repoUrl,
    sources: new Set([source]),
    lanes: new Set([lane]),
    stars,
  });
}

function maybeSetBootstrapCandidate(
  discovered: Map<string, DiscoveredRepoRecord>,
  repoInfo: { repo: string; repoUrl: string } | null,
  candidate: RepoBootstrapCandidate,
) {
  if (!repoInfo) return;
  const existing = discovered.get(repoInfo.repo);
  if (!existing) return;
  existing.bootstrapCandidate = selectBetterBootstrapCandidate(existing.bootstrapCandidate, candidate);
}

function observedStars(hit: unknown): number {
  if (typeof hit !== "object" || hit === null) return 0;
  const value = (hit as { stars?: unknown }).stars;
  return typeof value === "number" ? value : 0;
}

function buildPromotionCandidateMeta(repo: string, repoUrl?: string): Candidate {
  return {
    id: repo,
    skill_md_path: "SKILL.md",
    github_url: repoUrl,
  };
}

function buildTrustSignalsForRepo(
  repo: string,
  goldBasketRepos: Set<string>,
): Pick<ShadowRepoIndexEntry, "isTrustedVendor" | "isTrustedCreator" | "isGoldBasketRepo" | "trustSignals"> {
  const seeds = loadTrustedSeeds();
  const trustedVendor = seeds.trustedVendorHandles.has(ownerHandle(repo));
  const trustedCreator = seeds.trustedCreatorHandles.has(ownerHandle(repo));
  const goldBasketRepo = goldBasketRepos.has(repo);
  return {
    isTrustedVendor: trustedVendor,
    isTrustedCreator: trustedCreator,
    isGoldBasketRepo: goldBasketRepo,
    trustSignals: sortUnique([
      trustedVendor ? "trusted-vendor" : "",
      trustedCreator ? "trusted-creator" : "",
      goldBasketRepo ? "gold-basket" : "",
    ].filter(Boolean)),
  };
}

function formatDiscoveryWarning(source: DiscoverySourceName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit/i.test(message)) {
    return `${source} rate-limited; returned 0 hits under background budget`;
  }
  return `${source} failed under background budget`;
}

function buildCandidateFromSkill(skill: Skill): Candidate {
  return {
    id: skill.id,
    skill_md_path: skill.skill_md_path ?? "SKILL.md",
    skill_name_hint: skill.name,
  };
}

function toStaleReason(result: EnrichResult): ShadowStaleInvalidCandidate["reason"] {
  const reason = result.failure?.reason ?? "";
  if (reason === "repo-404") return "repoMissing";
  if (reason === "skill-file-404" || reason === "skill-path-unresolved") return "skillFileMissing";
  return "validationFailed";
}

function isMeaningfullyCorrected(previous: Skill, next: Skill): boolean {
  return (
    previous.name !== next.name ||
    previous.description !== next.description ||
    previous.github_url !== next.github_url ||
    (previous.skill_md_path ?? "") !== (next.skill_md_path ?? "") ||
    JSON.stringify(sortUnique(previous.tags)) !== JSON.stringify(sortUnique(next.tags))
  );
}

type ShadowRefreshResult = {
  shadowSkills: ShadowSkillRecord[];
  enrichmentCounts: ShadowEnrichmentCounts;
  newlyDiscoveredCount: number;
  lowStarValidSkillCount: number;
  lowStarValidSkillSample: string[];
  trustedLowStarSkillCount: number;
  officialLowStarSkillCount: number;
  staleInvalidCandidatesSample: ShadowStaleInvalidCandidate[];
  priorityReasonCounts: PriorityReasonCounts;
  dailyPriorityRepoSample: DailyPriorityRepoSample[];
  skippedMonitoredRepoCount: number;
  bootstrappedRepoSample: BootstrapRepoSample[];
  bootstrapFailedRepoSample: BootstrapRepoSample[];
  bootstrapSkippedRepoSample: BootstrapRepoSample[];
  rebootstrapEligibleRepoSample: RebootstrapEligibleRepoSample[];
  enrichmentWarnings: string[];
};

function emptyPriorityReasonCounts(): PriorityReasonCounts {
  return {
    official: 0,
    goldBasket: 0,
    trustedVendor: 0,
    stars: 0,
  };
}

function formatPriorityReasonCounts(counts: PriorityReasonCounts): string {
  return `official=${counts.official}, goldBasket=${counts.goldBasket}, trustedVendor=${counts.trustedVendor}, stars=${counts.stars}`;
}

async function runShadowRefresh(
  cadence: ShadowCadence,
  baselineSkills: Skill[],
  shadowSkills: ShadowSkillRecord[],
  repoIndex: ShadowRepoIndex,
  discovered: Map<string, DiscoveredRepoRecord>,
  checkedAt: string,
  repoAliasByCanonical: Map<string, string>,
): Promise<ShadowRefreshResult> {
  const baselineById = new Map(baselineSkills.map((skill) => [skill.id, skill]));
  const shadowById = new Map(shadowSkills.map((skill) => [skill.id, skill]));
  const existingFirstSeen = new Map(baselineSkills.map((skill) => [skill.id, skill.first_seen]));
  const existingSkills = new Map(baselineSkills.map((skill) => [skill.id, skill]));
  const repoByName = new Map(repoIndex.repos.map((repo) => [repo.repo, repo]));
  const officialRepos = new Set(
    [...discovered.values()]
      .filter((repo) => repo.sources.has("official"))
      .map((repo) => repo.repo),
  );
  const enrichmentWarnings: string[] = [];
  const staleInvalidCandidates: ShadowStaleInvalidCandidate[] = [];
  const missingPersistedSkillRefreshSample: string[] = [];
  const priorityReasonCounts = emptyPriorityReasonCounts();
  let libraryReposChecked = 0;
  let skillsDeepRefreshed = 0;
  let correctedCount = 0;
  const availableSkillIds = new Set([
    ...baselineSkills.map((skill) => skill.id),
    ...shadowSkills.map((skill) => skill.id),
  ]);
  const {
    repairedRepoSample: rebootstrapEligibleRepoSample,
    preservedFirstSeen,
  } = repairDeadPersistedRisingSkillLinks(repoIndex, availableSkillIds);
  for (const [skillId, firstSeen] of preservedFirstSeen) {
    if (!existingFirstSeen.has(skillId)) {
      existingFirstSeen.set(skillId, firstSeen);
    }
  }
  const bootstrapCandidateByRepo = new Map(
    [...discovered.values()]
      .filter((repo) => repo.bootstrapCandidate)
      .map((repo) => [repo.repo, repo.bootstrapCandidate!] as const),
  );
  const bootstrapResult = await bootstrapRisingRepos({
    cadence,
    checkedAt,
    repoIndex,
    bootstrapCandidateByRepo,
    repoAliasByCanonical,
    existingFirstSeen,
    existingSkills,
    resolveCandidatePathFn: async (candidate) => resolveCandidateSkillPath(toEnrichCandidate(candidate)),
    enrichCandidateFn: enrichCandidate,
  });
  for (const skill of bootstrapResult.bootstrappedSkills) {
    shadowById.set(skill.id, toShadowSkillRecord(skill));
  }

  const libraryReposToCheck = repoIndex.repos
    .filter((repo) => repo.state === "library" && discovered.has(repo.repo))
    .sort((a, b) => a.repo.localeCompare(b.repo));

  for (const repo of libraryReposToCheck) {
    const skillId = repo.topSkillId ?? repo.skillIds[0];
    if (!skillId) continue;
    const baselineSkill = baselineById.get(skillId) ?? shadowById.get(skillId);
    if (!baselineSkill) {
      if (missingPersistedSkillRefreshSample.length < 10) {
        missingPersistedSkillRefreshSample.push(`${repo.repo}:${skillId}`);
      }
      continue;
    }
    libraryReposChecked += 1;
    try {
      const meta = await getCandidateRepoMeta(buildCandidateFromSkill(baselineSkill), checkedAt.slice(0, 10));
      if (meta) {
        repo.stars = meta.stars;
        repo.repoUrl = meta.githubUrl;
        repo.lastRefreshedAt = checkedAt;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        staleInvalidCandidates.push({
          id: skillId,
          repo: repo.repo,
          reason: "repoMissing",
        });
      } else {
        enrichmentWarnings.push(`library refresh failed for ${repo.repo}`);
      }
    }
  }

  const hasFastLane = CADENCE_LANES[cadence].includes("fast");
  const { repos: dailyPriorityRepos, reasonByRepo, skippedMonitoredRepoCount } = buildDailyPriorityRepos(repoIndex, discovered);

  if (!hasFastLane) {
    enrichmentWarnings.push("monitored refresh skipped because cadence excludes fast lane");
  } else if (skippedMonitoredRepoCount > 0) {
    enrichmentWarnings.push(`daily priority refresh capped at ${dailyPriorityRepos.length} repos`);
  }

  const reposToRefresh = hasFastLane ? dailyPriorityRepos : [];
  const today = checkedAt.slice(0, 10);

  for (const repo of reposToRefresh) {
    const skillId = repo.topSkillId ?? repo.skillIds[0];
    if (!skillId) continue;
    const baselineSkill = baselineById.get(skillId) ?? shadowById.get(skillId);
    if (!baselineSkill) {
      if (missingPersistedSkillRefreshSample.length < 10) {
        missingPersistedSkillRefreshSample.push(`${repo.repo}:${skillId}`);
      }
      continue;
    }

    const result = await enrichCandidate(
      buildCandidateFromSkill(baselineSkill),
      existingFirstSeen,
      existingSkills,
      today,
    );
    repo.lastRefreshedAt = checkedAt;
    const priorityReason = reasonByRepo.get(repo.repo);
    if (priorityReason) {
      priorityReasonCounts[priorityReason] += 1;
    }

    if (result.skill) {
      skillsDeepRefreshed += 1;
      repo.stars = result.skill.stars;
      repo.repoUrl = result.skill.github_url;
      if (isMeaningfullyCorrected(baselineSkill, result.skill)) {
        correctedCount += 1;
        shadowById.set(skillId, toShadowSkillRecord(result.skill));
      }
      continue;
    }

    staleInvalidCandidates.push({
      id: skillId,
      repo: repo.repo,
      reason: toStaleReason(result),
    });
  }

  const baselineShadowSkills = baselineSkills.map((skill) => shadowById.get(skill.id) ?? toShadowSkillRecord(skill));
  const bootstrappedShadowSkills = bootstrapResult.bootstrappedSkills.map((skill) => toShadowSkillRecord(skill));
  const refreshedShadowSkills = [...baselineShadowSkills, ...bootstrappedShadowSkills];
  const lowStarValidSkills = refreshedShadowSkills
    .filter((skill) => skill.stars < LOW_STAR_FLOOR)
    .sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id));

  const trustedLowStarSkillCount = lowStarValidSkills.filter((skill) => {
    const repo = repoKeyFor(skill);
    const entry = repo ? repoByName.get(repo.repo) : null;
    return Boolean(entry?.isTrustedVendor || entry?.isTrustedCreator);
  }).length;

  const officialLowStarSkillCount = lowStarValidSkills.filter((skill) => {
    const repo = repoKeyFor(skill);
    return Boolean(repo && officialRepos.has(repo.repo));
  }).length;

  const staleInvalidUnique = [...new Map(staleInvalidCandidates.map((row) => [`${row.id}:${row.reason}`, row])).values()];
  const carriedForwardCount = baselineSkills.length - correctedCount;
  if (missingPersistedSkillRefreshSample.length > 0) {
    enrichmentWarnings.push(
      `skipped persisted monitored skills missing from current shadow skill set: ${missingPersistedSkillRefreshSample.join(", ")}`,
    );
  }

  return {
    shadowSkills: refreshedShadowSkills,
    enrichmentCounts: {
      libraryReposChecked,
      dailyPriorityRepoCount: hasFastLane ? dailyPriorityRepos.length : 0,
      skillsDeepRefreshed,
      carriedForwardCount,
      correctedCount,
      staleInvalidCandidateCount: staleInvalidUnique.length,
    },
    newlyDiscoveredCount: bootstrapResult.bootstrappedSkills.length,
    lowStarValidSkillCount: lowStarValidSkills.length,
    lowStarValidSkillSample: lowStarValidSkills.slice(0, 10).map((skill) => `${skill.id} (${skill.stars})`),
    trustedLowStarSkillCount,
    officialLowStarSkillCount,
    staleInvalidCandidatesSample: staleInvalidUnique.slice(0, 10),
    priorityReasonCounts,
    dailyPriorityRepoSample: dailyPriorityRepos.slice(0, 10).map((repo) => ({
      repo: repo.repo,
      reason: reasonByRepo.get(repo.repo) ?? "stars",
    })),
    skippedMonitoredRepoCount,
    bootstrappedRepoSample: bootstrapResult.bootstrappedRepoSample,
    bootstrapFailedRepoSample: bootstrapResult.bootstrapFailedRepoSample,
    bootstrapSkippedRepoSample: bootstrapResult.bootstrapSkippedRepoSample,
    rebootstrapEligibleRepoSample,
    enrichmentWarnings,
  };
}

async function timeSource<T>(
  source: DiscoverySourceName,
  lane: DiscoveryLane,
  run: () => Promise<T[]>,
  options: { allowFailure?: boolean } = {},
): Promise<{ hits: T[]; summary: SourceRunSummary; warning: string | null }> {
  const startedAt = performance.now();
  try {
    const hits = await run();
    return {
      hits,
      summary: {
        source,
        lane,
        hitCount: hits.length,
        durationMs: Math.round(performance.now() - startedAt),
      },
      warning: null,
    };
  } catch (error) {
    if (!options.allowFailure) throw error;
    return {
      hits: [],
      summary: {
        source,
        lane,
        hitCount: 0,
        durationMs: Math.round(performance.now() - startedAt),
      },
      warning: formatDiscoveryWarning(source, error),
    };
  }
}

async function runDiscovery(
  cadence: ShadowCadence,
  repoIndex: ShadowRepoIndex,
): Promise<{
  sourceRuns: SourceRunSummary[];
  discovered: Map<string, DiscoveredRepoRecord>;
  discoveryBudgetApplied: boolean;
  discoveryBudgetSummary: DiscoveryBudgetSummary | null;
  partialDiscoveryWarnings: string[];
}> {
  const lanes = CADENCE_LANES[cadence];
  const sourceRuns: SourceRunSummary[] = [];
  const discovered = new Map<string, DiscoveredRepoRecord>();
  const seeds = loadTrustedSeeds();
  const discoveryBudgetApplied = cadence === "background" || cadence === "combined";
  const discoveryBudgetSummary = discoveryBudgetApplied ? BACKGROUND_DISCOVERY_BUDGET : null;
  const partialDiscoveryWarnings: string[] = [];

  for (const lane of lanes) {
    if (lane === "fast") {
      const officialRun = await timeSource("official", "fast", searchOfficialSkills);
      sourceRuns.push(officialRun.summary);
      for (const hit of officialRun.hits) {
        const repoInfo = repoKeyFromGithubUrl(hit.github_url);
        addDiscoveredRepo(discovered, repoInfo, "official", "fast", observedStars(hit));
        maybeSetBootstrapCandidate(discovered, repoInfo, {
          source: "official",
          id: hit.id,
          skill_md_path: hit.path,
          skill_name_hint: hit.skill_name_hint,
          github_url: hit.github_url,
        });
      }

      const trustedVendorRepos = repoIndex.repos.filter((repo) => repo.isTrustedVendor);
      sourceRuns.push({
        source: "trusted-vendors",
        lane: "fast",
        hitCount: trustedVendorRepos.length,
        durationMs: 0,
      });
      for (const repo of trustedVendorRepos) {
        addDiscoveredRepo(discovered, { repo: repo.repo, repoUrl: repo.repoUrl }, "trusted-vendors", "fast", repo.stars);
      }

      const trustedCreatorRepos = repoIndex.repos.filter(
        (repo) => repo.isTrustedCreator || seeds.trustedCreatorHandles.has(ownerHandle(repo.repo)),
      );
      sourceRuns.push({
        source: "trusted-creators",
        lane: "fast",
        hitCount: trustedCreatorRepos.length,
        durationMs: 0,
      });
      for (const repo of trustedCreatorRepos) {
        addDiscoveredRepo(discovered, { repo: repo.repo, repoUrl: repo.repoUrl }, "trusted-creators", "fast", repo.stars);
      }

      const monitoredRepos = repoIndex.repos.filter((repo) => repo.state === "rising" || repo.state === "core");
      sourceRuns.push({
        source: "monitored-repos",
        lane: "fast",
        hitCount: monitoredRepos.length,
        durationMs: 0,
      });
      for (const repo of monitoredRepos) {
        addDiscoveredRepo(discovered, { repo: repo.repo, repoUrl: repo.repoUrl }, "monitored-repos", "fast", repo.stars);
      }
      continue;
    }

    if (lane === "periodic") {
      const [skillsshRun, awesomeRun, registryRun] = await Promise.all([
        timeSource("skillssh", "periodic", () =>
          searchSkillsSh({
            board: "all-time",
            topLimit: 500,
            minRepoStars: 50,
            pageConcurrency: 1,
            repoConcurrency: 8,
          }),
        ),
        timeSource("awesome", "periodic", searchAwesomeAgentSkills),
        timeSource("registry", "periodic", searchRegistry),
      ]);
      for (const result of [skillsshRun, awesomeRun, registryRun] as const) {
        sourceRuns.push(result.summary);
        for (const hit of result.hits) {
          const repoInfo = repoKeyFromGithubUrl(hit.github_url);
          addDiscoveredRepo(
            discovered,
            repoInfo,
            result.summary.source as DiscoverySourceName,
            "periodic",
            observedStars(hit),
          );
          maybeSetBootstrapCandidate(discovered, repoInfo, {
            source: result.summary.source as "skillssh" | "awesome" | "registry",
            id: hit.id,
            skill_md_path: hit.path,
            skill_name_hint: "skill_name_hint" in hit ? hit.skill_name_hint : undefined,
            ref: "ref" in hit ? hit.ref : undefined,
            github_url: hit.github_url,
            stars: "stars" in hit ? hit.stars : undefined,
            last_updated: "last_updated" in hit ? hit.last_updated : undefined,
            tags: "tags" in hit ? hit.tags : undefined,
          });
        }
      }
      continue;
    }

    const [topicsRun, codeRun, socialRun, aggregatorsRun] = await Promise.all([
      timeSource("topics", "background", () =>
        searchByTopics(
          discoveryBudgetSummary
            ? {
                maxQueries: discoveryBudgetSummary.topics.maxQueries,
                maxPagesPerQuery: discoveryBudgetSummary.topics.maxPagesPerQuery,
              }
            : {},
        ),
      { allowFailure: true }),
      timeSource("code", "background", () =>
        searchBySkillMdFilename(
          discoveryBudgetSummary
            ? {
                includeBroadQuery: discoveryBudgetSummary.code.includeBroadQuery,
                maxFingerprintQueries: discoveryBudgetSummary.code.maxFingerprintQueries,
                maxPagesPerQuery: discoveryBudgetSummary.code.maxPagesPerQuery,
              }
            : {},
        ),
      { allowFailure: true }),
      timeSource("social", "background", () =>
        searchSocial(
          discoveryBudgetSummary
            ? { maxPagesPerQuery: discoveryBudgetSummary.social.maxPagesPerQuery }
            : {},
        ),
      { allowFailure: true }),
      timeSource("aggregators", "background", () =>
        searchAggregators(
          discoveryBudgetSummary
            ? { maxRepos: discoveryBudgetSummary.aggregators.maxRepos }
            : {},
        ),
      { allowFailure: true }),
    ]);
    if (discoveryBudgetSummary) {
      partialDiscoveryWarnings.push("code broad search skipped by budget");
      partialDiscoveryWarnings.push(
        `code fingerprint queries capped at ${discoveryBudgetSummary.code.maxFingerprintQueries}`,
      );
      partialDiscoveryWarnings.push(
        `code pages capped at ${discoveryBudgetSummary.code.maxPagesPerQuery}`,
      );
      partialDiscoveryWarnings.push(
        `topics queries capped at ${discoveryBudgetSummary.topics.maxQueries}`,
      );
      partialDiscoveryWarnings.push(
        `topics pages capped at ${discoveryBudgetSummary.topics.maxPagesPerQuery}`,
      );
      partialDiscoveryWarnings.push(
        `social pages capped at ${discoveryBudgetSummary.social.maxPagesPerQuery}`,
      );
      partialDiscoveryWarnings.push(
        `aggregators capped at ${discoveryBudgetSummary.aggregators.maxRepos} repos`,
      );
    }
    for (const result of [topicsRun, codeRun, socialRun, aggregatorsRun] as const) {
      sourceRuns.push(result.summary);
      if (result.warning) partialDiscoveryWarnings.push(result.warning);
      if (discoveryBudgetSummary && result.summary.durationMs >= 30000) {
        partialDiscoveryWarnings.push(`${result.summary.source} slow under budget (${result.summary.durationMs}ms)`);
      }
      for (const hit of result.hits) {
        const repoInfo = repoKeyFromGithubUrl(hit.github_url);
        addDiscoveredRepo(
          discovered,
          repoInfo,
          result.summary.source as DiscoverySourceName,
          "background",
          observedStars(hit),
        );
        if (result.summary.source === "code") {
          const codeHit = hit as { id: string; path: string; github_url: string };
          maybeSetBootstrapCandidate(discovered, repoInfo, {
            source: "code",
            id: codeHit.id,
            skill_md_path: codeHit.path,
            github_url: codeHit.github_url,
          });
        }
      }
    }
  }

  return {
    sourceRuns,
    discovered,
    discoveryBudgetApplied,
    discoveryBudgetSummary,
    partialDiscoveryWarnings,
  };
}

function countDiscoveredByLane(discovered: Map<string, DiscoveredRepoRecord>): Record<DiscoveryLane, number> {
  const counts: Record<DiscoveryLane, number> = { fast: 0, periodic: 0, background: 0 };
  for (const repo of discovered.values()) {
    for (const lane of repo.lanes) counts[lane] += 1;
  }
  return counts;
}

function countDiscoveredBySource(discovered: Map<string, DiscoveredRepoRecord>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const repo of discovered.values()) {
    for (const source of repo.sources) counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function sampleRepos(
  discovered: Map<string, DiscoveredRepoRecord>,
  predicate: (repo: DiscoveredRepoRecord) => boolean,
  limit = 10,
): string[] {
  return [...discovered.values()]
    .filter(predicate)
    .map((repo) => repo.repo)
    .sort()
    .slice(0, limit);
}

async function main() {
  const timings: StageTimings = {};
  const checkedAt = new Date().toISOString();
  const cadence = parseCadence(process.argv.slice(2));

  const baselinePath = join(indexRoot, "skills.json");
  const goldBasketPath = join(indexRoot, "gold-basket.json");
  const skillsOutPath = join(shadowRoot, "skills.shadow.json");
  const inspectableSkillsOutPath = join(shadowRoot, "skills.inspectable.shadow.json");
  const cutoverSkillsOutPath = join(shadowRoot, "skills.cutover.shadow.json");
  const repoIndexOutPath = join(shadowRoot, "repo-index.shadow.json");
  const repoOverlayOutPath = join(shadowRoot, "repo-index.overlay.json");
  const skillSignalsOutPath = join(shadowRoot, "skill-signals.shadow.json");
  const cutoverSkillSignalsOutPath = join(shadowRoot, "skill-signals.cutover.shadow.json");
  const cutoverCompareOutPath = join(shadowRoot, "cutover-compare.shadow.json");
  const cutoverCompareSummaryOutPath = join(shadowRoot, "cutover-compare.shadow.md");
  const reportOutPath = join(shadowRoot, "shadow-report.json");
  const summaryOutPath = join(shadowRoot, "shadow-summary.md");

  const baselineStart = performance.now();
  const baselineSkills = loadSkills(baselinePath);
  const goldBasketSkills = loadSkills(goldBasketPath);
  const goldBasketRepos = new Set(
    goldBasketSkills
      .map(repoKeyFor)
      .filter((repoInfo): repoInfo is { repo: string; repoUrl: string } => Boolean(repoInfo))
      .map((repoInfo) => repoInfo.repo),
  );
  timings.loadBaseline = Math.round(performance.now() - baselineStart);

  const provenanceStart = performance.now();
  let shadowSkills = buildShadowSkills(baselineSkills);
  timings.buildProvenance = Math.round(performance.now() - provenanceStart);

  const repoIndexStart = performance.now();
  const { repoIndex, unresolvedBaselineSkillCount } = buildRepoIndex(baselineSkills, goldBasketSkills, checkedAt);
  const baselineRepoIndexForOverlay = cloneRepoIndex(repoIndex);
  timings.buildRepoIndex = Math.round(performance.now() - repoIndexStart);

  const repoOverlay = shouldReadShadowRepoOverlay(cadence) ? loadShadowRepoOverlay(repoOverlayOutPath) : null;
  const { overlayLoaded: shadowRepoOverlayLoaded, overlayEntryCount: shadowRepoOverlayEntryCount } = applyShadowRepoOverlay(
    cadence,
    repoIndex,
    repoOverlay,
  );

  const discoveryStart = performance.now();
  const repoAliasByCanonical = new Map<string, string>();
  const { sourceRuns, discovered, discoveryBudgetApplied, discoveryBudgetSummary, partialDiscoveryWarnings } =
    await runDiscovery(cadence, repoIndex);
  timings.runDiscovery = Math.round(performance.now() - discoveryStart);

  const dailyPrioritySelection = buildDailyPriorityRepos(repoIndex, discovered);
  const nextPromotionCandidates = buildNextPromotionCandidates(repoIndex, discovered, dailyPrioritySelection.repos);
  const nextPromotionShortlist = buildNextPromotionShortlist(nextPromotionCandidates);
  const promotedRepoSample = await applyShortlistPromotions({
    checkedAt,
    cadence,
    repoIndex,
    shortlist: nextPromotionShortlist,
    getMissingRepoMeta: async (repo) => {
      const discoveredRepo = discovered.get(repo);
      const meta = await getCandidateRepoMeta(
        buildPromotionCandidateMeta(repo, discoveredRepo?.repoUrl),
        checkedAt.slice(0, 10),
      );
      const canonicalRepoInfo = meta ? repoKeyFromGithubUrl(meta.githubUrl) : null;
      if (canonicalRepoInfo?.repo && canonicalRepoInfo.repo !== repo) {
        repoAliasByCanonical.set(canonicalRepoInfo.repo, repo);
      }
      return meta
        ? {
            canonicalRepo: canonicalRepoInfo?.repo ?? repo.toLowerCase(),
            stars: meta.stars,
            repoUrl: meta.githubUrl,
          }
        : null;
    },
    getMissingRepoContext: (repo) => {
      const discoveredRepo = discovered.get(repo);
      const trust = buildTrustSignalsForRepo(repo, goldBasketRepos);
      return {
        checkedAt,
        discoveredSources: sortUnique([...(discoveredRepo?.sources ?? [])]),
        isTrustedVendor: trust.isTrustedVendor,
        isTrustedCreator: trust.isTrustedCreator,
        isGoldBasketRepo: trust.isGoldBasketRepo,
      };
    },
  });

  const refreshStart = performance.now();
  const refreshResult = await runShadowRefresh(cadence, baselineSkills, shadowSkills, repoIndex, discovered, checkedAt, repoAliasByCanonical);
  shadowSkills = refreshResult.shadowSkills;
  timings.runRefresh = Math.round(performance.now() - refreshStart);
  reconcileRepoIndexSkillIds(repoIndex, shadowSkills);
  const inspectableShadowSkills = buildInspectableShadowSkills(shadowSkills);
  const cutoverShadowSkills = buildCutoverShadowSkills(shadowSkills);

  const shadowRepoOverlay: ShadowRepoOverlay | null = shouldWriteShadowRepoOverlay(cadence)
    ? buildShadowRepoOverlay(repoIndex, baselineRepoIndexForOverlay, checkedAt)
    : null;
  const shadowRepoOverlayWrittenCount = shadowRepoOverlay?.repoCount ?? 0;

  const skillSignalsStart = performance.now();
  const skillSignals = buildSkillSignals(checkedAt);
  const cutoverSkillSignals = buildCutoverSkillSignals(cutoverShadowSkills, repoIndex);
  timings.buildSkillSignals = Math.round(performance.now() - skillSignalsStart);
  const cutoverValidationFailures = validateCutoverOutputs(cutoverShadowSkills, cutoverSkillSignals, repoIndex);
  const cutoverValidationFailuresSample: CutoverValidationFailure[] = cutoverValidationFailures.slice(0, 20);
  const cutoverCompare: ShadowCutoverCompare = buildCutoverCompare(
    checkedAt,
    baselineSkills,
    cutoverShadowSkills,
    cutoverSkillSignals,
    {
      cutoverValidationPassed: cutoverValidationFailures.length === 0,
      cutoverValidationFailureCount: cutoverValidationFailures.length,
    },
  );

  const baselineRepos = new Set(repoIndex.repos.map((repo) => repo.repo));
  const discoveredRepoCountByLane = countDiscoveredByLane(discovered);
  const discoveredRepoCountBySource = countDiscoveredBySource(discovered);
  const baselineRepoCountMatchedByDiscovery = [...discovered.keys()].filter((repo) => baselineRepos.has(repo)).length;
  const newDiscoveryRepos = [...discovered.keys()].filter((repo) => !baselineRepos.has(repo)).sort();
  const periodicOnlyReposSample = sampleRepos(
    discovered,
    (repo) => repo.lanes.has("periodic") && !repo.lanes.has("fast") && !repo.lanes.has("background"),
  );
  const backgroundOnlyReposSample = sampleRepos(
    discovered,
    (repo) => repo.lanes.has("background") && !repo.lanes.has("fast") && !repo.lanes.has("periodic"),
  );
  const bootstrapValueReposSample = sampleRepos(
    discovered,
    (repo) =>
      !baselineRepos.has(repo.repo) &&
      (repo.sources.has("awesome") || repo.sources.has("registry")),
  );
  const fastOnlyReposSample = sampleRepos(
    discovered,
    (repo) => repo.lanes.has("fast") && !repo.lanes.has("periodic") && !repo.lanes.has("background"),
  );

  const reportBase: Omit<ShadowRunReport, "stageTimings"> = {
    checkedAt,
    status: "ok",
    cadence,
    baselineSkillCount: baselineSkills.length,
    shadowSkillCount: shadowSkills.length,
    inspectableShadowSkillCount: inspectableShadowSkills.length,
    excludedInspectableCatalogSkillCount: shadowSkills.length - inspectableShadowSkills.length,
    carriedForwardCount: refreshResult.enrichmentCounts.carriedForwardCount,
    correctedCount: refreshResult.enrichmentCounts.correctedCount,
    newlyDiscoveredCount: refreshResult.newlyDiscoveredCount,
    staleInvalidCandidateCount: refreshResult.enrichmentCounts.staleInvalidCandidateCount,
    repoCount: repoIndex.repoCount,
    repoCountsByState: buildRepoCountsByState(repoIndex.repos),
    trustedVendorRepoCount: countRepos(repoIndex.repos, (repo) => repo.isTrustedVendor),
    trustedCreatorRepoCount: countRepos(repoIndex.repos, (repo) => repo.isTrustedCreator),
    goldBasketRepoCount: countRepos(repoIndex.repos, (repo) => repo.isGoldBasketRepo),
    unresolvedBaselineSkillCount,
    authorPublisherMismatchCount: shadowSkills.filter((skill) => Boolean(skill.author_handle) && skill.author_handle !== skill.publisher_handle).length,
    provenanceCounts: buildProvenanceCounts(shadowSkills),
    unknownAuthorSkillCount: shadowSkills.filter((skill) => !skill.author_handle).length,
    catalogRepoSkillCount: shadowSkills.filter((skill) => skill.provenance_type === "catalog").length,
    unresolvedCatalogSkillCount: shadowSkills.filter((skill) => !skill.author_handle && (skill.provenance_type === "catalog" || skill.provenance_type === "repackaged")).length,
    unresolvedCatalogPublishers: buildUnresolvedCatalogPublishers(shadowSkills),
    authorDiffExamples: buildAuthorDiffExamples(baselineSkills, shadowSkills),
    catalogRepoExamples: buildCatalogRepoExamples(baselineSkills, shadowSkills),
    topCoreRepos: topReposByState(repoIndex.repos, "core"),
    topRisingRepos: topReposByState(repoIndex.repos, "rising"),
    sourceRuns,
    discoveryBudgetApplied,
    discoveryBudgetSummary,
    partialDiscoveryWarnings,
    enrichmentCounts: refreshResult.enrichmentCounts,
    lowStarValidSkillCount: refreshResult.lowStarValidSkillCount,
    lowStarValidSkillSample: refreshResult.lowStarValidSkillSample,
    trustedLowStarSkillCount: refreshResult.trustedLowStarSkillCount,
    officialLowStarSkillCount: refreshResult.officialLowStarSkillCount,
    staleInvalidCandidatesSample: refreshResult.staleInvalidCandidatesSample,
    priorityReasonCounts: refreshResult.priorityReasonCounts,
    dailyPriorityRepoSample: refreshResult.dailyPriorityRepoSample,
    skippedMonitoredRepoCount: refreshResult.skippedMonitoredRepoCount,
    enrichmentWarnings: refreshResult.enrichmentWarnings,
    discoveredRepoCount: discovered.size,
    discoveredRepoCountByLane,
    discoveredRepoCountBySource,
    baselineRepoCountMatchedByDiscovery,
    newDiscoveryRepoCount: newDiscoveryRepos.length,
    newDiscoveryReposSample: newDiscoveryRepos.slice(0, 10),
    periodicOnlyReposSample,
    backgroundOnlyReposSample,
    bootstrapValueRepoCount: [...discovered.values()].filter(
      (repo) => !baselineRepos.has(repo.repo) && (repo.sources.has("awesome") || repo.sources.has("registry")),
    ).length,
    bootstrapValueReposSample,
    fastOnlyRepoCount: [...discovered.values()].filter(
      (repo) => repo.lanes.has("fast") && !repo.lanes.has("periodic") && !repo.lanes.has("background"),
    ).length,
    fastOnlyReposSample,
    nextPromotionCandidateCount: nextPromotionCandidates.length,
    nextPromotionCandidatesSample: nextPromotionCandidates.slice(0, 10),
    nextPromotionShortlistCount: nextPromotionShortlist.length,
    nextPromotionShortlistSample: nextPromotionShortlist.slice(0, NEXT_PROMOTION_SHORTLIST_LIMIT),
    promotedRepoCount: promotedRepoSample.length,
    promotedToRisingCount: promotedRepoSample.filter((row) => row.newState === "rising").length,
    newDiscoveredRepoPromotedCount: promotedRepoSample.filter((row) => row.promotionKind === "new-discovery").length,
    promotedRepoSample: promotedRepoSample.slice(0, 10),
    bootstrappedRepoCount: refreshResult.bootstrappedRepoSample.length,
    bootstrappedRepoSample: refreshResult.bootstrappedRepoSample.slice(0, 10),
    bootstrapFailedRepoCount: refreshResult.bootstrapFailedRepoSample.length,
    bootstrapFailedRepoSample: refreshResult.bootstrapFailedRepoSample.slice(0, 10),
    bootstrapSkippedRepoCount: refreshResult.bootstrapSkippedRepoSample.length,
    bootstrapSkippedRepoSample: refreshResult.bootstrapSkippedRepoSample.slice(0, 10),
    rebootstrapEligibleRepoCount: refreshResult.rebootstrapEligibleRepoSample.length,
    rebootstrapEligibleRepoSample: refreshResult.rebootstrapEligibleRepoSample.slice(0, 10),
    shadowRepoOverlayLoaded,
    shadowRepoOverlayEntryCount,
    shadowRepoOverlayWrittenCount,
    cutoverValidationPassed: cutoverValidationFailures.length === 0,
    cutoverValidationFailureCount: cutoverValidationFailures.length,
    cutoverValidationFailuresSample,
    productionWriteGuardPassed: true,
  };

  const initialReport = buildReport(reportBase, timings);

  const writeStart = performance.now();
  writeShadowFile(skillsOutPath, JSON.stringify(shadowSkills, null, 2) + "\n");
  writeShadowFile(inspectableSkillsOutPath, JSON.stringify(inspectableShadowSkills, null, 2) + "\n");
  writeShadowFile(cutoverSkillsOutPath, JSON.stringify(cutoverShadowSkills, null, 2) + "\n");
  writeShadowFile(repoIndexOutPath, JSON.stringify(repoIndex, null, 2) + "\n");
  if (shadowRepoOverlay) {
    writeShadowFile(repoOverlayOutPath, JSON.stringify(shadowRepoOverlay, null, 2) + "\n");
  }
  writeShadowFile(skillSignalsOutPath, JSON.stringify(skillSignals, null, 2) + "\n");
  writeShadowFile(cutoverSkillSignalsOutPath, JSON.stringify(cutoverSkillSignals, null, 2) + "\n");
  writeShadowFile(cutoverCompareOutPath, JSON.stringify(cutoverCompare, null, 2) + "\n");
  writeShadowFile(cutoverCompareSummaryOutPath, buildCutoverCompareSummary(cutoverCompare));
  writeShadowFile(reportOutPath, JSON.stringify(initialReport, null, 2) + "\n");
  writeShadowFile(summaryOutPath, buildSummary(initialReport, repoIndex));
  timings.writeOutputs = Math.round(performance.now() - writeStart);

  const finalReport = buildReport(reportBase, timings);
  writeShadowFile(reportOutPath, JSON.stringify(finalReport, null, 2) + "\n");
  writeShadowFile(summaryOutPath, buildSummary(finalReport, repoIndex));

  console.log(`shadow crawl complete: ${baselineSkills.length} skills, ${repoIndex.repoCount} repos (${cadence})`);
}

main().catch((error) => {
  console.error(`shadow crawl failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

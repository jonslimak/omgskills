import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import type { EnrichResult } from "../enrich.js";
import { enrichCandidate, getCandidateRepoMeta, resolveCandidateSkillPath } from "../enrich.js";
import { searchByTopics } from "../sources/topics.js";
import { isHighStarBackfillPathAllowed, searchBySkillMdFilename, searchHighStarSkillMdRepos } from "../sources/code.js";
import { searchAggregators } from "../sources/aggregators.js";
import { searchSocial } from "../sources/social.js";
import { searchRegistry } from "../sources/registry.js";
import { searchSkillsSh } from "../sources/skillssh.js";
import { searchAwesomeAgentSkills } from "../sources/awesome.js";
import { searchOfficialSkills } from "../sources/official.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";
import { createAdmittedLibraryRepoEntry, isDiscoveredRepoAdmissionEligible } from "./admission.js";
import { loadTrustedSeeds } from "./seeds.js";
import { shouldRunWeeklyHighStarSkillMdDiscovery } from "./high-star-schedule.js";
import { resolveShadowProvenance } from "./provenance.js";
import { buildMomentumSignals } from "./momentum.js";
import { buildCandidateFromSkill } from "./candidate-path.js";
import { bootstrapRisingRepos, removeFailedNewlyAdmittedRepos, repairDeadPersistedRisingSkillLinks, selectBetterBootstrapCandidate, toEnrichCandidate } from "./bootstrap.js";
import { assertGitHubQuotaAvailable } from "./github-quota-guard.js";
import { buildCutoverCompare, buildCutoverCompareSummary } from "./cutover-compare.js";
import { validateCutoverOutputs } from "./cutover-validation.js";
import { buildCrawl4Preview } from "./crawl4-preview.js";
import { buildCatalogAdmissionSample } from "./catalog-admission.js";
import { isUnresolvedCatalogLikeSkill } from "./catalog-policy.js";
import {
  applyShadowSkillOverlay,
  buildShadowSkillOverlay,
  loadShadowSkillOverlay,
  shouldReadShadowSkillOverlay,
  shouldWriteShadowSkillOverlay,
} from "./skill-overlay.js";
import { buildCheapTriggeredRefreshSelection, buildWeeklyCheapCheckRepos, markRepoMissingCheapCheck, mergePriorShadowRepoTimestamps, repoMetaLooksChanged } from "./rolling-refresh.js";
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
  CatalogAdmissionSample,
  ShadowEnrichmentCounts,
  ShadowRepoIndex,
  ShadowRepoOverlay,
  ShadowSkillOverlay,
  ShadowAuthorDiffExample,
  ShadowCutoverSkillSignal,
  ShadowCutoverCompare,
  RebootstrapEligibleRepoSample,
  ShadowRepoIndexEntry,
  ShadowSkillRecord,
  ShadowRunReport,
  ShadowSkillSignals,
  SkillFileMissingSample,
  ShadowStaleInvalidCandidate,
  ShadowStaleReasonCounts,
  SourceRunSummary,
  StageTimings,
  TopRepoSummary,
  TrustedSeeds,
} from "./types.js";

type DiscoverySourceName =
  | "official"
  | "skillssh"
  | "awesome"
  | "registry"
  | "topics"
  | "code"
  | "high-star-skillmd"
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
  background: ["topics", "code", "high-star-skillmd", "social", "aggregators"],
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
  highStarSkillMd: {
    minStars: 500,
    maxSampledRepos: 50,
    maxPagesPerQuery: 1,
    requestDelayMs: 500,
  },
  social: {
    maxPagesPerQuery: 1,
  },
  aggregators: {
    maxRepos: 10,
  },
};

export const HIGH_STAR_BACKFILL_ONLY_MAX_SAMPLED_REPOS = 250;
export const HIGH_STAR_BACKFILL_ONLY_MAX_PAGES_PER_QUERY = 5;
export const HIGH_STAR_BACKFILL_ONLY_MAX_NEW_ADMISSIONS = 50;

const LOW_STAR_FLOOR = 5;

type HighStarQueryBatch = "core" | "claude" | "agents" | "skills" | "size-1000-2000";

const HIGH_STAR_QUERY_BATCHES: Record<HighStarQueryBatch, string[]> = {
  core: ["filename:SKILL.md"],
  claude: ["filename:SKILL.md path:.claude/skills"],
  agents: ["filename:SKILL.md path:.agents/skills"],
  skills: ["filename:SKILL.md path:skills"],
  "size-1000-2000": ["filename:SKILL.md size:1000..2000"],
};

function parseCadence(argv: string[]): ShadowCadence {
  const raw = argv.find((arg) => arg.startsWith("--cadence="));
  if (!raw) return "combined";
  const value = raw.split("=", 2)[1]?.trim().toLowerCase();
  if (value === "fast" || value === "periodic" || value === "background" || value === "combined") {
    return value;
  }
  throw new Error(`Unknown cadence "${value}". Expected fast, periodic, background, or combined.`);
}

function parseForceHighStarSkillMd(argv: string[]): boolean {
  return argv.includes("--force-high-star-skillmd");
}

export function parseOnlyHighStarBackfill(argv: string[], cadence: ShadowCadence): boolean {
  const enabled = argv.includes("--only-high-star-backfill");
  if (enabled && cadence !== "combined") {
    throw new Error("--only-high-star-backfill requires --cadence=combined");
  }
  return enabled;
}

export function parseHighStarQueryBatch(argv: string[], onlyHighStarBackfill: boolean): HighStarQueryBatch | null {
  const raw = argv.find((arg) => arg.startsWith("--high-star-query-batch="));
  if (!raw) return null;
  if (!onlyHighStarBackfill) {
    throw new Error("--high-star-query-batch requires --only-high-star-backfill");
  }
  const value = raw.split("=", 2)[1]?.trim().toLowerCase();
  if (value === "core" || value === "claude" || value === "agents" || value === "skills" || value === "size-1000-2000") {
    return value;
  }
  throw new Error(`Unknown high-star query batch "${value}". Expected core, claude, agents, skills, or size-1000-2000.`);
}

function writeShadowFile(path: string, content: string) {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function loadSkills(path: string): Skill[] {
  return JSON.parse(readFileSync(path, "utf8")) as Skill[];
}

function loadShadowRepoIndex(path: string): ShadowRepoIndex | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ShadowRepoIndex;
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

function codeCandidateId(repo: string, path: string): string {
  if (path === "SKILL.md") return repo;
  const parts = path.split("/");
  const skillName = parts[parts.length - 2] ?? "skill";
  return `${repo}:${skillName}`;
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

export function buildCutoverShadowSkills(skills: ShadowSkillRecord[]): ShadowSkillRecord[] {
  return skills.filter((skill) => !isUnresolvedCatalogLikeSkill(skill));
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

export function removeFilteredCatalogOnlyRepos(
  repoIndex: ShadowRepoIndex,
  allSkills: ShadowSkillRecord[],
  maintainedSkills: ShadowSkillRecord[],
) {
  const maintainedSkillIds = new Set(maintainedSkills.map((skill) => skill.id));
  const filteredSkillIdsByRepo = new Map<string, Set<string>>();

  for (const skill of allSkills) {
    if (!isUnresolvedCatalogLikeSkill(skill)) continue;
    if (maintainedSkillIds.has(skill.id)) continue;
    const repo = repoKeyFor(skill)?.repo;
    if (!repo) continue;
    const existing = filteredSkillIdsByRepo.get(repo) ?? new Set<string>();
    existing.add(skill.id);
    filteredSkillIdsByRepo.set(repo, existing);
  }

  repoIndex.repos = repoIndex.repos.filter((repo) => {
    const filteredSkillIds = filteredSkillIdsByRepo.get(repo.repo);
    if (!filteredSkillIds) return true;
    if (repo.skillIds.length === 0) return false;
    return !repo.skillIds.every((skillId) => filteredSkillIds.has(skillId));
  });
  repoIndex.repoCount = repoIndex.repos.length;
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

export function buildFinalShadowSkills(
  baselineSkills: Skill[],
  shadowById: Map<string, ShadowSkillRecord>,
  bootstrappedSkills: Skill[],
): ShadowSkillRecord[] {
  const baselineSkillIds = new Set(baselineSkills.map((skill) => skill.id));
  const baselineShadowSkills = baselineSkills.map((skill) => shadowById.get(skill.id) ?? toShadowSkillRecord(skill));
  const carriedForwardShadowSkills = [...shadowById.values()].filter((skill) => !baselineSkillIds.has(skill.id));
  const bootstrappedShadowSkills = bootstrappedSkills.map((skill) => toShadowSkillRecord(skill));

  return [...new Map(
    [...baselineShadowSkills, ...carriedForwardShadowSkills, ...bootstrappedShadowSkills].map((skill) => [skill.id, skill] as const),
  ).values()].sort((a, b) => a.id.localeCompare(b.id));
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
    if (!isUnresolvedCatalogLikeSkill(skill)) continue;
    if (!skill.publisher_repo) continue;
    counts.set(skill.publisher_repo, (counts.get(skill.publisher_repo) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([publisherRepo, count]) => ({ publisherRepo, count }));
}

function shouldExcludeFromInspectableShadowLibrary(skill: ShadowSkillRecord): boolean {
  return isUnresolvedCatalogLikeSkill(skill);
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
      lastCheapCheckedAt: null,
      lastObservedRepoUpdatedAt: null,
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
    `- High-star path-quality skipped: ${report.highStarPathQualitySkippedCount}`,
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
          `- high-star-skillmd: minStars=${report.discoveryBudgetSummary.highStarSkillMd.minStars}, maxSampledRepos=${report.discoveryBudgetSummary.highStarSkillMd.maxSampledRepos}, maxPagesPerQuery=${report.discoveryBudgetSummary.highStarSkillMd.maxPagesPerQuery}`,
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
    "## High-star path-quality skipped sample",
    "",
    ...(report.highStarPathQualitySkippedSample.length
      ? report.highStarPathQualitySkippedSample.map((row) => `- ${row.repo} (${row.stars ?? "?"}) ${row.path}`)
      : ["- none"]),
    "",
    "## Enrichment",
    "",
    `- Active daily priority hotset rule: official (12), gold basket (10), trusted vendor (8), stars fill to ${DAILY_PRIORITY_REPO_LIMIT}`,
    `- Cheap repos checked: ${report.enrichmentCounts.cheapReposChecked}`,
    `- Daily priority repos: ${report.enrichmentCounts.dailyPriorityRepoCount}`,
    `- Daily priority reasons: ${formatPriorityReasonCounts(report.priorityReasonCounts)}`,
    `- Next promotion candidates: ${report.nextPromotionCandidateCount}`,
    `- Next promotion shortlist: ${report.nextPromotionShortlistCount}`,
    `- Promoted repos: ${report.promotedRepoCount}`,
    `- Promoted to rising: ${report.promotedToRisingCount}`,
    `- New discovered repos promoted: ${report.newDiscoveredRepoPromotedCount}`,
    `- Bootstrapped repos: ${report.bootstrappedRepoCount}`,
    `- Catalog-like admissions: ${report.catalogAdmissionCount}`,
    `- Bootstrap failures: ${report.bootstrapFailedRepoCount}`,
    `- Bootstrap skipped: ${report.bootstrapSkippedRepoCount}`,
    `- Shadow repo overlay loaded: ${report.shadowRepoOverlayLoaded ? "yes" : "no"}`,
    `- Shadow repo overlay entries: ${report.shadowRepoOverlayEntryCount}`,
    `- Shadow repo overlay written: ${report.shadowRepoOverlayWrittenCount}`,
    `- Shadow skill overlay loaded: ${report.shadowSkillOverlayLoaded ? "yes" : "no"}`,
    `- Shadow skill overlay entries: ${report.shadowSkillOverlayEntryCount}`,
    `- Shadow skill overlay written: ${report.shadowSkillOverlayWrittenCount}`,
    `- Skills deep-refreshed: ${report.enrichmentCounts.skillsDeepRefreshed}`,
    `- Monitored deep-refreshed: ${report.enrichmentCounts.monitoredDeepRefreshed}`,
    `- Cheap-triggered refresh candidates: ${report.enrichmentCounts.cheapTriggeredRefreshCandidateCount}`,
    `- Cheap-triggered refresh deferred: ${report.enrichmentCounts.cheapTriggeredRefreshDeferredCount}`,
    `- Cheap-triggered deep-refreshed: ${report.enrichmentCounts.cheapTriggeredDeepRefreshed}`,
    `- Carried forward: ${report.enrichmentCounts.carriedForwardCount}`,
    `- Corrected: ${report.enrichmentCounts.correctedCount}`,
    `- Stale/invalid candidates: ${report.enrichmentCounts.staleInvalidCandidateCount}`,
    `- Stale/invalid reasons: repoMissing=${report.staleReasonCounts.repoMissing}, skillFileMissing=${report.staleReasonCounts.skillFileMissing}, validationFailed=${report.staleReasonCounts.validationFailed}`,
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
    `- Catalog-like admissions: ${report.catalogAdmissionSample.map((row) => `${row.repo} (${row.id}, ${row.provenanceType}, stars=${row.stars}, author=@${row.authorHandle || "?"})`).join(", ") || "none"}`,
    `- Bootstrap failures: ${report.bootstrapFailedRepoSample.map((row) => `${row.repo} (${row.source}, ${row.failureReason ?? "failed"})`).join(", ") || "none"}`,
    `- Bootstrap skipped: ${report.bootstrapSkippedRepoSample.map((row) => `${row.repo} (${row.source}, ${row.failureReason ?? "skipped"})`).join(", ") || "none"}`,
    `- Low-star valid skills: ${report.lowStarValidSkillSample.join(", ") || "none"}`,
    `- Stale/invalid candidates: ${report.staleInvalidCandidatesSample.map((row) => `${row.id} (${row.reason})`).join(", ") || "none"}`,
    `- Skill-file missing sample: ${report.skillFileMissingSample.map((row) => `${row.repo} (${row.failedSkillId}, skills=${row.skillCount}, top=${row.topSkillId ?? "none"}, observed=${row.lastObservedRepoUpdatedAt ?? "none"})`).join(", ") || "none"}`,
    `- Daily priority repos: ${report.dailyPriorityRepoSample.map((row) => `${row.repo} (${row.reason})`).join(", ") || "none"}`,
    "",
    "## Crawl v4 Preview",
    "",
    `- Tier counts: tier1=${report.crawl4Preview.tierCounts.tier1}, tier2=${report.crawl4Preview.tierCounts.tier2}, longtail=${report.crawl4Preview.tierCounts.longtail}`,
    `- Missing Tier 1 repos: ${report.crawl4Preview.missingTier1Repos.join(", ") || "none"}`,
    `- Missing Tier 2 repos: ${report.crawl4Preview.missingTier2Repos.join(", ") || "none"}`,
    `- Unresolved catalog repos: ${report.crawl4Preview.unresolvedCatalogRepos.join(", ") || "none"}`,
    `- Momentum counts: skillssh=${report.crawl4Preview.momentumCounts.skillssh}, validatedX=${report.crawl4Preview.momentumCounts.validatedX}, both=${report.crawl4Preview.momentumCounts.both}`,
    `- Momentum repo sample: ${report.crawl4Preview.momentumRepoSample.join(", ") || "none"}`,
    `- Current daily priority: ${report.crawl4Preview.currentDailyPriorityRepos.join(", ") || "none"}`,
    `- Proposed daily priority: ${report.crawl4Preview.proposedDailyPriorityRepos.join(", ") || "none"}`,
    `- Proposed daily priority scores: ${report.crawl4Preview.proposedDailyPriorityScoreSample.map((row) => `${row.repo} (${row.score}: ${row.reasons.join("/")})`).join(", ") || "none"}`,
    `- Daily priority added: ${report.crawl4Preview.dailyPriorityAdded.join(", ") || "none"}`,
    `- Daily priority removed: ${report.crawl4Preview.dailyPriorityRemoved.join(", ") || "none"}`,
    `- Current shortlist: ${report.crawl4Preview.currentShortlistRepos.join(", ") || "none"}`,
    `- Proposed shortlist: ${report.crawl4Preview.proposedShortlistRepos.join(", ") || "none"}`,
    `- Shortlist added: ${report.crawl4Preview.shortlistAdded.join(", ") || "none"}`,
    `- Shortlist removed: ${report.crawl4Preview.shortlistRemoved.join(", ") || "none"}`,
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

function buildTrustSignalsForRepo(
  repo: string,
  goldBasketRepos: Set<string>,
  seeds = loadTrustedSeeds(),
): Pick<ShadowRepoIndexEntry, "isTrustedVendor" | "isTrustedCreator" | "isGoldBasketRepo" | "trustSignals"> {
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

export function admitDiscoveredRepos(
  cadence: ShadowCadence,
  checkedAt: string,
  repoIndex: ShadowRepoIndex,
  discovered: Map<string, DiscoveredRepoRecord>,
  goldBasketRepos: Set<string>,
  seeds: TrustedSeeds,
  options: { maxNewAdmissions?: number } = {},
): Set<string> {
  const admittedRepos = new Set<string>();
  if (cadence !== "combined") return admittedRepos;

  const existingRepos = new Set(repoIndex.repos.map((repo) => repo.repo));
  const maxNewAdmissions = options.maxNewAdmissions ?? Number.POSITIVE_INFINITY;
  const candidates = [...discovered.values()].sort((a, b) =>
    options.maxNewAdmissions
      ? b.stars - a.stars || a.repo.localeCompare(b.repo)
      : a.repo.localeCompare(b.repo),
  );

  for (const discoveredRepo of candidates) {
    if (admittedRepos.size >= maxNewAdmissions) break;
    if (existingRepos.has(discoveredRepo.repo)) continue;
    const trust = buildTrustSignalsForRepo(discoveredRepo.repo, goldBasketRepos, seeds);
    if (!isDiscoveredRepoAdmissionEligible(discoveredRepo, seeds, trust)) continue;

    repoIndex.repos.push(createAdmittedLibraryRepoEntry(discoveredRepo, checkedAt, trust));
    existingRepos.add(discoveredRepo.repo);
    admittedRepos.add(discoveredRepo.repo);
  }

  repoIndex.repos.sort((a, b) => a.repo.localeCompare(b.repo));
  repoIndex.repoCount = repoIndex.repos.length;
  return admittedRepos;
}

function formatDiscoveryWarning(source: DiscoverySourceName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit/i.test(message)) {
    return `${source} rate-limited; returned 0 hits under background budget`;
  }
  return `${source} failed under background budget`;
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
  skillFileMissingSample: SkillFileMissingSample[];
  staleReasonCounts: ShadowStaleReasonCounts;
  priorityReasonCounts: PriorityReasonCounts;
  dailyPriorityRepoSample: DailyPriorityRepoSample[];
  skippedMonitoredRepoCount: number;
  bootstrappedRepoSample: BootstrapRepoSample[];
  catalogAdmissionSample: CatalogAdmissionSample[];
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

function emptyStaleReasonCounts(): ShadowStaleReasonCounts {
  return {
    repoMissing: 0,
    skillFileMissing: 0,
    validationFailed: 0,
  };
}

function formatPriorityReasonCounts(counts: PriorityReasonCounts): string {
  return `official=${counts.official}, goldBasket=${counts.goldBasket}, trustedVendor=${counts.trustedVendor}, stars=${counts.stars}`;
}

export function shouldSuppressStableCheapRetry(
  repoChanged: boolean,
  staleOrInvalidState: ShadowRepoIndexEntry["staleOrInvalidState"],
  observedRepoUpdatedAt: string,
): boolean {
  return Boolean(
    repoChanged &&
      staleOrInvalidState != null &&
      staleOrInvalidState.observedRepoUpdatedAt === observedRepoUpdatedAt &&
      (staleOrInvalidState.reason === "repoMissing" || staleOrInvalidState.reason === "skillFileMissing"),
  );
}

export function buildSkillFileMissingSample(
  staleInvalidCandidates: ShadowStaleInvalidCandidate[],
  repoIndex: ShadowRepoIndex,
): SkillFileMissingSample[] {
  const repoByName = new Map(repoIndex.repos.map((repo) => [repo.repo, repo]));
  return staleInvalidCandidates
    .filter((candidate) => candidate.reason === "skillFileMissing")
    .slice(0, 10)
    .map((candidate) => {
      const repo = repoByName.get(candidate.repo);
      return {
        repo: candidate.repo,
        failedSkillId: candidate.id,
        skillCount: repo?.skillCount ?? 0,
        topSkillId: repo?.topSkillId ?? null,
        lastObservedRepoUpdatedAt: repo?.lastObservedRepoUpdatedAt ?? null,
      };
    });
}

async function runShadowRefresh(
  cadence: ShadowCadence,
  baselineSkills: Skill[],
  shadowSkills: ShadowSkillRecord[],
  repoIndex: ShadowRepoIndex,
  discovered: Map<string, DiscoveredRepoRecord>,
  checkedAt: string,
  repoAliasByCanonical: Map<string, string>,
  newlyAdmittedRepos: Set<string>,
  options: { skipRefreshWork?: boolean } = {},
): Promise<ShadowRefreshResult> {
  const baselineById = new Map(baselineSkills.map((skill) => [skill.id, skill]));
  const shadowById = new Map(shadowSkills.map((skill) => [skill.id, skill]));
  const existingFirstSeen = new Map(baselineSkills.map((skill) => [skill.id, skill.first_seen]));
  const existingSkills = new Map(baselineSkills.map((skill) => [skill.id, skill]));
  const officialRepos = new Set(
    [...discovered.values()]
      .filter((repo) => repo.sources.has("official"))
      .map((repo) => repo.repo),
  );
  const enrichmentWarnings: string[] = [];
  const staleInvalidCandidates: ShadowStaleInvalidCandidate[] = [];
  const staleReasonCounts = emptyStaleReasonCounts();
  const missingPersistedSkillRefreshSample: string[] = [];
  const priorityReasonCounts = emptyPriorityReasonCounts();
  let cheapReposChecked = 0;
  let skillsDeepRefreshed = 0;
  let monitoredDeepRefreshed = 0;
  let cheapTriggeredRefreshCandidateCount = 0;
  let cheapTriggeredRefreshDeferredCount = 0;
  let cheapTriggeredDeepRefreshed = 0;
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
  removeFailedNewlyAdmittedRepos(repoIndex, newlyAdmittedRepos);
  for (const skill of bootstrapResult.bootstrappedSkills) {
    shadowById.set(skill.id, toShadowSkillRecord(skill));
  }
  const repoByName = new Map(repoIndex.repos.map((repo) => [repo.repo, repo]));
  const bootstrappedShadowSkills = bootstrapResult.bootstrappedSkills.map((skill) => toShadowSkillRecord(skill));
  const catalogAdmissionSample = buildCatalogAdmissionSample(bootstrappedShadowSkills);

  if (options.skipRefreshWork) {
    const refreshedShadowSkills = buildFinalShadowSkills(baselineSkills, shadowById, bootstrapResult.bootstrappedSkills);
    enrichmentWarnings.push("high-star backfill-only mode skipped monitored and cheap refresh work");
    return {
      shadowSkills: refreshedShadowSkills,
      enrichmentCounts: {
        cheapReposChecked: 0,
        dailyPriorityRepoCount: 0,
        skillsDeepRefreshed: 0,
        monitoredDeepRefreshed: 0,
        cheapTriggeredRefreshCandidateCount: 0,
        cheapTriggeredRefreshDeferredCount: 0,
        cheapTriggeredDeepRefreshed: 0,
        carriedForwardCount: baselineSkills.length,
        correctedCount: 0,
        staleInvalidCandidateCount: 0,
      },
      newlyDiscoveredCount: bootstrapResult.bootstrappedSkills.length,
      lowStarValidSkillCount: 0,
      lowStarValidSkillSample: [],
      trustedLowStarSkillCount: 0,
      officialLowStarSkillCount: 0,
      staleInvalidCandidatesSample: [],
      skillFileMissingSample: [],
      staleReasonCounts,
      priorityReasonCounts,
      dailyPriorityRepoSample: [],
      skippedMonitoredRepoCount: 0,
      bootstrappedRepoSample: bootstrapResult.bootstrappedRepoSample,
      catalogAdmissionSample,
      bootstrapFailedRepoSample: bootstrapResult.bootstrapFailedRepoSample,
      bootstrapSkippedRepoSample: bootstrapResult.bootstrapSkippedRepoSample,
      rebootstrapEligibleRepoSample,
      enrichmentWarnings,
    };
  }

  const hasFastLane = CADENCE_LANES[cadence].includes("fast");
  const { repos: dailyPriorityRepos, reasonByRepo, skippedMonitoredRepoCount } = buildDailyPriorityRepos(repoIndex, discovered);
  const cheapCheckRepos = buildWeeklyCheapCheckRepos(cadence, repoIndex, dailyPriorityRepos);

  if (!hasFastLane) {
    enrichmentWarnings.push("monitored refresh skipped because cadence excludes fast lane");
  } else if (skippedMonitoredRepoCount > 0) {
    enrichmentWarnings.push(`daily priority refresh capped at ${dailyPriorityRepos.length} repos`);
  }

  const reposToRefresh = hasFastLane ? dailyPriorityRepos : [];
  const today = checkedAt.slice(0, 10);
  const changedReposToRefresh: ShadowRepoIndexEntry[] = [];
  const cheapChangedRepoObservedUpdateByRepo = new Map<string, string>();

  if (cheapCheckRepos.length > 0) {
    console.log(`  cheap repo checks: ${cheapCheckRepos.length} repos`);
  }
  for (const [index, repo] of cheapCheckRepos.entries()) {
    const skillId = repo.topSkillId ?? repo.skillIds[0];
    if (!skillId) continue;
    const baselineSkill = baselineById.get(skillId) ?? shadowById.get(skillId);
    if (!baselineSkill) {
      if (missingPersistedSkillRefreshSample.length < 10) {
        missingPersistedSkillRefreshSample.push(`${repo.repo}:${skillId}`);
      }
      continue;
    }

    if (index === 0 || (index + 1) % 25 === 0 || index === cheapCheckRepos.length - 1) {
      console.log(`  cheap repo checks [${index + 1}/${cheapCheckRepos.length}] ${repo.repo}`);
    }

    cheapReposChecked += 1;
    try {
      const meta = await getCandidateRepoMeta(buildCandidateFromSkill(baselineSkill), today);
      if (!meta) continue;
      const comparisonUpdatedAt = repo.lastObservedRepoUpdatedAt ?? baselineSkill.last_updated;
      repo.lastCheapCheckedAt = checkedAt;
      repo.stars = meta.stars;
      repo.repoUrl = meta.githubUrl;
      const repoChanged = repoMetaLooksChanged(meta.lastUpdated, comparisonUpdatedAt);
      const suppressStableRetry = shouldSuppressStableCheapRetry(
        repoChanged,
        repo.staleOrInvalidState,
        meta.lastUpdated,
      );
      if (repoChanged && !suppressStableRetry) {
        changedReposToRefresh.push(repo);
        cheapChangedRepoObservedUpdateByRepo.set(repo.repo, meta.lastUpdated);
      } else {
        repo.lastObservedRepoUpdatedAt = meta.lastUpdated;
      }
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 404 || /not found/i.test(message)) {
        markRepoMissingCheapCheck(repo, checkedAt);
        staleInvalidCandidates.push({
          id: skillId,
          repo: repo.repo,
          reason: "repoMissing",
        });
        staleReasonCounts.repoMissing += 1;
      } else {
        enrichmentWarnings.push(`cheap repo check failed for ${repo.repo}`);
      }
    }
  }

  const refreshRepoSet = async (
    label: string,
    rows: ShadowRepoIndexEntry[],
    countPriorityReasons: boolean,
  ) => {
    if (rows.length > 0) {
      console.log(`  ${label}: ${rows.length} repos`);
    }
    for (const [index, repo] of rows.entries()) {
      const skillId = repo.topSkillId ?? repo.skillIds[0];
      if (!skillId) continue;
      const baselineSkill = baselineById.get(skillId) ?? shadowById.get(skillId);
      if (!baselineSkill) {
        if (missingPersistedSkillRefreshSample.length < 10) {
          missingPersistedSkillRefreshSample.push(`${repo.repo}:${skillId}`);
        }
        continue;
      }

      const candidate = buildCandidateFromSkill(baselineSkill);
      if (index === 0 || (index + 1) % 5 === 0 || index === rows.length - 1) {
        const pathMode = baselineSkill.skill_md_path
          ? "stored"
          : candidate.skill_md_path === "__RESOLVE__"
            ? "resolve"
            : "derived";
        console.log(`  ${label} [${index + 1}/${rows.length}] ${repo.repo} (${pathMode})`);
      }

      const result = await enrichCandidate(
        candidate,
        existingFirstSeen,
        existingSkills,
        today,
      );
      repo.lastRefreshedAt = checkedAt;
      repo.lastCheapCheckedAt = checkedAt;
      if (countPriorityReasons) {
        const priorityReason = reasonByRepo.get(repo.repo);
        if (priorityReason) priorityReasonCounts[priorityReason] += 1;
      }

      if (result.skill) {
        skillsDeepRefreshed += 1;
        if (countPriorityReasons) {
          monitoredDeepRefreshed += 1;
        } else {
          cheapTriggeredDeepRefreshed += 1;
        }
        repo.stars = result.skill.stars;
        repo.repoUrl = result.skill.github_url;
        repo.lastObservedRepoUpdatedAt = result.skill.last_updated;
        repo.staleOrInvalidState = null;
        shadowById.set(skillId, toShadowSkillRecord(result.skill));
        if (isMeaningfullyCorrected(baselineSkill, result.skill)) {
          correctedCount += 1;
        }
        continue;
      }

      const staleReason = toStaleReason(result);
      staleInvalidCandidates.push({
        id: skillId,
        repo: repo.repo,
        reason: staleReason,
      });
      staleReasonCounts[staleReason] += 1;
      if (!countPriorityReasons && (staleReason === "repoMissing" || staleReason === "skillFileMissing")) {
        repo.staleOrInvalidState = {
          reason: staleReason,
          observedRepoUpdatedAt: repo.lastObservedRepoUpdatedAt ?? baselineSkill.last_updated,
        };
      }
    }
  };

  const cheapTriggeredRefreshSelection = buildCheapTriggeredRefreshSelection(changedReposToRefresh);
  cheapTriggeredRefreshCandidateCount = changedReposToRefresh.length;
  cheapTriggeredRefreshDeferredCount = cheapTriggeredRefreshSelection.deferred.length;
  if (cheapTriggeredRefreshDeferredCount > 0) {
    enrichmentWarnings.push(`cheap-triggered refresh capped at ${cheapTriggeredRefreshSelection.selected.length} repos; deferred ${cheapTriggeredRefreshDeferredCount}`);
  }
  for (const repo of cheapTriggeredRefreshSelection.selected) {
    const observedUpdate = cheapChangedRepoObservedUpdateByRepo.get(repo.repo);
    if (observedUpdate) repo.lastObservedRepoUpdatedAt = observedUpdate;
  }

  await refreshRepoSet("monitored refresh", reposToRefresh, true);
  await refreshRepoSet("cheap-triggered refresh", cheapTriggeredRefreshSelection.selected, false);

  const refreshedShadowSkills = buildFinalShadowSkills(baselineSkills, shadowById, bootstrapResult.bootstrappedSkills);
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
      cheapReposChecked,
      dailyPriorityRepoCount: hasFastLane ? dailyPriorityRepos.length : 0,
      skillsDeepRefreshed,
      monitoredDeepRefreshed,
      cheapTriggeredRefreshCandidateCount,
      cheapTriggeredRefreshDeferredCount,
      cheapTriggeredDeepRefreshed,
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
    skillFileMissingSample: buildSkillFileMissingSample(staleInvalidUnique, repoIndex),
    staleReasonCounts,
    priorityReasonCounts,
    dailyPriorityRepoSample: dailyPriorityRepos.slice(0, 10).map((repo) => ({
      repo: repo.repo,
      reason: reasonByRepo.get(repo.repo) ?? "stars",
    })),
    skippedMonitoredRepoCount,
    bootstrappedRepoSample: bootstrapResult.bootstrappedRepoSample,
    catalogAdmissionSample,
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
  checkedAt: string,
  forceHighStarSkillMd: boolean,
  onlyHighStarBackfill: boolean,
  highStarQueryBatch: HighStarQueryBatch | null,
): Promise<{
  sourceRuns: SourceRunSummary[];
  discovered: Map<string, DiscoveredRepoRecord>;
  discoveryBudgetApplied: boolean;
  discoveryBudgetSummary: DiscoveryBudgetSummary | null;
  partialDiscoveryWarnings: string[];
  highStarPathQualitySkippedCount: number;
  highStarPathQualitySkippedSample: ShadowRunReport["highStarPathQualitySkippedSample"];
}> {
  const lanes = CADENCE_LANES[cadence];
  const sourceRuns: SourceRunSummary[] = [];
  const discovered = new Map<string, DiscoveredRepoRecord>();
  const seeds = loadTrustedSeeds();
  const discoveryBudgetApplied = cadence === "background" || cadence === "combined";
  const discoveryBudgetSummary = discoveryBudgetApplied
    ? {
        ...BACKGROUND_DISCOVERY_BUDGET,
        highStarSkillMd: {
          ...BACKGROUND_DISCOVERY_BUDGET.highStarSkillMd,
          maxSampledRepos: onlyHighStarBackfill
            ? HIGH_STAR_BACKFILL_ONLY_MAX_SAMPLED_REPOS
            : BACKGROUND_DISCOVERY_BUDGET.highStarSkillMd.maxSampledRepos,
          maxPagesPerQuery: onlyHighStarBackfill
            ? HIGH_STAR_BACKFILL_ONLY_MAX_PAGES_PER_QUERY
            : BACKGROUND_DISCOVERY_BUDGET.highStarSkillMd.maxPagesPerQuery,
        },
      }
    : null;
  const partialDiscoveryWarnings: string[] = [];
  let highStarPathQualitySkippedCount = 0;
  const highStarPathQualitySkippedSample: ShadowRunReport["highStarPathQualitySkippedSample"] = [];
  const shouldRunScheduledHighStarSkillMdDiscovery = shouldRunWeeklyHighStarSkillMdDiscovery(checkedAt);
  const runHighStarSkillMdDiscovery = shouldRunScheduledHighStarSkillMdDiscovery || forceHighStarSkillMd;
  if (forceHighStarSkillMd && !shouldRunScheduledHighStarSkillMdDiscovery) {
    partialDiscoveryWarnings.push("high-star-skillmd forced outside weekly schedule");
  }
  if (onlyHighStarBackfill) {
    partialDiscoveryWarnings.push("high-star backfill-only mode enabled");
    partialDiscoveryWarnings.push(
      `high-star backfill-only new admissions capped at ${HIGH_STAR_BACKFILL_ONLY_MAX_NEW_ADMISSIONS}`,
    );
    if (highStarQueryBatch) {
      partialDiscoveryWarnings.push(`high-star query batch: ${highStarQueryBatch}`);
    }
  }
  const cachedHighStarRepoMeta = new Map(
    repoIndex.repos.map((repo) => [
      repo.repo,
      {
        stars: repo.stars,
      },
    ]),
  );

  const addHighStarHits = (hits: unknown[], source: DiscoverySourceName, lane: DiscoveryLane) => {
    for (const hit of hits) {
      const highStarHit = hit as { repo: string; path: string; url: string; stars: number | null };
      if (!isHighStarBackfillPathAllowed(highStarHit.path)) {
        highStarPathQualitySkippedCount += 1;
        if (highStarPathQualitySkippedSample.length < 10) {
          highStarPathQualitySkippedSample.push({
            repo: highStarHit.repo,
            path: highStarHit.path,
            stars: highStarHit.stars,
          });
        }
        continue;
      }
      const repoInfo = {
        repo: highStarHit.repo,
        repoUrl: `https://github.com/${highStarHit.repo}`,
      };
      addDiscoveredRepo(discovered, repoInfo, source, lane, observedStars(hit));
      maybeSetBootstrapCandidate(discovered, repoInfo, {
        source: "code",
        id: codeCandidateId(highStarHit.repo, highStarHit.path),
        skill_md_path: highStarHit.path,
        github_url: `https://github.com/${highStarHit.repo}`,
        stars: highStarHit.stars ?? undefined,
      });
    }
  };

  const runHighStarSkillMdSource = () =>
    timeSource("high-star-skillmd", "background", () =>
      searchHighStarSkillMdRepos(
        discoveryBudgetSummary
          ? {
              minStars: discoveryBudgetSummary.highStarSkillMd.minStars,
              maxSampledRepos: discoveryBudgetSummary.highStarSkillMd.maxSampledRepos,
              maxPagesPerQuery: discoveryBudgetSummary.highStarSkillMd.maxPagesPerQuery,
              requestDelayMs: discoveryBudgetSummary.highStarSkillMd.requestDelayMs,
              queries: highStarQueryBatch ? HIGH_STAR_QUERY_BATCHES[highStarQueryBatch] : undefined,
              cachedRepoMetaByRepo: cachedHighStarRepoMeta,
            }
          : {
              queries: highStarQueryBatch ? HIGH_STAR_QUERY_BATCHES[highStarQueryBatch] : undefined,
              cachedRepoMetaByRepo: cachedHighStarRepoMeta,
            },
      ).then((result) =>
        result.hits.filter(
          (hit) =>
            typeof hit.stars === "number" &&
            hit.stars >= (discoveryBudgetSummary?.highStarSkillMd.minStars ?? 500) &&
            !hit.archived &&
            !hit.disabled,
        ),
      ),
    { allowFailure: true });

  if (onlyHighStarBackfill) {
    const highStarSkillMdRun = await runHighStarSkillMdSource();
    sourceRuns.push(highStarSkillMdRun.summary);
    if (highStarSkillMdRun.warning) partialDiscoveryWarnings.push(highStarSkillMdRun.warning);
    if (discoveryBudgetSummary) {
      partialDiscoveryWarnings.push(
        `high-star-skillmd sampled repos capped at ${discoveryBudgetSummary.highStarSkillMd.maxSampledRepos}`,
      );
    }
    addHighStarHits(highStarSkillMdRun.hits, "high-star-skillmd", "background");
    return {
      sourceRuns,
      discovered,
      discoveryBudgetApplied,
      discoveryBudgetSummary,
      partialDiscoveryWarnings,
      highStarPathQualitySkippedCount,
      highStarPathQualitySkippedSample,
    };
  }

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

    const [topicsRun, codeRun, highStarSkillMdRun, socialRun, aggregatorsRun] = await Promise.all([
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
      runHighStarSkillMdDiscovery
        ? runHighStarSkillMdSource()
        : Promise.resolve({
            hits: [],
            summary: {
              source: "high-star-skillmd",
              lane: "background" as DiscoveryLane,
              hitCount: 0,
              durationMs: 0,
            },
            warning: "high-star-skillmd skipped by weekly schedule",
          }),
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
        `high-star-skillmd sampled repos capped at ${discoveryBudgetSummary.highStarSkillMd.maxSampledRepos}`,
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
    for (const result of [topicsRun, codeRun, highStarSkillMdRun, socialRun, aggregatorsRun] as const) {
      sourceRuns.push(result.summary);
      if (result.warning) partialDiscoveryWarnings.push(result.warning);
      if (discoveryBudgetSummary && result.summary.durationMs >= 30000) {
        partialDiscoveryWarnings.push(`${result.summary.source} slow under budget (${result.summary.durationMs}ms)`);
      }
      for (const hit of result.hits) {
        if (result.summary.source === "high-star-skillmd") {
          addHighStarHits([hit], "high-star-skillmd", "background");
          continue;
        }
        const repoInfo =
          repoKeyFromGithubUrl((hit as { github_url: string }).github_url);
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
    highStarPathQualitySkippedCount,
    highStarPathQualitySkippedSample,
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
  const argv = process.argv.slice(2);
  const cadence = parseCadence(argv);
  const forceHighStarSkillMd = parseForceHighStarSkillMd(argv);
  const onlyHighStarBackfill = parseOnlyHighStarBackfill(argv, cadence);
  const highStarQueryBatch = parseHighStarQueryBatch(argv, onlyHighStarBackfill);
  await assertGitHubQuotaAvailable(cadence);

  const baselinePath = join(indexRoot, "skills.json");
  const goldBasketPath = join(indexRoot, "gold-basket.json");
  const skillsOutPath = join(shadowRoot, "skills.shadow.json");
  const inspectableSkillsOutPath = join(shadowRoot, "skills.inspectable.shadow.json");
  const cutoverSkillsOutPath = join(shadowRoot, "skills.cutover.shadow.json");
  const skillOverlayOutPath = join(shadowRoot, "skills.overlay.json");
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
  const priorShadowRepoIndex = loadShadowRepoIndex(repoIndexOutPath);
  mergePriorShadowRepoTimestamps(baselineRepoIndexForOverlay, priorShadowRepoIndex, checkedAt);
  timings.buildRepoIndex = Math.round(performance.now() - repoIndexStart);

  const repoOverlay = shouldReadShadowRepoOverlay(cadence) ? loadShadowRepoOverlay(repoOverlayOutPath) : null;
  const { overlayLoaded: shadowRepoOverlayLoaded, overlayEntryCount: shadowRepoOverlayEntryCount } = applyShadowRepoOverlay(
    cadence,
    repoIndex,
    repoOverlay,
  );
  mergePriorShadowRepoTimestamps(repoIndex, priorShadowRepoIndex, checkedAt);

  const skillOverlay = shouldReadShadowSkillOverlay(cadence) ? loadShadowSkillOverlay(skillOverlayOutPath) : null;
  const {
    shadowSkills: overlayMergedShadowSkills,
    overlayLoaded: shadowSkillOverlayLoaded,
    overlayEntryCount: shadowSkillOverlayEntryCount,
  } = applyShadowSkillOverlay(cadence, shadowSkills, repoIndex, skillOverlay);
  shadowSkills = overlayMergedShadowSkills;

  const discoveryStart = performance.now();
  const repoAliasByCanonical = new Map<string, string>();
  const {
    sourceRuns,
    discovered,
    discoveryBudgetApplied,
    discoveryBudgetSummary,
    partialDiscoveryWarnings,
    highStarPathQualitySkippedCount,
    highStarPathQualitySkippedSample,
  } =
    await runDiscovery(
      cadence,
      repoIndex,
      checkedAt,
      forceHighStarSkillMd || onlyHighStarBackfill,
      onlyHighStarBackfill,
      highStarQueryBatch,
    );
  timings.runDiscovery = Math.round(performance.now() - discoveryStart);
  const { momentumByRepo, warning: momentumWarning } = buildMomentumSignals(
    discovered,
    join(indexRoot, "top-x-skill-tweets.json"),
  );
  void momentumByRepo;
  const combinedDiscoveryWarnings = momentumWarning
    ? [...partialDiscoveryWarnings, momentumWarning]
    : partialDiscoveryWarnings;

  const seeds = loadTrustedSeeds();
  const newlyAdmittedRepos = admitDiscoveredRepos(
    cadence,
    checkedAt,
    repoIndex,
    discovered,
    goldBasketRepos,
    seeds,
    onlyHighStarBackfill ? { maxNewAdmissions: HIGH_STAR_BACKFILL_ONLY_MAX_NEW_ADMISSIONS } : {},
  );
  const dailyPrioritySelection = buildDailyPriorityRepos(repoIndex, discovered);
  const catalogRepoSet = new Set(seeds.catalogRepoRules.map((rule) => rule.repo));
  const nextPromotionCandidates = onlyHighStarBackfill
    ? []
    : buildNextPromotionCandidates(repoIndex, discovered, dailyPrioritySelection.repos, catalogRepoSet);
  const nextPromotionShortlist = onlyHighStarBackfill ? [] : buildNextPromotionShortlist(nextPromotionCandidates);
  const promotedRepoSample = onlyHighStarBackfill
    ? []
    : await applyShortlistPromotions({
        cadence,
        repoIndex,
        shortlist: nextPromotionShortlist,
      });

  const refreshStart = performance.now();
  const refreshResult = await runShadowRefresh(
    cadence,
    baselineSkills,
    shadowSkills,
    repoIndex,
    discovered,
    checkedAt,
    repoAliasByCanonical,
    newlyAdmittedRepos,
    { skipRefreshWork: onlyHighStarBackfill },
  );
  shadowSkills = refreshResult.shadowSkills;
  timings.runRefresh = Math.round(performance.now() - refreshStart);
  reconcileRepoIndexSkillIds(repoIndex, shadowSkills);
  removeFailedNewlyAdmittedRepos(repoIndex, newlyAdmittedRepos);
  const inspectableShadowSkills = buildInspectableShadowSkills(shadowSkills);
  const cutoverShadowSkills = buildCutoverShadowSkills(shadowSkills);
  removeFilteredCatalogOnlyRepos(repoIndex, shadowSkills, cutoverShadowSkills);
  reconcileRepoIndexSkillIds(repoIndex, cutoverShadowSkills);

  const shadowRepoOverlay: ShadowRepoOverlay | null = shouldWriteShadowRepoOverlay(cadence)
    ? buildShadowRepoOverlay(repoIndex, baselineRepoIndexForOverlay, checkedAt)
    : null;
  const shadowRepoOverlayWrittenCount = shadowRepoOverlay?.repoCount ?? 0;
  const baselineSkillIds = new Set(baselineSkills.map((skill) => skill.id));
  const shadowSkillOverlay: ShadowSkillOverlay | null = shouldWriteShadowSkillOverlay(cadence)
    ? buildShadowSkillOverlay(cutoverShadowSkills, baselineSkillIds, repoIndex, checkedAt)
    : null;
  const shadowSkillOverlayWrittenCount = shadowSkillOverlay?.skillCount ?? 0;

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
    partialDiscoveryWarnings: combinedDiscoveryWarnings,
    highStarPathQualitySkippedCount,
    highStarPathQualitySkippedSample,
    enrichmentCounts: refreshResult.enrichmentCounts,
    lowStarValidSkillCount: refreshResult.lowStarValidSkillCount,
    lowStarValidSkillSample: refreshResult.lowStarValidSkillSample,
    trustedLowStarSkillCount: refreshResult.trustedLowStarSkillCount,
    officialLowStarSkillCount: refreshResult.officialLowStarSkillCount,
    staleInvalidCandidatesSample: refreshResult.staleInvalidCandidatesSample,
    skillFileMissingSample: refreshResult.skillFileMissingSample,
    staleReasonCounts: refreshResult.staleReasonCounts,
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
    crawl4Preview: buildCrawl4Preview({
      repoIndex,
      shadowSkills,
      unresolvedCatalogPublishers: buildUnresolvedCatalogPublishers(shadowSkills),
      discovered,
      momentumByRepo,
      seeds: loadTrustedSeeds(),
    }),
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
    catalogAdmissionCount: refreshResult.catalogAdmissionSample.length,
    catalogAdmissionSample: refreshResult.catalogAdmissionSample,
    bootstrapFailedRepoCount: refreshResult.bootstrapFailedRepoSample.length,
    bootstrapFailedRepoSample: refreshResult.bootstrapFailedRepoSample.slice(0, 10),
    bootstrapSkippedRepoCount: refreshResult.bootstrapSkippedRepoSample.length,
    bootstrapSkippedRepoSample: refreshResult.bootstrapSkippedRepoSample.slice(0, 10),
    rebootstrapEligibleRepoCount: refreshResult.rebootstrapEligibleRepoSample.length,
    rebootstrapEligibleRepoSample: refreshResult.rebootstrapEligibleRepoSample.slice(0, 10),
    shadowRepoOverlayLoaded,
    shadowRepoOverlayEntryCount,
    shadowRepoOverlayWrittenCount,
    shadowSkillOverlayLoaded,
    shadowSkillOverlayEntryCount,
    shadowSkillOverlayWrittenCount,
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
  if (shadowSkillOverlay) {
    writeShadowFile(skillOverlayOutPath, JSON.stringify(shadowSkillOverlay, null, 2) + "\n");
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`shadow crawl failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

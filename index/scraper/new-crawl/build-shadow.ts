import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Skill } from "../types.js";
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
import type {
  DiscoveryBudgetSummary,
  DiscoveryLane,
  ShadowCadence,
  ProvenanceType,
  RepoOverride,
  RepoState,
  ShadowRepoIndex,
  ShadowAuthorDiffExample,
  ShadowRepoIndexEntry,
  ShadowSkillRecord,
  ShadowRunReport,
  ShadowSkillSignals,
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

function buildShadowSkills(skills: Skill[]): ShadowSkillRecord[] {
  const seeds = loadTrustedSeeds();
  return skills.map((skill) => {
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
  });
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
    `- Discovered repos: ${report.discoveredRepoCount}`,
    `- Discovery lane counts: fast=${report.discoveredRepoCountByLane.fast}, periodic=${report.discoveredRepoCountByLane.periodic}, background=${report.discoveredRepoCountByLane.background}`,
    `- Discovery matched baseline repos: ${report.baselineRepoCountMatchedByDiscovery}`,
    `- New discovery repos: ${report.newDiscoveryRepoCount}`,
    `- Bootstrap value repos: ${report.bootstrapValueRepoCount}`,
    `- Fast-only repos: ${report.fastOnlyRepoCount}`,
    `- Discovery budget applied: ${report.discoveryBudgetApplied ? "yes" : "no"}`,
    `- Production write guard: ${report.productionWriteGuardPassed ? "passed" : "failed"}`,
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
) {
  if (!repoInfo) return;
  const existing = discovered.get(repoInfo.repo);
  if (existing) {
    existing.sources.add(source);
    existing.lanes.add(lane);
    return;
  }
  discovered.set(repoInfo.repo, {
    repo: repoInfo.repo,
    repoUrl: repoInfo.repoUrl,
    sources: new Set([source]),
    lanes: new Set([lane]),
  });
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
      warning: `${source} failed under background budget: ${error instanceof Error ? error.message : String(error)}`,
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
        addDiscoveredRepo(discovered, repoKeyFromGithubUrl(hit.github_url), "official", "fast");
      }

      const trustedVendorRepos = repoIndex.repos.filter((repo) => repo.isTrustedVendor);
      sourceRuns.push({
        source: "trusted-vendors",
        lane: "fast",
        hitCount: trustedVendorRepos.length,
        durationMs: 0,
      });
      for (const repo of trustedVendorRepos) {
        addDiscoveredRepo(discovered, { repo: repo.repo, repoUrl: repo.repoUrl }, "trusted-vendors", "fast");
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
        addDiscoveredRepo(discovered, { repo: repo.repo, repoUrl: repo.repoUrl }, "trusted-creators", "fast");
      }

      const monitoredRepos = repoIndex.repos.filter((repo) => repo.state === "rising" || repo.state === "core");
      sourceRuns.push({
        source: "monitored-repos",
        lane: "fast",
        hitCount: monitoredRepos.length,
        durationMs: 0,
      });
      for (const repo of monitoredRepos) {
        addDiscoveredRepo(discovered, { repo: repo.repo, repoUrl: repo.repoUrl }, "monitored-repos", "fast");
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
          addDiscoveredRepo(
            discovered,
            repoKeyFromGithubUrl(hit.github_url),
            result.summary.source as DiscoverySourceName,
            "periodic",
          );
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
      partialDiscoveryWarnings.push("broad code search skipped by budget");
      partialDiscoveryWarnings.push(
        `code fingerprint queries capped at ${discoveryBudgetSummary.code.maxFingerprintQueries}`,
      );
      partialDiscoveryWarnings.push(
        `code query pages capped at ${discoveryBudgetSummary.code.maxPagesPerQuery}`,
      );
      partialDiscoveryWarnings.push(
        `topic queries capped at ${discoveryBudgetSummary.topics.maxQueries}`,
      );
      partialDiscoveryWarnings.push(
        `topic query pages capped at ${discoveryBudgetSummary.topics.maxPagesPerQuery}`,
      );
      partialDiscoveryWarnings.push(
        `social pages capped at ${discoveryBudgetSummary.social.maxPagesPerQuery}`,
      );
      partialDiscoveryWarnings.push(
        `aggregator repos capped at ${discoveryBudgetSummary.aggregators.maxRepos}`,
      );
    }
    for (const result of [topicsRun, codeRun, socialRun, aggregatorsRun] as const) {
      sourceRuns.push(result.summary);
      if (result.warning) partialDiscoveryWarnings.push(result.warning);
      if (discoveryBudgetSummary && result.summary.durationMs >= 30000) {
        partialDiscoveryWarnings.push(`${result.summary.source} may have hit retry pressure (${result.summary.durationMs}ms)`);
      }
      for (const hit of result.hits) {
        addDiscoveredRepo(
          discovered,
          repoKeyFromGithubUrl(hit.github_url),
          result.summary.source as DiscoverySourceName,
          "background",
        );
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
  const repoIndexOutPath = join(shadowRoot, "repo-index.shadow.json");
  const skillSignalsOutPath = join(shadowRoot, "skill-signals.shadow.json");
  const reportOutPath = join(shadowRoot, "shadow-report.json");
  const summaryOutPath = join(shadowRoot, "shadow-summary.md");

  const baselineStart = performance.now();
  const baselineSkills = loadSkills(baselinePath);
  const goldBasketSkills = loadSkills(goldBasketPath);
  timings.loadBaseline = Math.round(performance.now() - baselineStart);

  const provenanceStart = performance.now();
  const shadowSkills = buildShadowSkills(baselineSkills);
  timings.buildProvenance = Math.round(performance.now() - provenanceStart);

  const repoIndexStart = performance.now();
  const { repoIndex, unresolvedBaselineSkillCount } = buildRepoIndex(baselineSkills, goldBasketSkills, checkedAt);
  timings.buildRepoIndex = Math.round(performance.now() - repoIndexStart);

  const discoveryStart = performance.now();
  const { sourceRuns, discovered, discoveryBudgetApplied, discoveryBudgetSummary, partialDiscoveryWarnings } =
    await runDiscovery(cadence, repoIndex);
  timings.runDiscovery = Math.round(performance.now() - discoveryStart);

  const skillSignalsStart = performance.now();
  const skillSignals = buildSkillSignals(checkedAt);
  timings.buildSkillSignals = Math.round(performance.now() - skillSignalsStart);

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
    carriedForwardCount: baselineSkills.length,
    correctedCount: 0,
    newlyDiscoveredCount: 0,
    staleInvalidCandidateCount: 0,
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
    authorDiffExamples: buildAuthorDiffExamples(baselineSkills, shadowSkills),
    catalogRepoExamples: buildCatalogRepoExamples(baselineSkills, shadowSkills),
    topCoreRepos: topReposByState(repoIndex.repos, "core"),
    topRisingRepos: topReposByState(repoIndex.repos, "rising"),
    sourceRuns,
    discoveryBudgetApplied,
    discoveryBudgetSummary,
    partialDiscoveryWarnings,
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
    productionWriteGuardPassed: true,
  };

  const initialReport = buildReport(reportBase, timings);

  const writeStart = performance.now();
  writeShadowFile(skillsOutPath, JSON.stringify(shadowSkills, null, 2) + "\n");
  writeShadowFile(repoIndexOutPath, JSON.stringify(repoIndex, null, 2) + "\n");
  writeShadowFile(skillSignalsOutPath, JSON.stringify(skillSignals, null, 2) + "\n");
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

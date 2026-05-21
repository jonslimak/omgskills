import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Skill } from "../types.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";
import { loadTrustedSeeds } from "./seeds.js";
import type {
  RepoOverride,
  RepoState,
  ShadowRepoIndex,
  ShadowRepoIndexEntry,
  ShadowRunReport,
  ShadowSkillSignals,
  StageTimings,
  TopRepoSummary,
} from "./types.js";

function writeShadowFile(path: string, content: string) {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function loadSkills(path: string): Skill[] {
  return JSON.parse(readFileSync(path, "utf8")) as Skill[];
}

function repoKeyFor(skill: Skill): { repo: string; repoUrl: string } | null {
  try {
    const url = new URL(skill.github_url);
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

  return [
    "# Shadow Crawl Summary",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- Status: ${report.status.toUpperCase()}`,
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
    `- Production write guard: ${report.productionWriteGuardPassed ? "passed" : "failed"}`,
    "",
    "## Top provisional core repos",
    "",
    ...(corePreview.length ? corePreview : ["- none"]),
    "",
    "## Top provisional rising repos",
    "",
    ...(risingPreview.length ? risingPreview : ["- none"]),
    "",
    "## Stage timings (ms)",
    "",
    ...Object.entries(report.stageTimings).map(([stage, ms]) => `- ${stage}: ${ms}`),
    "",
  ].join("\n");
}

async function main() {
  const timings: StageTimings = {};
  const checkedAt = new Date().toISOString();

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

  const repoIndexStart = performance.now();
  const { repoIndex, unresolvedBaselineSkillCount } = buildRepoIndex(baselineSkills, goldBasketSkills, checkedAt);
  timings.buildRepoIndex = Math.round(performance.now() - repoIndexStart);

  const skillSignalsStart = performance.now();
  const skillSignals = buildSkillSignals(checkedAt);
  timings.buildSkillSignals = Math.round(performance.now() - skillSignalsStart);

  const reportBase: Omit<ShadowRunReport, "stageTimings"> = {
    checkedAt,
    status: "ok",
    baselineSkillCount: baselineSkills.length,
    shadowSkillCount: baselineSkills.length,
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
    topCoreRepos: topReposByState(repoIndex.repos, "core"),
    topRisingRepos: topReposByState(repoIndex.repos, "rising"),
    productionWriteGuardPassed: true,
  };

  const initialReport = buildReport(reportBase, timings);

  const writeStart = performance.now();
  writeShadowFile(skillsOutPath, JSON.stringify(baselineSkills, null, 2) + "\n");
  writeShadowFile(repoIndexOutPath, JSON.stringify(repoIndex, null, 2) + "\n");
  writeShadowFile(skillSignalsOutPath, JSON.stringify(skillSignals, null, 2) + "\n");
  writeShadowFile(reportOutPath, JSON.stringify(initialReport, null, 2) + "\n");
  writeShadowFile(summaryOutPath, buildSummary(initialReport, repoIndex));
  timings.writeOutputs = Math.round(performance.now() - writeStart);

  const finalReport = buildReport(reportBase, timings);
  writeShadowFile(reportOutPath, JSON.stringify(finalReport, null, 2) + "\n");
  writeShadowFile(summaryOutPath, buildSummary(finalReport, repoIndex));

  console.log(`shadow crawl complete: ${baselineSkills.length} skills, ${repoIndex.repoCount} repos`);
}

main().catch((error) => {
  console.error(`shadow crawl failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

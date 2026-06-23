import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRepoMissingQuarantined } from "./rolling-refresh.js";
import type { ShadowRepoIndex, ShadowRepoIndexEntry, ShadowRunReport } from "./types.js";

export const STEADY_STATE_LIMITS = {
  cheapCheckWarningVariance: 0.15,
  cheapCheckFailVariance: 0.25,
  cheapTriggeredWarningRatio: 0.10,
  cheapTriggeredFailRatio: 0.20,
  runRefreshWarningMs: 45 * 60 * 1000,
  runRefreshFailMs: 60 * 60 * 1000,
};

export type SteadyStateAcceptanceResult = {
  passed: boolean;
  failures: string[];
  warnings: string[];
  metrics: {
    eligibleRefreshableRepoCount: number;
    weeklyCheapCheckTarget: number;
    cheapReposChecked: number;
    cheapCheckVariance: number;
    cheapTriggeredDeepRefreshed: number;
    cheapTriggeredRatio: number;
    runRefreshMs: number;
    emptyAdmittedRepoCount: number;
  };
};

function isRefreshableRepo(repo: ShadowRepoIndexEntry): boolean {
  return Boolean(repo.topSkillId ?? repo.skillIds[0]) && !isRepoMissingQuarantined(repo);
}

function isEmptyAdmittedRepo(repo: ShadowRepoIndexEntry): boolean {
  return repo.promotionReasons.includes("library-admission") && repo.skillIds.length === 0;
}

function requireNumber(value: unknown, label: string, failures: string[]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  failures.push(`missing numeric field: ${label}`);
  return null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function evaluateSteadyStateAcceptance(
  report: ShadowRunReport,
  repoIndex: ShadowRepoIndex,
): SteadyStateAcceptanceResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const cheapReposChecked = requireNumber(report.enrichmentCounts?.cheapReposChecked, "enrichmentCounts.cheapReposChecked", failures) ?? 0;
  const dailyPriorityRepoCount = requireNumber(report.enrichmentCounts?.dailyPriorityRepoCount, "enrichmentCounts.dailyPriorityRepoCount", failures) ?? 0;
  const cheapTriggeredDeepRefreshed =
    requireNumber(report.enrichmentCounts?.cheapTriggeredDeepRefreshed, "enrichmentCounts.cheapTriggeredDeepRefreshed", failures) ?? 0;
  const runRefreshMs = requireNumber(report.stageTimings?.runRefresh, "stageTimings.runRefresh", failures) ?? 0;

  const eligibleRefreshableRepoCount = repoIndex.repos.filter(isRefreshableRepo).length;
  const weeklyCheapCheckTarget = Math.ceil(Math.max(eligibleRefreshableRepoCount - dailyPriorityRepoCount, 0) / 7);
  const cheapCheckVariance = weeklyCheapCheckTarget === 0
    ? (cheapReposChecked === 0 ? 0 : 1)
    : Math.abs(cheapReposChecked - weeklyCheapCheckTarget) / weeklyCheapCheckTarget;
  const cheapTriggeredRatio = ratio(cheapTriggeredDeepRefreshed, cheapReposChecked);
  const emptyAdmittedRepoCount = repoIndex.repos.filter(isEmptyAdmittedRepo).length;

  if (cheapCheckVariance > STEADY_STATE_LIMITS.cheapCheckFailVariance) {
    failures.push(`cheap check attempts outside target: checked=${cheapReposChecked}, target=${weeklyCheapCheckTarget}`);
  } else if (cheapCheckVariance > STEADY_STATE_LIMITS.cheapCheckWarningVariance) {
    warnings.push(`cheap check attempts near edge: checked=${cheapReposChecked}, target=${weeklyCheapCheckTarget}`);
  }

  if (cheapTriggeredRatio > STEADY_STATE_LIMITS.cheapTriggeredFailRatio) {
    failures.push(`cheap-triggered refresh ratio too high: ${formatPercent(cheapTriggeredRatio)}`);
  } else if (cheapTriggeredRatio >= STEADY_STATE_LIMITS.cheapTriggeredWarningRatio) {
    warnings.push(`cheap-triggered refresh ratio should be watched: ${formatPercent(cheapTriggeredRatio)}`);
  }

  if (runRefreshMs > STEADY_STATE_LIMITS.runRefreshFailMs) {
    failures.push(`runRefresh too slow: ${formatDuration(runRefreshMs)}`);
  } else if (runRefreshMs >= STEADY_STATE_LIMITS.runRefreshWarningMs) {
    warnings.push(`runRefresh should be watched: ${formatDuration(runRefreshMs)}`);
  }

  if (emptyAdmittedRepoCount > 0) {
    failures.push(`empty admitted repos found: ${emptyAdmittedRepoCount}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    metrics: {
      eligibleRefreshableRepoCount,
      weeklyCheapCheckTarget,
      cheapReposChecked,
      cheapCheckVariance,
      cheapTriggeredDeepRefreshed,
      cheapTriggeredRatio,
      runRefreshMs,
      emptyAdmittedRepoCount,
    },
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  return `${(ms / 60000).toFixed(1)}m`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function printResult(result: SteadyStateAcceptanceResult) {
  const m = result.metrics;
  console.log("steady-state acceptance");
  console.log(`  cheap check attempts: ${m.cheapReposChecked}/${m.weeklyCheapCheckTarget} (${formatPercent(m.cheapCheckVariance)} variance)`);
  console.log(`  cheap-triggered refresh: ${m.cheapTriggeredDeepRefreshed} (${formatPercent(m.cheapTriggeredRatio)})`);
  console.log(`  runRefresh: ${formatDuration(m.runRefreshMs)}`);
  console.log(`  empty admitted repos: ${m.emptyAdmittedRepoCount}`);
  for (const warning of result.warnings) console.warn(`  warning: ${warning}`);
  for (const failure of result.failures) console.error(`  fail: ${failure}`);
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const indexRoot = join(scriptDir, "..", "..");
  const report = readJson<ShadowRunReport>(join(indexRoot, "shadow", "shadow-report.json"));
  const repoIndex = readJson<ShadowRepoIndex>(join(indexRoot, "shadow", "repo-index.shadow.json"));
  const result = evaluateSteadyStateAcceptance(report, repoIndex);
  printResult(result);
  if (!result.passed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

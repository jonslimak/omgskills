import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_ROLLOUT_CRITERIA } from "../scraper/policy/rollout-criteria.js";
import { POLICY_REASON_CODES } from "../scraper/policy/types.js";

type ComparisonMode = "policy-diff" | "drift";
type Track = "v2" | "crawl4";

type Thresholds = {
  version: 1;
  snapshotFreshnessHours: number;
  maxUnexpectedRemovals: number;
  maxUnexpectedRemovalPercent: number;
  maxNewAdmissionsWithoutReview: number;
};

type EvidenceReport = {
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  snapshotId: string;
  snapshotCapturedAt: string;
  countsByReason: Record<string, number>;
  migration?: { enforcementReady?: boolean };
  changedCount?: number;
  legacySkillCount?: number;
  potentialAdditionCount?: number;
  removalCount?: number;
  admissionObservationCount?: number;
  admissionChangeCount?: number;
  admissionAdditionCount?: number;
  admissionRemovalCount?: number;
  skippedSuppressedCandidateCount?: number;
  repoStateChangeCount?: number;
  qualityTierChangeCount?: number;
};

type EvidenceSummary = {
  version: 1;
  mode: ComparisonMode;
  track: Track;
  generatedAt: string;
  comparisonValid: boolean;
  readinessEligible: boolean;
  freshness: {
    first: "fresh" | "stale";
    second: "fresh" | "stale";
    maxAgeHours: number;
  };
  first: {
    sourceCommit: string;
    policyDigest: string;
    snapshotId: string;
    snapshotCapturedAt: string;
  };
  second: {
    sourceCommit: string;
    policyDigest: string;
    snapshotId: string;
    snapshotCapturedAt: string;
  };
  issues: string[];
  readinessIssues: string[];
  thresholds: Thresholds;
  rolloutCriteria: typeof POLICY_ROLLOUT_CRITERIA;
};

type Options = {
  mode: ComparisonMode;
  firstPath: string;
  secondPath: string;
  outputDirectory: string;
  requireReady: boolean;
  maxAgeHours?: number;
};

const indexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultThresholdPath = join(indexRoot, "seeds", "policy-observation-thresholds.json");

function parseArgs(argv: string[]): Options {
  let mode: ComparisonMode | null = null;
  let firstPath = "";
  let secondPath = "";
  let outputDirectory = join(indexRoot, "shadow");
  let requireReady = false;
  let maxAgeHours: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--mode") {
      const value = argv[++index];
      if (value !== "policy-diff" && value !== "drift") {
        throw new Error("--mode must be policy-diff or drift");
      }
      mode = value;
    } else if (argument === "--first") firstPath = argv[++index] ?? "";
    else if (argument === "--second") secondPath = argv[++index] ?? "";
    else if (argument === "--output-dir") outputDirectory = resolve(argv[++index] ?? "");
    else if (argument === "--max-age-hours") maxAgeHours = Number(argv[++index]);
    else if (argument === "--require-ready") requireReady = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!mode || !firstPath || !secondPath) {
    throw new Error("--mode, --first, and --second are required");
  }
  if (maxAgeHours !== undefined && (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0)) {
    throw new Error("--max-age-hours must be a positive number");
  }
  return {
    mode,
    firstPath: resolve(firstPath),
    secondPath: resolve(secondPath),
    outputDirectory,
    requireReady,
    maxAgeHours,
  };
}

function loadThresholds(path = defaultThresholdPath): Thresholds {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Thresholds>;
  if (
    value.version !== 1 ||
    !Number.isFinite(value.snapshotFreshnessHours) ||
    !Number.isFinite(value.maxUnexpectedRemovals) ||
    !Number.isFinite(value.maxUnexpectedRemovalPercent) ||
    !Number.isFinite(value.maxNewAdmissionsWithoutReview)
  ) {
    throw new Error(`Invalid policy observation thresholds: ${path}`);
  }
  return value as Thresholds;
}

function loadReport(path: string): EvidenceReport {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<EvidenceReport>;
  if (
    typeof value.generatedAt !== "string" ||
    typeof value.sourceCommit !== "string" ||
    typeof value.policyDigest !== "string" ||
    typeof value.snapshotId !== "string" ||
    typeof value.snapshotCapturedAt !== "string" ||
    !Number.isFinite(Date.parse(value.snapshotCapturedAt)) ||
    !value.countsByReason ||
    typeof value.countsByReason !== "object"
  ) {
    throw new Error(`Policy report is missing required evidence metadata: ${path}`);
  }
  return value as EvidenceReport;
}

function reportTrack(report: EvidenceReport): Track {
  if (typeof report.legacySkillCount === "number") return "v2";
  if (typeof report.admissionChangeCount === "number") return "crawl4";
  throw new Error("Policy report track cannot be determined");
}

function freshness(capturedAt: string, maxAgeHours: number, now = new Date()): "fresh" | "stale" {
  const ageHours = Math.max(0, (now.getTime() - Date.parse(capturedAt)) / 3_600_000);
  return ageHours > maxAgeHours ? "stale" : "fresh";
}

function unexplainedIssues(report: EvidenceReport, label: string): string[] {
  const allowedReasons = new Set<string>(POLICY_REASON_CODES);
  const issues = Object.keys(report.countsByReason)
    .filter((reason) => !allowedReasons.has(reason))
    .map((reason) => `${label} report contains unknown reason code: ${reason}`);
  if ((report.changedCount ?? 0) > 0) {
    issues.push(`${label} v2 report contains ${report.changedCount} changed rows without stable reasons`);
  }
  const isV2 = typeof report.legacySkillCount === "number";
  const requiredFields = isV2
    ? ["potentialAdditionCount", "removalCount", "changedCount"] as const
    : [
      "admissionObservationCount",
      "admissionChangeCount",
      "admissionAdditionCount",
      "admissionRemovalCount",
      "skippedSuppressedCandidateCount",
      "repoStateChangeCount",
      "qualityTierChangeCount",
    ] as const;
  for (const field of requiredFields) {
    if (typeof report[field] !== "number") {
      issues.push(`${label} report is missing numeric field: ${field}`);
    }
  }
  if (isV2 && report.migration?.enforcementReady !== true) {
    issues.push(`${label} v2 legacy migration coverage is incomplete`);
  }
  const reasonCount = Object.values(report.countsByReason).reduce(
    (total, count) => total + (typeof count === "number" ? count : 0),
    0,
  );
  const expectedReasonCount = isV2
    ? (report.potentialAdditionCount ?? 0) + (report.removalCount ?? 0)
    : (report.admissionObservationCount ?? 0) +
      (report.skippedSuppressedCandidateCount ?? 0) +
      (report.repoStateChangeCount ?? 0) +
      (report.qualityTierChangeCount ?? 0);
  if (reasonCount !== expectedReasonCount) {
    issues.push(
      `${label} report reason count ${reasonCount} does not explain ${expectedReasonCount} changed observations`,
    );
  }
  return issues;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, content);
  renameSync(temporaryPath, path);
}

function renderSummary(summary: EvidenceSummary): string {
  return `${[
    "# Policy Evidence",
    "",
    `- Mode: ${summary.mode}`,
    `- Track: ${summary.track}`,
    `- Comparison valid: ${summary.comparisonValid}`,
    `- Readiness eligible: ${summary.readinessEligible}`,
    `- First snapshot: ${summary.first.snapshotId} (${summary.freshness.first})`,
    `- Second snapshot: ${summary.second.snapshotId} (${summary.freshness.second})`,
    `- First policy: ${summary.first.policyDigest}`,
    `- Second policy: ${summary.second.policyDigest}`,
    `- Skill.sh minimum repo stars: ${summary.rolloutCriteria.skillsshMinRepoStars}`,
    `- Momentum daily cap: ${summary.rolloutCriteria.momentumDailyPriorityCap}`,
    `- Creator-watch daily cap: ${summary.rolloutCriteria.creatorWatchDailyPriorityCap}`,
    `- Install admission: rank <= ${summary.rolloutCriteria.installAdmissionMaxAllTimeRank} or installs >= ${summary.rolloutCriteria.installAdmissionMinInstalls}`,
    "",
    "## Issues",
    ...(summary.issues.length ? summary.issues.map((issue) => `- ${issue}`) : ["- none"]),
    "",
    "## Readiness issues",
    ...(summary.readinessIssues.length
      ? summary.readinessIssues.map((issue) => `- ${issue}`)
      : ["- none"]),
  ].join("\n")}\n`;
}

export function verifyPolicyEvidence(options: Options, now = new Date()): EvidenceSummary {
  const thresholds = loadThresholds();
  if (options.maxAgeHours !== undefined) thresholds.snapshotFreshnessHours = options.maxAgeHours;
  const first = loadReport(options.firstPath);
  const second = loadReport(options.secondPath);
  const firstTrack = reportTrack(first);
  const secondTrack = reportTrack(second);
  const issues: string[] = [];
  const readinessIssues: string[] = [];

  if (firstTrack !== secondTrack) issues.push(`Report tracks differ: ${firstTrack} vs ${secondTrack}`);
  if (first.snapshotId === second.snapshotId && first.policyDigest === second.policyDigest) {
    issues.push("Comparison is a no-op: snapshot and policy digest are both identical");
  }
  if (options.mode === "policy-diff") {
    if (first.snapshotId !== second.snapshotId) {
      issues.push("Policy-diff mode requires identical snapshot IDs");
    }
    if (first.policyDigest === second.policyDigest) {
      issues.push("Policy-diff mode requires different policy digests");
    }
  } else {
    if (first.policyDigest !== second.policyDigest) {
      issues.push("Drift mode requires identical policy digests");
    }
    if (first.snapshotId === second.snapshotId) {
      issues.push("Drift mode requires different snapshot IDs");
    }
  }
  issues.push(...unexplainedIssues(first, "First"));
  issues.push(...unexplainedIssues(second, "Second"));

  const firstFreshness = freshness(first.snapshotCapturedAt, thresholds.snapshotFreshnessHours, now);
  const secondFreshness = freshness(second.snapshotCapturedAt, thresholds.snapshotFreshnessHours, now);
  if (firstFreshness === "stale") readinessIssues.push("First snapshot is stale for readiness evidence");
  if (secondFreshness === "stale") readinessIssues.push("Second snapshot is stale for readiness evidence");

  for (const [label, report] of [["First", first], ["Second", second]] as const) {
    if (firstTrack === "v2") {
      const legacySkillCount = report.legacySkillCount ?? 0;
      const percentageLimit = Math.floor(
        legacySkillCount * thresholds.maxUnexpectedRemovalPercent / 100,
      );
      const removalLimit = Math.min(thresholds.maxUnexpectedRemovals, percentageLimit);
      if ((report.removalCount ?? 0) > removalLimit) {
        readinessIssues.push(
          `${label} v2 removals ${report.removalCount ?? 0} exceed the tighter limit ${removalLimit}`,
        );
      }
    } else if (
      (report.admissionAdditionCount ?? 0) > thresholds.maxNewAdmissionsWithoutReview
    ) {
      readinessIssues.push(
        `${label} Crawl 4 additions ${report.admissionAdditionCount ?? 0} exceed the review limit ` +
        `${thresholds.maxNewAdmissionsWithoutReview}`,
      );
    }
  }

  const comparisonValid = issues.length === 0;
  const readinessEligible =
    options.mode === "drift" &&
    comparisonValid &&
    readinessIssues.length === 0;
  const summary: EvidenceSummary = {
    version: 1,
    mode: options.mode,
    track: firstTrack,
    generatedAt: now.toISOString(),
    comparisonValid,
    readinessEligible,
    freshness: {
      first: firstFreshness,
      second: secondFreshness,
      maxAgeHours: thresholds.snapshotFreshnessHours,
    },
    first: {
      sourceCommit: first.sourceCommit,
      policyDigest: first.policyDigest,
      snapshotId: first.snapshotId,
      snapshotCapturedAt: first.snapshotCapturedAt,
    },
    second: {
      sourceCommit: second.sourceCommit,
      policyDigest: second.policyDigest,
      snapshotId: second.snapshotId,
      snapshotCapturedAt: second.snapshotCapturedAt,
    },
    issues,
    readinessIssues,
    thresholds,
    rolloutCriteria: POLICY_ROLLOUT_CRITERIA,
  };

  atomicWrite(
    join(options.outputDirectory, "policy-evidence.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  atomicWrite(join(options.outputDirectory, "policy-evidence.md"), renderSummary(summary));
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = verifyPolicyEvidence(options);
    console.log(
      `[policy:evidence] ${summary.mode} ${summary.track}: ` +
      `valid=${summary.comparisonValid} ready=${summary.readinessEligible}`,
    );
    if (!summary.comparisonValid || (options.requireReady && !summary.readinessEligible)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

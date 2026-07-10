import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshReplayEnv } from "./refresh-replay.js";
import type { ProvenanceType, QualityTier, ShadowCutoverCompare, ShadowCutoverSkillSignal, ShadowRunReport, ShadowSkillRecord } from "./types.js";

type ComparableCutoverSkill = {
  id: string;
  name: string;
  description: string;
  skill_md_path: string | null;
  author_handle: string;
  tags: string[];
  first_seen: string;
  skill_md_sha: string | null;
  publisher_handle: string;
  publisher_repo: string;
  upstream_repo: string | null;
  provenance_type: ProvenanceType;
  author_confidence: "high" | "low";
  quality_tier: QualityTier | null;
};

type ComparableCutoverCompare = Pick<
  ShadowCutoverCompare,
  | "counts"
  | "addedSkillIdsSample"
  | "missingSkillIdsSample"
  | "authorDiffSample"
  | "unresolvedAttributionSummary"
  | "signalSummary"
  | "validationSummary"
>;

type ComparableShadowReport = Pick<
  ShadowRunReport,
  | "cutoverValidationPassed"
  | "cutoverValidationFailureCount"
  | "crawl4Preview"
  | "shadowSkillCount"
  | "inspectableShadowSkillCount"
  | "rebootstrapEligibleRepoCount"
>;

type RerunSnapshot = {
  skills: ComparableCutoverSkill[];
  signals: ShadowCutoverSkillSignal[];
  compareSummary: ComparableCutoverCompare;
  reportSummary: ComparableShadowReport;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_ROOT = join(SCRIPT_DIR, "..", "..");
const SHADOW_ROOT = join(INDEX_ROOT, "shadow");
const REFRESH_REPLAY_ROOT = join(SHADOW_ROOT, "replay");

export function selectComparableCutoverCompare(compare: ShadowCutoverCompare): ComparableCutoverCompare {
  return {
    counts: compare.counts,
    addedSkillIdsSample: compare.addedSkillIdsSample,
    missingSkillIdsSample: compare.missingSkillIdsSample,
    authorDiffSample: compare.authorDiffSample,
    unresolvedAttributionSummary: compare.unresolvedAttributionSummary,
    signalSummary: compare.signalSummary,
    validationSummary: compare.validationSummary,
  };
}

export function selectComparableShadowReport(report: ShadowRunReport): ComparableShadowReport {
  return {
    cutoverValidationPassed: report.cutoverValidationPassed,
    cutoverValidationFailureCount: report.cutoverValidationFailureCount,
    crawl4Preview: report.crawl4Preview,
    shadowSkillCount: report.shadowSkillCount,
    inspectableShadowSkillCount: report.inspectableShadowSkillCount,
    rebootstrapEligibleRepoCount: report.rebootstrapEligibleRepoCount,
  };
}

export function selectComparableCutoverSkills(skills: ShadowSkillRecord[]): ComparableCutoverSkill[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    skill_md_path: skill.skill_md_path ?? null,
    author_handle: skill.author_handle,
    tags: skill.tags,
    first_seen: skill.first_seen,
    skill_md_sha: skill.skill_md_sha ?? null,
    publisher_handle: skill.publisher_handle,
    publisher_repo: skill.publisher_repo,
    upstream_repo: skill.upstream_repo ?? null,
    provenance_type: skill.provenance_type,
    author_confidence: skill.author_confidence,
    quality_tier: skill.quality_tier ?? null,
  }));
}

export function firstDiffPath(left: unknown, right: unknown, path = "$"): string | null {
  if (Object.is(left, right)) {
    return null;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${path}.length`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const diff = firstDiffPath(left[index], right[index], `${path}[${index}]`);
      if (diff) {
        return diff;
      }
    }
    return null;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) {
      return `${path}.__keys__`;
    }
    for (let index = 0; index < leftKeys.length; index += 1) {
      if (leftKeys[index] !== rightKeys[index]) {
        return `${path}.__keys__`;
      }
    }
    for (const key of leftKeys) {
      const diff = firstDiffPath(left[key], right[key], `${path}.${key}`);
      if (diff) {
        return diff;
      }
    }
    return null;
  }

  return path;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function captureSnapshot(): RerunSnapshot {
  const skills = readJson<ShadowSkillRecord[]>(join(SHADOW_ROOT, "skills.cutover.shadow.json"));
  const signals = readJson<ShadowCutoverSkillSignal[]>(join(SHADOW_ROOT, "skill-signals.cutover.shadow.json"));
  const compare = readJson<ShadowCutoverCompare>(join(SHADOW_ROOT, "cutover-compare.shadow.json"));
  const report = readJson<ShadowRunReport>(join(SHADOW_ROOT, "shadow-report.json"));

  return {
    skills: selectComparableCutoverSkills(skills),
    signals,
    compareSummary: selectComparableCutoverCompare(compare),
    reportSummary: selectComparableShadowReport(report),
  };
}

function runShadowBuild(options: { replayMode?: "record" | "replay" } = {}) {
  const env = options.replayMode
    ? {
        ...process.env,
        ...refreshReplayEnv(options.replayMode, REFRESH_REPLAY_ROOT),
      }
    : process.env;

  execFileSync("npm", ["run", "scrape:shadow", "--", "--cadence=combined"], {
    cwd: INDEX_ROOT,
    env,
    stdio: "inherit",
  });
}

function assertNoDiff(label: string, left: unknown, right: unknown) {
  const diffPath = firstDiffPath(left, right);
  if (diffPath) {
    throw new Error(`${label} drifted at ${diffPath}`);
  }
}

function verifyValidationPassed(snapshot: RerunSnapshot, label: string) {
  assert.equal(snapshot.reportSummary.cutoverValidationPassed, true, `${label} cutover validation must pass`);
  assert.equal(snapshot.compareSummary.validationSummary.cutoverValidationPassed, true, `${label} compare validation must pass`);
}

function main() {
  rmSync(REFRESH_REPLAY_ROOT, { recursive: true, force: true });
  mkdirSync(REFRESH_REPLAY_ROOT, { recursive: true });

  console.log("Recording refresh replay seed...");
  runShadowBuild({ replayMode: "record" });
  assert.equal(existsSync(REFRESH_REPLAY_ROOT), true, "refresh replay cache should exist after seed build");

  console.log("Running shadow build 1/2...");
  runShadowBuild({ replayMode: "replay" });
  const first = captureSnapshot();
  verifyValidationPassed(first, "first run");

  console.log("Running shadow build 2/2...");
  runShadowBuild({ replayMode: "replay" });
  const second = captureSnapshot();
  verifyValidationPassed(second, "second run");

  assertNoDiff("skills.cutover.shadow.json", first.skills, second.skills);
  assertNoDiff("skill-signals.cutover.shadow.json", first.signals, second.signals);
  assertNoDiff("cutover-compare.shadow.json", first.compareSummary, second.compareSummary);
  assertNoDiff("shadow-report.json", first.reportSummary, second.reportSummary);

  console.log("Rerun stability verified.");
  console.log(`Cutover skills: ${second.skills.length}`);
  console.log(`Cutover signals: ${second.signals.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

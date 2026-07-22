import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  normalizePolicyHandle,
  normalizePolicyRepo,
  normalizePolicySkillId,
  policyRepoFromSkillId,
} from "../../scripts/policy-identifiers.mjs";
import type { Candidate } from "./enrich.js";
import { evaluateEffectiveSkillPolicy, type EffectivePolicyDecision } from "./policy/effective-policy.js";
import type { PolicyReasonCode } from "./policy/types.js";
import type { Skill } from "./types.js";
import type { TrustedSeeds } from "./new-crawl/types.js";

export const LEGACY_BLOCKED_REPOS = new Set([
  "majiayu000/claude-skill-registry",
  "majiayu000/claude-skill-registry-data",
  "supercent-io/skills-template",
  "anthropics/claude-for-legal",
]);

export const LEGACY_BLOCKED_OWNERS = new Set(["user-attachments"]);

export const LEGACY_ROOT_SKILL_INVALID_REPOS = new Set([
  "user-attachments/assets",
  "anthropics/skills",
  "smerchek/claude-epub-skill",
  "zxkane/aws-skills",
  "bluzername/claude-code-terminal-title",
  "jthack/ffuf_claude_skill",
  "obra/superpowers",
  "avelikiy/great_cto",
  "conorluddy/ios-simulator-skill",
  "sanjay3290/ai-skills",
  "yvgude/lean-ctx",
  "openweb-org/openweb",
  "lackeyjb/playwright-skill",
  "neolabhq/context-engineering-kit",
  "ykdojo/claude-code-tips",
]);

export type V2PolicyMode = "observe" | "enforce";

export type V2CandidatePolicyObservation = {
  id: string;
  skillMdPath: string;
  legacyExcluded: boolean;
  proposedExcluded: boolean;
  reasonCode: PolicyReasonCode;
  matchedSource: string;
};

export type V2LegacyMigrationAudit = {
  blockedReposCovered: string[];
  blockedReposMissing: string[];
  blockedOwnersCovered: string[];
  blockedOwnersMissing: string[];
  rootSkillInvalidCovered: string[];
  rootSkillInvalidMissing: string[];
  enforcementReady: boolean;
};

export type V2PolicyReport = {
  generatedAt: string;
  mode: V2PolicyMode;
  sourceCommit: string;
  policyDigest: string;
  legacySkillCount: number;
  proposedSkillCount: number;
  effectiveSkillCount: number;
  potentialAdditionCount: number;
  removalCount: number;
  changedCount: number;
  countsByReason: Partial<Record<PolicyReasonCode, number>>;
  migration: V2LegacyMigrationAudit;
  potentialAdditionSample: V2CandidatePolicyObservation[];
  removalSample: Array<{ id: string; reasonCode: PolicyReasonCode; matchedSource: string }>;
  changedSample: string[];
};

export function parseV2PolicyMode(value = process.env.V2_POLICY_MODE): V2PolicyMode {
  const normalized = value?.trim().toLowerCase() || "observe";
  if (normalized === "observe" || normalized === "enforce") return normalized;
  throw new Error(`Invalid V2_POLICY_MODE: ${value}. Expected observe or enforce.`);
}

function allowedDecision(): EffectivePolicyDecision {
  return { excluded: false, reasonCode: null, matchedSource: null, matchedKey: null };
}

function excludedDecision(reasonCode: PolicyReasonCode, matchedSource: string, matchedKey: string): EffectivePolicyDecision {
  return { excluded: true, reasonCode, matchedSource, matchedKey };
}

export function isRootSkillPath(path: string | null | undefined): boolean {
  return (path ?? "").trim().replace(/^\.\//, "").toLowerCase() === "skill.md";
}

function candidateRepo(candidate: Pick<Candidate, "id">): string {
  return policyRepoFromSkillId(candidate.id);
}

export function evaluateLegacyV2Candidate(candidate: Candidate): EffectivePolicyDecision {
  const repo = candidateRepo(candidate);
  const owner = repo.split("/")[0] ?? "";
  if (LEGACY_BLOCKED_REPOS.has(repo)) return excludedDecision("do-not-crawl", "legacy.BLOCKED_REPOS", repo);
  if (LEGACY_BLOCKED_OWNERS.has(owner)) return excludedDecision("do-not-crawl", "legacy.BLOCKED_OWNERS", owner);
  if (LEGACY_ROOT_SKILL_INVALID_REPOS.has(repo)) {
    return excludedDecision("root-skill-invalid", "legacy.KNOWN_INVALID_REPOS", repo);
  }
  return allowedDecision();
}

export function evaluateProposedV2Candidate(candidate: Candidate, seeds: TrustedSeeds): EffectivePolicyDecision {
  const shared = evaluateEffectiveSkillPolicy({ id: candidate.id, github_url: candidate.github_url }, seeds);
  if (shared.excluded) return shared;
  const repo = candidateRepo(candidate);
  if (seeds.rootSkillInvalidRepos?.has(repo) && isRootSkillPath(candidate.skill_md_path)) {
    return excludedDecision("root-skill-invalid", "rootSkillInvalid", repo);
  }
  return allowedDecision();
}

export function evaluateProposedV2Skill(skill: Skill, seeds: TrustedSeeds): EffectivePolicyDecision {
  const shared = evaluateEffectiveSkillPolicy(skill, seeds);
  if (shared.excluded) return shared;
  const repo = policyRepoFromSkillId(skill.id);
  if (seeds.rootSkillInvalidRepos?.has(repo) && isRootSkillPath(skill.skill_md_path)) {
    return excludedDecision("root-skill-invalid", "rootSkillInvalid", repo);
  }
  return allowedDecision();
}

export function observeCandidatePolicy(candidate: Candidate, seeds: TrustedSeeds): V2CandidatePolicyObservation | null {
  const legacy = evaluateLegacyV2Candidate(candidate);
  const proposed = evaluateProposedV2Candidate(candidate, seeds);
  if (legacy.excluded === proposed.excluded) return null;
  const explaining = legacy.excluded ? legacy : proposed;
  return {
    id: normalizePolicySkillId(candidate.id),
    skillMdPath: candidate.skill_md_path,
    legacyExcluded: legacy.excluded,
    proposedExcluded: proposed.excluded,
    reasonCode: explaining.reasonCode ?? "invalid-mapping",
    matchedSource: explaining.matchedSource ?? "unknown",
  };
}

function coveredAndMissing(
  legacy: ReadonlySet<string>,
  shared: ReadonlySet<string> | undefined,
  normalize: (value: string) => string,
) {
  const normalizedShared = new Set([...(shared ?? [])].map(normalize));
  const values = [...legacy].map(normalize).sort();
  return {
    covered: values.filter((entry) => normalizedShared.has(entry)),
    missing: values.filter((entry) => !normalizedShared.has(entry)),
  };
}

export function buildV2LegacyMigrationAudit(seeds: TrustedSeeds): V2LegacyMigrationAudit {
  const repos = coveredAndMissing(LEGACY_BLOCKED_REPOS, seeds.doNotCrawlRepos, normalizePolicyRepo);
  const owners = coveredAndMissing(LEGACY_BLOCKED_OWNERS, seeds.doNotCrawlOwners, normalizePolicyHandle);
  const root = coveredAndMissing(LEGACY_ROOT_SKILL_INVALID_REPOS, seeds.rootSkillInvalidRepos, normalizePolicyRepo);
  const enforcementReady = repos.missing.length === 0 && owners.missing.length === 0 && root.missing.length === 0;
  return {
    blockedReposCovered: repos.covered,
    blockedReposMissing: repos.missing,
    blockedOwnersCovered: owners.covered,
    blockedOwnersMissing: owners.missing,
    rootSkillInvalidCovered: root.covered,
    rootSkillInvalidMissing: root.missing,
    enforcementReady,
  };
}

export function assertV2PolicyEnforcementReady(audit: V2LegacyMigrationAudit): void {
  if (audit.enforcementReady) return;
  throw new Error(
    `V2 policy enforcement blocked by unresolved legacy mappings: ${[
      ...audit.blockedReposMissing,
      ...audit.blockedOwnersMissing,
      ...audit.rootSkillInvalidMissing,
    ].join(", ")}`,
  );
}

function skillById(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((skill) => [normalizePolicySkillId(skill.id), skill]));
}

function increment(counts: Partial<Record<PolicyReasonCode, number>>, reason: PolicyReasonCode): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export function buildV2PolicyReport(input: {
  generatedAt: string;
  mode: V2PolicyMode;
  sourceCommit: string;
  policyDigest: string;
  legacySkills: Skill[];
  proposedSkills: Skill[];
  candidateObservations: V2CandidatePolicyObservation[];
  migration: V2LegacyMigrationAudit;
  seeds: TrustedSeeds;
}): V2PolicyReport {
  const legacy = skillById(input.legacySkills);
  const proposed = skillById(input.proposedSkills);
  const removals = [...legacy.entries()].flatMap(([id, skill]) => {
    if (proposed.has(id)) return [];
    const decision = evaluateProposedV2Skill(skill, input.seeds);
    return [{
      id: skill.id,
      reasonCode: (decision.reasonCode ?? "invalid-mapping") as PolicyReasonCode,
      matchedSource: decision.matchedSource ?? "sharedPolicy",
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
  const changed = [...legacy.entries()].flatMap(([id, skill]) => {
    const next = proposed.get(id);
    return next && JSON.stringify(skill) !== JSON.stringify(next) ? [skill.id] : [];
  }).sort();
  const potentialAdditions = [...new Map(
    input.candidateObservations
      .filter((row) => row.legacyExcluded && !row.proposedExcluded)
      .map((row) => [`${row.id}\n${row.skillMdPath.toLowerCase()}`, row]),
  ).values()].sort((left, right) => left.id.localeCompare(right.id) || left.skillMdPath.localeCompare(right.skillMdPath));
  const countsByReason: Partial<Record<PolicyReasonCode, number>> = {};
  for (const row of [...potentialAdditions, ...removals]) increment(countsByReason, row.reasonCode);
  const effectiveCount = input.mode === "enforce" ? input.proposedSkills.length : input.legacySkills.length;
  return {
    generatedAt: input.generatedAt,
    mode: input.mode,
    sourceCommit: input.sourceCommit,
    policyDigest: input.policyDigest,
    legacySkillCount: input.legacySkills.length,
    proposedSkillCount: input.proposedSkills.length,
    effectiveSkillCount: effectiveCount,
    potentialAdditionCount: potentialAdditions.length,
    removalCount: removals.length,
    changedCount: changed.length,
    countsByReason: Object.fromEntries(Object.entries(countsByReason).sort(([a], [b]) => a.localeCompare(b))),
    migration: input.migration,
    potentialAdditionSample: potentialAdditions.slice(0, 30),
    removalSample: removals.slice(0, 30),
    changedSample: changed.slice(0, 30),
  };
}

export function renderV2PolicyReport(report: V2PolicyReport): string {
  return `${[
    "# v2 Effective Policy Diff",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Source commit: ${report.sourceCommit}`,
    `- Policy digest: ${report.policyDigest}`,
    `- Legacy skills: ${report.legacySkillCount}`,
    `- Proposed skills: ${report.proposedSkillCount}`,
    `- Effective skills: ${report.effectiveSkillCount}`,
    `- Potential candidate additions: ${report.potentialAdditionCount}`,
    `- Removals: ${report.removalCount}`,
    `- Changed rows: ${report.changedCount}`,
    `- Legacy mappings complete: ${report.migration.enforcementReady}`,
    ...Object.entries(report.countsByReason).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Potential additions",
    ...(report.potentialAdditionSample.length
      ? report.potentialAdditionSample.map((row) => `- ${row.id} (${row.skillMdPath}; ${row.reasonCode})`)
      : ["- none"]),
    "",
    "## Removals",
    ...(report.removalSample.length
      ? report.removalSample.map((row) => `- ${row.id} (${row.reasonCode})`)
      : ["- none"]),
  ].join("\n")}\n`;
}

export function writeV2PolicyReport(jsonPath: string, markdownPath: string, report: V2PolicyReport): void {
  for (const [path, content] of [
    [jsonPath, JSON.stringify(report, null, 2) + "\n"],
    [markdownPath, renderV2PolicyReport(report)],
  ] as const) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, content, "utf8");
    renameSync(temporary, path);
  }
}

export function currentSourceCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA?.trim() || "unknown";
  }
}

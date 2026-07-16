import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Skill } from "../types.js";

export type SkillEquivalenceAgent = "claude" | "codex" | "neutral" | "other";

export type SkillEquivalenceSkill = Pick<
  Skill,
  "id" | "name" | "description" | "github_url" | "skill_md_path" | "skill_md_sha"
>;

export type SkillEquivalenceEvidence =
  | "same-repo"
  | "exact-name"
  | "agent-path"
  | "description-match"
  | "manual-approval";

export type SkillEquivalenceGroup = {
  id: string;
  memberSkillIds: string[];
  representativeSkillId: string;
  preferredSkillIds: {
    claude?: string;
    codex?: string;
  };
  confidence: "high";
  evidence: SkillEquivalenceEvidence[];
};

export type SkillEquivalenceArtifact = {
  version: 1;
  generatedAt: string;
  groups: SkillEquivalenceGroup[];
};

export type SkillEquivalenceOverrideDecision = {
  memberSkillIds: string[];
  decision: "approve" | "reject";
  notes?: string;
};

export type SkillEquivalenceOverrides = {
  version: 1;
  decisions: SkillEquivalenceOverrideDecision[];
};

export type SkillEquivalenceCandidate = {
  id: string;
  repo: string;
  normalizedName: string;
  memberSkillIds: string[];
  agents: SkillEquivalenceAgent[];
  paths: string[];
  reason: "neutral-path-review";
};

export type SkillEquivalenceExcludedCandidate = {
  repo: string;
  normalizedName: string;
  memberSkillIds: string[];
  agents: SkillEquivalenceAgent[];
  reason:
    | "multiple-candidates"
    | "unsupported-agent-pair"
    | "missing-sha"
    | "same-sha"
    | "description-mismatch"
    | "rejected";
};

export type SkillEquivalenceReviewReport = {
  version: 1;
  generatedAt: string;
  policy: "same-repo-v1";
  summary: {
    publishableCount: number;
    automaticCount: number;
    manuallyApprovedCount: number;
    pendingReviewCount: number;
    rejectedCount: number;
    excludedCount: number;
    staleOverrideCount: number;
  };
  pendingReview: SkillEquivalenceCandidate[];
  excluded: SkillEquivalenceExcludedCandidate[];
  staleOverrides: SkillEquivalenceOverrideDecision[];
};

export type SkillEquivalenceBuildResult = {
  artifact: SkillEquivalenceArtifact;
  review: SkillEquivalenceReviewReport;
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeName(value: string): string {
  return normalize(value).replace(/\s+/g, " ");
}

function normalizeRepo(githubUrl: string): string {
  try {
    const url = new URL(githubUrl);
    if (url.hostname.toLowerCase() !== "github.com") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return `${parts[0]!.toLowerCase()}/${parts[1]!.replace(/\.git$/i, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

function skillPath(skill: SkillEquivalenceSkill): string {
  const explicit = skill.skill_md_path?.trim();
  if (explicit) return explicit.replaceAll("\\", "/");
  const separatorIndex = skill.id.indexOf(":");
  return separatorIndex === -1 ? "" : skill.id.slice(separatorIndex + 1).replaceAll("\\", "/");
}

export function classifySkillEquivalenceAgent(skill: SkillEquivalenceSkill): SkillEquivalenceAgent {
  const path = normalize(skillPath(skill));
  const segments = path.split("/").filter(Boolean);
  const hasSegmentPair = (first: string, second: string) =>
    segments.some((segment, index) => segment === first && segments[index + 1] === second);

  if (hasSegmentPair(".claude", "skills")) return "claude";
  if (hasSegmentPair(".codex", "skills")) return "codex";
  if (
    segments.some((segment) =>
      [
        ".agent",
        "agent",
        ".agents",
        "agents",
        ".cursor",
        "cursor",
        ".gemini",
        "gemini",
        ".opencode",
        "opencode",
      ].includes(segment),
    )
  ) {
    return "other";
  }
  if (segments.some((segment) => segment === "skills-codex" || segment.startsWith("skills-codex-"))) {
    return "codex";
  }
  return "neutral";
}

function normalizedDescriptionWords(value: string | null | undefined): string[] {
  return normalize(value)
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
}

export function skillEquivalenceDescriptionsMatch(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const normalizedFirst = normalize(first).replace(/\s+/g, " ");
  const normalizedSecond = normalize(second).replace(/\s+/g, " ");

  if (normalizedFirst === normalizedSecond) return Boolean(normalizedFirst);
  if (!normalizedFirst || !normalizedSecond) return false;
  if (
    Math.min(normalizedFirst.length, normalizedSecond.length) >= 35 &&
    (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst))
  ) {
    return true;
  }

  const firstWords = new Set(normalizedDescriptionWords(normalizedFirst));
  const secondWords = new Set(normalizedDescriptionWords(normalizedSecond));
  const smallerSize = Math.min(firstWords.size, secondWords.size);
  let shared = 0;
  for (const word of firstWords) {
    if (secondWords.has(word)) shared += 1;
  }

  if (smallerSize >= 3 && smallerSize < 5) return shared / smallerSize >= 0.8;
  if (smallerSize < 5) return false;
  return shared / smallerSize >= 0.72;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function skillEquivalenceGroupId(memberSkillIds: string[]): string {
  const digest = createHash("sha256").update(sortedUnique(memberSkillIds).join("\n")).digest("hex");
  return `eq-${digest}`;
}

function decisionKey(memberSkillIds: string[]): string {
  return sortedUnique(memberSkillIds).join("\n");
}

export function parseSkillEquivalenceOverrides(input: unknown): SkillEquivalenceOverrides {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid skill equivalence overrides: expected an object.");
  }
  const value = input as { version?: unknown; decisions?: unknown };
  if (value.version !== 1 || !Array.isArray(value.decisions)) {
    throw new Error("Invalid skill equivalence overrides: expected version 1 with decisions.");
  }

  const seen = new Set<string>();
  const decisions = value.decisions.map((rawDecision, index) => {
    if (!rawDecision || typeof rawDecision !== "object") {
      throw new Error(`Invalid skill equivalence override at index ${index}.`);
    }
    const raw = rawDecision as {
      memberSkillIds?: unknown;
      decision?: unknown;
      notes?: unknown;
    };
    if (!Array.isArray(raw.memberSkillIds)) {
      throw new Error(`Invalid skill equivalence override at index ${index}: memberSkillIds must be an array.`);
    }
    if (raw.memberSkillIds.some((member) => typeof member !== "string" || !member.trim())) {
      throw new Error(`Invalid skill equivalence override at index ${index}: members must be non-empty strings.`);
    }
    const memberSkillIds = sortedUnique(raw.memberSkillIds.map((member) => (member as string).trim()));
    if (memberSkillIds.length !== 2) {
      throw new Error(`Invalid skill equivalence override at index ${index}: exactly two unique members are required.`);
    }
    if (raw.decision !== "approve" && raw.decision !== "reject") {
      throw new Error(`Invalid skill equivalence override at index ${index}: decision must be approve or reject.`);
    }
    const decision: SkillEquivalenceOverrideDecision["decision"] = raw.decision;
    const key = decisionKey(memberSkillIds);
    if (seen.has(key)) {
      throw new Error(`Duplicate skill equivalence override for ${memberSkillIds.join(", ")}.`);
    }
    seen.add(key);
    return {
      memberSkillIds,
      decision,
      ...(typeof raw.notes === "string" && raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
    };
  });

  return { version: 1, decisions };
}

export function loadSkillEquivalenceOverrides(path: string): SkillEquivalenceOverrides {
  return parseSkillEquivalenceOverrides(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function buildGroup(
  rows: SkillEquivalenceSkill[],
  manuallyApproved: boolean,
): SkillEquivalenceGroup {
  const memberSkillIds = sortedUnique(rows.map((row) => row.id));
  const codex = rows.find((row) => classifySkillEquivalenceAgent(row) === "codex");
  const claude = rows.find((row) => {
    const agent = classifySkillEquivalenceAgent(row);
    return agent === "claude" || agent === "neutral";
  });
  if (!codex || !claude) {
    throw new Error(`Cannot build skill equivalence group without Claude and Codex variants: ${memberSkillIds.join(", ")}`);
  }
  return {
    id: skillEquivalenceGroupId(memberSkillIds),
    memberSkillIds,
    representativeSkillId: codex.id,
    preferredSkillIds: {
      claude: claude.id,
      codex: codex.id,
    },
    confidence: "high",
    evidence: [
      "same-repo",
      "exact-name",
      "agent-path",
      "description-match",
      ...(manuallyApproved ? (["manual-approval"] as const) : []),
    ],
  };
}

function excludedCandidate(
  rows: SkillEquivalenceSkill[],
  repo: string,
  normalizedName: string,
  reason: SkillEquivalenceExcludedCandidate["reason"],
): SkillEquivalenceExcludedCandidate {
  const sortedRows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    repo,
    normalizedName,
    memberSkillIds: sortedRows.map((row) => row.id),
    agents: sortedRows.map(classifySkillEquivalenceAgent),
    reason,
  };
}

export function validateSkillEquivalenceArtifact(
  artifact: SkillEquivalenceArtifact,
  skills: SkillEquivalenceSkill[],
): string[] {
  const failures: string[] = [];
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const claimedSkillIds = new Set<string>();

  for (const group of artifact.groups) {
    const members = sortedUnique(group.memberSkillIds);
    if (members.length !== 2 || members.length !== group.memberSkillIds.length) {
      failures.push(`${group.id}: v1 groups require exactly two unique members.`);
    }
    if (members.some((member, index) => member !== group.memberSkillIds[index])) {
      failures.push(`${group.id}: memberSkillIds must be sorted.`);
    }
    if (group.id !== skillEquivalenceGroupId(group.memberSkillIds)) {
      failures.push(`${group.id}: group ID does not match its members.`);
    }
    if (!group.memberSkillIds.includes(group.representativeSkillId)) {
      failures.push(`${group.id}: representativeSkillId is not a member.`);
    }
    for (const [agent, preferredSkillId] of Object.entries(group.preferredSkillIds)) {
      if (!group.memberSkillIds.includes(preferredSkillId)) {
        failures.push(`${group.id}: preferred ${agent} skill is not a member.`);
      }
    }

    const rows = group.memberSkillIds
      .map((memberSkillId) => skillsById.get(memberSkillId))
      .filter((row): row is SkillEquivalenceSkill => Boolean(row));
    if (rows.length !== group.memberSkillIds.length) {
      failures.push(`${group.id}: one or more members are missing from the live catalog.`);
    }
    const repos = new Set(rows.map((row) => normalizeRepo(row.github_url)).filter(Boolean));
    if (repos.size !== 1) failures.push(`${group.id}: members do not share one concrete repository.`);
    const names = new Set(rows.map((row) => normalizeName(row.name)).filter(Boolean));
    if (names.size !== 1) failures.push(`${group.id}: members do not share one normalized name.`);
    const shas = new Set(rows.map((row) => normalize(row.skill_md_sha)).filter(Boolean));
    if (rows.length === 2 && shas.size !== 2) {
      failures.push(`${group.id}: members must have distinct non-empty SHAs.`);
    }
    if (rows.length === 2 && !skillEquivalenceDescriptionsMatch(rows[0]!.description, rows[1]!.description)) {
      failures.push(`${group.id}: member descriptions do not satisfy the v1 policy.`);
    }

    const preferredClaude = group.preferredSkillIds.claude
      ? skillsById.get(group.preferredSkillIds.claude)
      : undefined;
    if (
      preferredClaude &&
      !["claude", "neutral"].includes(classifySkillEquivalenceAgent(preferredClaude))
    ) {
      failures.push(`${group.id}: preferred Claude member has an incompatible path.`);
    }
    const preferredCodex = group.preferredSkillIds.codex
      ? skillsById.get(group.preferredSkillIds.codex)
      : undefined;
    if (preferredCodex && classifySkillEquivalenceAgent(preferredCodex) !== "codex") {
      failures.push(`${group.id}: preferred Codex member has an incompatible path.`);
    }

    for (const memberSkillId of group.memberSkillIds) {
      if (claimedSkillIds.has(memberSkillId)) {
        failures.push(`${group.id}: ${memberSkillId} belongs to more than one group.`);
      }
      claimedSkillIds.add(memberSkillId);
    }
  }

  return failures;
}

export function buildSkillEquivalenceShadow(
  skills: SkillEquivalenceSkill[],
  generatedAt: string,
  overrides: SkillEquivalenceOverrides = { version: 1, decisions: [] },
): SkillEquivalenceBuildResult {
  const decisionsByKey = new Map(
    overrides.decisions.map((decision) => [decisionKey(decision.memberSkillIds), decision]),
  );
  const consumedDecisionKeys = new Set<string>();
  const groups: SkillEquivalenceGroup[] = [];
  const pendingReview: SkillEquivalenceCandidate[] = [];
  const excluded: SkillEquivalenceExcludedCandidate[] = [];
  let automaticCount = 0;
  let manuallyApprovedCount = 0;
  let rejectedCount = 0;

  const byRepoAndName = new Map<string, SkillEquivalenceSkill[]>();
  for (const skill of skills) {
    const repo = normalizeRepo(skill.github_url);
    const name = normalizeName(skill.name);
    if (!repo || !name) continue;
    const key = `${repo}\n${name}`;
    const rows = byRepoAndName.get(key) ?? [];
    rows.push(skill);
    byRepoAndName.set(key, rows);
  }

  for (const [repoAndName, unsortedRows] of [...byRepoAndName.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const rows = [...unsortedRows].sort((a, b) => a.id.localeCompare(b.id));
    const agents = rows.map(classifySkillEquivalenceAgent);
    const hasCodex = agents.includes("codex");
    const hasClaudeSide = agents.includes("claude") || agents.includes("neutral");
    if (!hasCodex || !hasClaudeSide) continue;

    const [repo, normalizedName] = repoAndName.split("\n");
    if (rows.length !== 2) {
      excluded.push(excludedCandidate(rows, repo!, normalizedName!, "multiple-candidates"));
      continue;
    }

    const key = decisionKey(rows.map((row) => row.id));
    const decision = decisionsByKey.get(key);
    if (decision) consumedDecisionKeys.add(key);

    const shas = rows.map((row) => normalize(row.skill_md_sha));
    if (shas.some((sha) => !sha)) {
      excluded.push(excludedCandidate(rows, repo!, normalizedName!, "missing-sha"));
      continue;
    }
    if (shas[0] === shas[1]) {
      excluded.push(excludedCandidate(rows, repo!, normalizedName!, "same-sha"));
      continue;
    }
    if (!skillEquivalenceDescriptionsMatch(rows[0]!.description, rows[1]!.description)) {
      excluded.push(excludedCandidate(rows, repo!, normalizedName!, "description-mismatch"));
      continue;
    }

    const explicitPair = agents.includes("claude") && agents.includes("codex");
    const neutralPair = agents.includes("neutral") && agents.includes("codex");
    if (!explicitPair && !neutralPair) {
      excluded.push(excludedCandidate(rows, repo!, normalizedName!, "unsupported-agent-pair"));
      continue;
    }
    if (decision?.decision === "reject") {
      rejectedCount += 1;
      excluded.push(excludedCandidate(rows, repo!, normalizedName!, "rejected"));
      continue;
    }
    if (explicitPair) {
      groups.push(buildGroup(rows, false));
      automaticCount += 1;
      continue;
    }
    if (decision?.decision === "approve") {
      groups.push(buildGroup(rows, true));
      manuallyApprovedCount += 1;
      continue;
    }

    pendingReview.push({
      id: skillEquivalenceGroupId(rows.map((row) => row.id)),
      repo: repo!,
      normalizedName: normalizedName!,
      memberSkillIds: rows.map((row) => row.id),
      agents,
      paths: rows.map(skillPath),
      reason: "neutral-path-review",
    });
  }

  groups.sort((a, b) => a.id.localeCompare(b.id));
  pendingReview.sort((a, b) => a.id.localeCompare(b.id));
  excluded.sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      a.normalizedName.localeCompare(b.normalizedName) ||
      a.reason.localeCompare(b.reason),
  );
  const staleOverrides = overrides.decisions.filter(
    (decision) => !consumedDecisionKeys.has(decisionKey(decision.memberSkillIds)),
  );
  const artifact: SkillEquivalenceArtifact = {
    version: 1,
    generatedAt,
    groups,
  };
  const failures = validateSkillEquivalenceArtifact(artifact, skills);
  if (failures.length > 0) {
    throw new Error(`Invalid skill equivalence artifact:\n${failures.join("\n")}`);
  }

  return {
    artifact,
    review: {
      version: 1,
      generatedAt,
      policy: "same-repo-v1",
      summary: {
        publishableCount: groups.length,
        automaticCount,
        manuallyApprovedCount,
        pendingReviewCount: pendingReview.length,
        rejectedCount,
        excludedCount: excluded.length - rejectedCount,
        staleOverrideCount: staleOverrides.length,
      },
      pendingReview,
      excluded,
      staleOverrides,
    },
  };
}

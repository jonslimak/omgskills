import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Skill } from "../types.js";
import { normalizePolicySkillId } from "../../../scripts/policy-identifiers.mjs";
import {
  editoolFileRevision,
  runEditoolPolicyTransaction,
} from "../../scripts/editool-policy-transaction.js";
import { repoFromGithubUrl } from "../policy/effective-policy.js";
import { validateCutoverOutputs } from "./cutover-validation.js";
import { assertShadowPath, shadowRoot } from "./shadow-path-guard.js";
import type {
  ShadowCutoverSkillSignal,
  ShadowRepoIndex,
  ShadowRepoIndexEntry,
  ShadowRepoOverlay,
  ShadowSkillOverlay,
  ShadowSkillRecord,
} from "./types.js";

export const MANUAL_CURATION_SOURCE = "manual-curation";
export const CREATOR_BACKFILL_SOURCE = "creator-backfill";

export type ShadowSkillPersistenceSource =
  | typeof MANUAL_CURATION_SOURCE
  | typeof CREATOR_BACKFILL_SOURCE;

export type ShadowSkillPersistencePaths = {
  skillOverlay: string;
  cutoverSkills: string;
  repoOverlay: string;
  repoIndex: string;
  signals: string;
};

export type ShadowSkillPersistenceSnapshot = {
  skillOverlay: ShadowSkillOverlay;
  cutoverSkills: ShadowSkillRecord[];
  repoOverlay: ShadowRepoOverlay;
  repoIndex: ShadowRepoIndex;
  signals: ShadowCutoverSkillSignal[];
  revisions: Record<Exclude<keyof ShadowSkillPersistencePaths, "signals">, string>;
};

export type ShadowSkillPersistenceAddition = {
  skill: ShadowSkillRecord;
  repoKey: string;
  repoUrl: string;
  source: ShadowSkillPersistenceSource;
  isTrustedVendor?: boolean;
  isTrustedCreator?: boolean;
};

export type ShadowSkillPersistenceOutcome = {
  id: string;
  status: "added" | "existing" | "exact-sha-existing";
  existingId?: string;
};

export type PreparedShadowSkillPersistence = {
  next: Omit<ShadowSkillPersistenceSnapshot, "revisions">;
  outcomes: ShadowSkillPersistenceOutcome[];
};

const writableKeys = ["skillOverlay", "cutoverSkills", "repoOverlay", "repoIndex"] as const;

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

function normalizePath(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^\.\//, "").toLowerCase();
}

function sameStoredSkill(existing: Skill, addition: ShadowSkillPersistenceAddition): boolean {
  if (repoFromGithubUrl(existing.github_url) !== normalizeRepo(addition.repoKey)) return false;
  const existingPath = normalizePath(existing.skill_md_path);
  const addedPath = normalizePath(addition.skill.skill_md_path);
  return !existingPath || !addedPath || existingPath === addedPath;
}

function skillForSource(
  skill: ShadowSkillRecord,
  source: ShadowSkillPersistenceSource,
): ShadowSkillRecord {
  if (source !== CREATOR_BACKFILL_SOURCE) return skill;
  return { ...skill, source_tag: CREATOR_BACKFILL_SOURCE };
}

export function defaultShadowSkillPersistencePaths(): ShadowSkillPersistencePaths {
  return {
    skillOverlay: join(shadowRoot, "skills.overlay.json"),
    cutoverSkills: join(shadowRoot, "skills.cutover.shadow.json"),
    repoOverlay: join(shadowRoot, "repo-index.overlay.json"),
    repoIndex: join(shadowRoot, "repo-index.shadow.json"),
    signals: join(shadowRoot, "skill-signals.cutover.shadow.json"),
  };
}

export function loadShadowSkillPersistenceSnapshot(
  paths = defaultShadowSkillPersistencePaths(),
  generatedAt = new Date().toISOString(),
): ShadowSkillPersistenceSnapshot {
  return {
    skillOverlay: readJson<ShadowSkillOverlay>(paths.skillOverlay, { generatedAt, skillCount: 0, skills: [] }),
    cutoverSkills: readJson<ShadowSkillRecord[]>(paths.cutoverSkills, []),
    repoOverlay: readJson<ShadowRepoOverlay>(paths.repoOverlay, { generatedAt, repoCount: 0, repos: [] }),
    repoIndex: readJson<ShadowRepoIndex>(paths.repoIndex, { generatedAt, repoCount: 0, repos: [] }),
    signals: readJson<ShadowCutoverSkillSignal[]>(paths.signals, []),
    revisions: {
      skillOverlay: editoolFileRevision(paths.skillOverlay),
      cutoverSkills: editoolFileRevision(paths.cutoverSkills),
      repoOverlay: editoolFileRevision(paths.repoOverlay),
      repoIndex: editoolFileRevision(paths.repoIndex),
    },
  };
}

export function upsertShadowSkillOverlay(
  overlay: ShadowSkillOverlay,
  skill: ShadowSkillRecord,
  generatedAt: string,
): ShadowSkillOverlay {
  const byId = new Map(overlay.skills.map((existing) => [existing.id, existing]));
  byId.set(skill.id, skill);
  const skills = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { generatedAt, skillCount: skills.length, skills };
}

export function upsertCutoverSkill(
  skills: ShadowSkillRecord[],
  skill: ShadowSkillRecord,
): ShadowSkillRecord[] {
  const byId = new Map(skills.map((existing) => [existing.id, existing]));
  byId.set(skill.id, skill);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function upsertRepoEntry(
  repoIndex: ShadowRepoIndex,
  skill: ShadowSkillRecord,
  parsed: { repoKey: string; repoUrl: string },
  generatedAt: string,
  source: ShadowSkillPersistenceSource = MANUAL_CURATION_SOURCE,
  flags: { isTrustedVendor?: boolean; isTrustedCreator?: boolean } = {},
): ShadowRepoIndex {
  const repoKey = normalizeRepo(parsed.repoKey);
  const byRepo = new Map(repoIndex.repos.map((repo) => [normalizeRepo(repo.repo), repo]));
  const existing = byRepo.get(repoKey);
  const skillIds = sortUnique([...(existing?.skillIds ?? []), skill.id]);
  const entry: ShadowRepoIndexEntry = {
    repo: repoKey,
    repoUrl: existing?.repoUrl ?? parsed.repoUrl,
    state: existing?.state ?? "library",
    discoveredSources: sortUnique([...(existing?.discoveredSources ?? []), source]),
    skillIds,
    skillCount: skillIds.length,
    stars: Math.max(existing?.stars ?? 0, skill.stars),
    lastSeenAt: generatedAt,
    lastRefreshedAt: generatedAt,
    lastCheapCheckedAt: generatedAt,
    lastObservedRepoUpdatedAt: skill.last_updated,
    trustSignals: sortUnique(existing?.trustSignals ?? []),
    promotionReasons: sortUnique([...(existing?.promotionReasons ?? []), source]),
    staleOrInvalidState: null,
    isTrustedVendor: existing?.isTrustedVendor ?? flags.isTrustedVendor ?? false,
    isTrustedCreator: existing?.isTrustedCreator ?? flags.isTrustedCreator ?? false,
    isGoldBasketRepo: existing?.isGoldBasketRepo ?? false,
    topSkillId: existing?.topSkillId && skillIds.includes(existing.topSkillId) ? existing.topSkillId : skill.id,
    topSkillStars: Math.max(existing?.topSkillStars ?? 0, skill.stars),
  };
  byRepo.set(repoKey, entry);
  const repos = [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));
  return { generatedAt, repoCount: repos.length, repos };
}

export function prepareShadowSkillPersistence(input: {
  snapshot: ShadowSkillPersistenceSnapshot;
  additions: ShadowSkillPersistenceAddition[];
  generatedAt: string;
  dedupeExactSha?: boolean;
}): PreparedShadowSkillPersistence {
  let skillOverlay = input.snapshot.skillOverlay;
  let cutoverSkills = input.snapshot.cutoverSkills;
  let repoOverlay = input.snapshot.repoOverlay;
  let repoIndex = input.snapshot.repoIndex;
  const outcomes: ShadowSkillPersistenceOutcome[] = [];

  for (const addition of input.additions) {
    const normalizedId = normalizePolicySkillId(addition.skill.id);
    const existingById = cutoverSkills.find((skill) => normalizePolicySkillId(skill.id) === normalizedId);
    if (existingById) {
      if (!sameStoredSkill(existingById, addition)) {
        throw new Error(
          `Shadow skill id conflict for ${addition.skill.id}: existing row points to ${existingById.github_url}#${existingById.skill_md_path ?? "unknown"}.`,
        );
      }
      outcomes.push({ id: addition.skill.id, status: "existing", existingId: existingById.id });
      continue;
    }

    if (input.dedupeExactSha && addition.skill.skill_md_sha) {
      const existingBySha = cutoverSkills.find((skill) => skill.skill_md_sha === addition.skill.skill_md_sha);
      if (existingBySha) {
        outcomes.push({ id: addition.skill.id, status: "exact-sha-existing", existingId: existingBySha.id });
        continue;
      }
    }

    const skill = skillForSource(addition.skill, addition.source);
    skillOverlay = upsertShadowSkillOverlay(skillOverlay, skill, input.generatedAt);
    cutoverSkills = upsertCutoverSkill(cutoverSkills, skill);
    const repoIdentity = { repoKey: addition.repoKey, repoUrl: addition.repoUrl };
    const flags = {
      isTrustedVendor: addition.isTrustedVendor,
      isTrustedCreator: addition.isTrustedCreator,
    };
    repoOverlay = upsertRepoEntry(repoOverlay, skill, repoIdentity, input.generatedAt, addition.source, flags);
    repoIndex = upsertRepoEntry(repoIndex, skill, repoIdentity, input.generatedAt, addition.source, flags);
    outcomes.push({ id: skill.id, status: "added" });
  }

  const validationFailures = validateCutoverOutputs(cutoverSkills, input.snapshot.signals, repoIndex);
  if (validationFailures.length > 0) {
    throw new Error(`Shadow skill persistence would break cutover validation: ${validationFailures[0]?.details}`);
  }

  return {
    next: {
      skillOverlay,
      cutoverSkills,
      repoOverlay,
      repoIndex,
      signals: input.snapshot.signals,
    },
    outcomes,
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function commitShadowSkillPersistence(input: {
  snapshot: ShadowSkillPersistenceSnapshot;
  prepared: PreparedShadowSkillPersistence;
  paths?: ShadowSkillPersistencePaths;
  transactionStateDir?: string;
  assertTargetPath?: (path: string) => void;
  failAfterAppliedFiles?: number;
}): void {
  const paths = input.paths ?? defaultShadowSkillPersistencePaths();
  const assertTarget = input.assertTargetPath ?? assertShadowPath;
  for (const key of writableKeys) assertTarget(paths[key]);
  const values = {
    skillOverlay: input.prepared.next.skillOverlay,
    cutoverSkills: input.prepared.next.cutoverSkills,
    repoOverlay: input.prepared.next.repoOverlay,
    repoIndex: input.prepared.next.repoIndex,
  };
  const transactionStateDir = input.transactionStateDir ?? join(shadowRoot, ".skill-persistence-transaction");
  mkdirSync(dirname(transactionStateDir), { recursive: true });

  runEditoolPolicyTransaction({
    stateDir: transactionStateDir,
    mutations: writableKeys.map((key) => ({
      path: paths[key],
      content: json(values[key]),
      expectedRevision: input.snapshot.revisions[key],
    })),
    failAfterAppliedFiles: input.failAfterAppliedFiles,
    verifyAfterApply: () => {
      const persisted = loadShadowSkillPersistenceSnapshot(paths);
      const failures = validateCutoverOutputs(
        persisted.cutoverSkills,
        persisted.signals,
        persisted.repoIndex,
      );
      if (failures.length > 0) {
        throw new Error(`Persisted shadow state failed cutover validation: ${failures[0]?.details}`);
      }
    },
  });
}

import {
  normalizeCreatorHandle,
  type CreatorRegistryEntry,
  type CreatorSkillCoverage,
} from "../creator-registry.js";
import type { Skill } from "../types.js";
import { normalizePolicyRepo, normalizePolicySkillId } from "../../../scripts/policy-identifiers.mjs";
import { evaluateEffectiveRepoPolicy, evaluateEffectiveSkillPolicy, repoFromGithubUrl } from "../policy/effective-policy.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import { deriveSkillIdFromPath, deriveSkillPathFromId } from "./candidate-path.js";
import type { TrustedSeeds } from "./types.js";

export const CREATOR_BACKFILL_PLAN_VERSION = 4;
export const CREATOR_BACKFILL_LARGE_REPO_SKILL_LIMIT = 150;
export const CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM = 3500;
export const CREATOR_BACKFILL_QUOTA_RESERVE = 2000;

export type CreatorBackfillRepoScan = {
  creatorHandle: string;
  coverage: CreatorSkillCoverage;
  explicitlyApproved: boolean;
  repo: string;
  repoFullName: string;
  repoUrl: string;
  defaultBranch: string;
  aliases?: string[];
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  treeUnavailableReason?: "empty-repository";
  treeTruncated?: boolean;
  paths?: string[];
  pathShas?: Record<string, string>;
  excludedPathPrefixes?: string[];
};

export type CreatorBackfillPlanCandidate = {
  creator: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
  path: string;
  proposedId: string;
};

export type CreatorBackfillPlanExclusion = {
  creator: string;
  repo: string;
  path?: string;
  proposedId?: string;
  reason: string;
};

export type CreatorBackfillRepositorySummary = {
  creator: string;
  repo: string;
  discoveredSkillCount: number;
  candidateCount: number;
  excludedCount: number;
  reviewRequired: boolean;
  reasons: string[];
};

export type CreatorBackfillPlan = {
  version: number;
  complete: true;
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  quota: {
    initialRemaining: number;
    requiredAtStart: number;
    reservedForScheduledCrawler: number;
  };
  summary: {
    creatorCount: number;
    repositoryCount: number;
    discoveredSkillCount: number;
    candidateCount: number;
    excludedCount: number;
    reviewRequiredRepositoryCount: number;
  };
  creators: Array<{
    handle: string;
    repositoryCount: number;
    discoveredSkillCount: number;
    candidateCount: number;
  }>;
  repositories: CreatorBackfillRepositorySummary[];
  candidates: CreatorBackfillPlanCandidate[];
  exclusions: CreatorBackfillPlanExclusion[];
};

type ExistingSkillKeys = {
  ids: Set<string>;
  repoPaths: Set<string>;
  shas: Set<string>;
};

export function selectCreatorBackfillCoverageEntries(
  entries: CreatorRegistryEntry[],
  creatorFilters: string[],
  aliasToCanonical: ReadonlyMap<string, string>,
): CreatorRegistryEntry[] {
  const requested = new Set(
    creatorFilters.map(normalizeCreatorHandle).map((handle) => aliasToCanonical.get(handle) ?? handle),
  );
  const selected = entries
    .filter((entry) => entry.skillCoverage)
    .filter((entry) => requested.size === 0 || requested.has(normalizeCreatorHandle(entry.handle)))
    .sort((left, right) => normalizeCreatorHandle(left.handle).localeCompare(normalizeCreatorHandle(right.handle)));
  if (requested.size) {
    const found = new Set(selected.map((entry) => normalizeCreatorHandle(entry.handle)));
    const missing = [...requested].filter((handle) => !found.has(handle));
    if (missing.length) throw new Error(`No configured skill coverage for creator: ${missing.join(", ")}`);
  }
  return selected;
}

function normalizePath(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
}

function repoPathKey(repo: string, path: string): string {
  return `${normalizePolicyRepo(repo)}#${normalizePath(path)}`;
}

function normalizeSha(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function exactSkillPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md")))]
    .sort((left, right) => left.localeCompare(right));
}

const nonPublishablePathSegments = new Set([
  ".raw",
  "test",
  "tests",
  "testdata",
  "fixture",
  "fixtures",
  "examples",
  "samples",
  "partner-built",
]);

export function isCreatorBackfillPathAllowed(path: string): boolean {
  const segments = normalizePath(path).split("/").filter(Boolean);
  if (segments.some((segment) => nonPublishablePathSegments.has(segment))) return false;

  const nestedClaudeSkills = segments.findIndex((segment, index) =>
    segment === ".claude" && segments[index + 1] === "skills"
  );
  return nestedClaudeSkills < 0 || !segments.slice(0, nestedClaudeSkills).includes("skills");
}

function matchesExcludedPathPrefix(path: string, prefixes: string[]): boolean {
  const normalized = normalizePath(path);
  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizePath(prefix);
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
  });
}

function existingPath(skill: Skill): string | null {
  if (skill.skill_md_path) return skill.skill_md_path;
  const derived = deriveSkillPathFromId(skill.id);
  if (derived) return derived;
  return skill.id.includes(":") ? null : "SKILL.md";
}

function mergeCanonicalRepoScans(scans: CreatorBackfillRepoScan[]): CreatorBackfillRepoScan[] {
  const byRepo = new Map<string, CreatorBackfillRepoScan[]>();
  for (const scan of scans) {
    const repo = normalizePolicyRepo(scan.repo);
    const group = byRepo.get(repo) ?? [];
    group.push(scan);
    byRepo.set(repo, group);
  }

  return [...byRepo.entries()].map(([repo, group]) => {
    const owner = repo.split("/")[0] ?? "";
    const ranked = [...group].sort((left, right) =>
      Number(normalizeCreatorHandle(right.creatorHandle) === owner)
        - Number(normalizeCreatorHandle(left.creatorHandle) === owner)
      || normalizeCreatorHandle(left.creatorHandle).localeCompare(normalizeCreatorHandle(right.creatorHandle))
    );
    const preferred = ranked[0];
    if (!preferred) throw new Error(`Missing creator backfill scan for ${repo}`);

    const pathShas: Record<string, string> = {};
    for (const scan of ranked) {
      for (const [path, sha] of Object.entries(scan.pathShas ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        if (!(path in pathShas)) pathShas[path] = sha;
      }
    }

    const paths = [...new Set(ranked.flatMap((scan) => scan.paths ?? []))].sort();
    const aliases = [...new Set(ranked.flatMap((scan) => scan.aliases ?? []).map(normalizePolicyRepo))].sort();
    const excludedPathPrefixes = [...new Set(ranked.flatMap((scan) => scan.excludedPathPrefixes ?? []))].sort();
    const allTreesUnavailable = ranked.every((scan) => scan.treeUnavailableReason !== undefined);

    return {
      ...preferred,
      repo,
      explicitlyApproved: ranked.some((scan) => scan.explicitlyApproved),
      aliases,
      archived: ranked.some((scan) => scan.archived),
      disabled: ranked.some((scan) => scan.disabled),
      fork: ranked.some((scan) => scan.fork),
      treeUnavailableReason: allTreesUnavailable ? preferred.treeUnavailableReason : undefined,
      treeTruncated: ranked.some((scan) => scan.treeTruncated),
      paths,
      pathShas,
      excludedPathPrefixes,
    };
  });
}

export function buildExistingSkillKeys(
  skills: Skill[],
  repoAliases: ReadonlyMap<string, string> = new Map(),
): ExistingSkillKeys {
  const ids = new Set<string>();
  const repoPaths = new Set<string>();
  const shas = new Set<string>();
  for (const skill of skills) {
    ids.add(normalizePolicySkillId(skill.id));
    const sha = normalizeSha(skill.skill_md_sha);
    if (sha) shas.add(sha);
    const repo = repoFromGithubUrl(skill.github_url);
    const path = existingPath(skill);
    if (!repo || !path) continue;
    repoPaths.add(repoPathKey(repoAliases.get(repo) ?? repo, path));
  }
  return { ids, repoPaths, shas };
}

function exclusion(
  scan: CreatorBackfillRepoScan,
  reason: string,
  path?: string,
  proposedId?: string,
): CreatorBackfillPlanExclusion {
  return {
    creator: scan.creatorHandle,
    repo: normalizePolicyRepo(scan.repo),
    ...(path ? { path } : {}),
    ...(proposedId ? { proposedId } : {}),
    reason,
  };
}

export function buildCreatorBackfillPlan(input: {
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  initialQuotaRemaining: number;
  scans: CreatorBackfillRepoScan[];
  existingSkills: Skill[];
  seeds: TrustedSeeds;
}): CreatorBackfillPlan {
  const scans = mergeCanonicalRepoScans(input.scans).sort((left, right) =>
    left.creatorHandle.localeCompare(right.creatorHandle)
      || normalizePolicyRepo(left.repo).localeCompare(normalizePolicyRepo(right.repo))
  );
  const aliasPairs = scans.flatMap((scan) =>
    (scan.aliases ?? []).map((alias) => [normalizePolicyRepo(alias), normalizePolicyRepo(scan.repo)] as const)
  );
  const existing = buildExistingSkillKeys(input.existingSkills, new Map(aliasPairs));
  const candidates: CreatorBackfillPlanCandidate[] = [];
  const candidateIds = new Set<string>();
  const candidateRepoShas = new Set<string>();
  const exclusions: CreatorBackfillPlanExclusion[] = [];
  const repositories: CreatorBackfillRepositorySummary[] = [];

  for (const scan of scans) {
    const repo = normalizePolicyRepo(scan.repo);
    const reasons = new Set<string>();
    const paths = exactSkillPaths(scan.paths ?? []);
    let reviewRequired = false;
    const startExclusions = exclusions.length;
    const startCandidates = candidates.length;

    const repoPolicy = evaluateEffectiveRepoPolicy(repo, input.seeds);
    let blockedReason: string | null = null;
    if (scan.archived) blockedReason = "archived-repo";
    else if (scan.disabled) blockedReason = "disabled-repo";
    else if (scan.fork) blockedReason = "fork-repo";
    else if (scan.treeUnavailableReason) blockedReason = scan.treeUnavailableReason;
    else if (repoPolicy.excluded) blockedReason = repoPolicy.reasonCode ?? "repo-policy";
    else if (isKnownCatalogRepo(repo, input.seeds.catalogRepoRules)) blockedReason = "catalog-repo";

    if (blockedReason) {
      reasons.add(blockedReason);
      exclusions.push(exclusion(scan, blockedReason));
    } else if (scan.treeTruncated) {
      reviewRequired = true;
      reasons.add("truncated-tree");
      exclusions.push(exclusion(scan, "review-required-truncated-tree"));
    } else if (paths.length > CREATOR_BACKFILL_LARGE_REPO_SKILL_LIMIT && !scan.explicitlyApproved) {
      reviewRequired = true;
      reasons.add("large-repo-review");
      exclusions.push(exclusion(scan, `review-required-over-${CREATOR_BACKFILL_LARGE_REPO_SKILL_LIMIT}-skills`));
    } else {
      for (const path of paths) {
        const proposedId = deriveSkillIdFromPath(scan.repoFullName, path);
        if (matchesExcludedPathPrefix(path, scan.excludedPathPrefixes ?? [])) {
          reasons.add("creator-path-excluded");
          exclusions.push(exclusion(scan, "creator-path-excluded", path, proposedId));
          continue;
        }
        if (!isCreatorBackfillPathAllowed(path)) {
          reasons.add("non-publishable-path");
          exclusions.push(exclusion(scan, "non-publishable-path", path, proposedId));
          continue;
        }
        const normalizedId = normalizePolicySkillId(proposedId);
        if (existing.ids.has(normalizedId) || existing.repoPaths.has(repoPathKey(repo, path))) {
          reasons.add("already-present");
          exclusions.push(exclusion(scan, "already-present", path, proposedId));
          continue;
        }
        const blobSha = normalizeSha(scan.pathShas?.[path]);
        if (blobSha && existing.shas.has(blobSha)) {
          reasons.add("exact-sha-present");
          exclusions.push(exclusion(scan, "exact-sha-present", path, proposedId));
          continue;
        }
        const skillPolicy = evaluateEffectiveSkillPolicy({ id: proposedId, github_url: scan.repoUrl }, input.seeds);
        if (skillPolicy.excluded) {
          const reason = skillPolicy.reasonCode ?? "skill-policy";
          reasons.add(reason);
          exclusions.push(exclusion(scan, reason, path, proposedId));
          continue;
        }
        const repoShaKey = blobSha ? `${repo}#${blobSha}` : "";
        if (repoShaKey && candidateRepoShas.has(repoShaKey)) {
          reasons.add("duplicate-plan-sha");
          exclusions.push(exclusion(scan, "duplicate-plan-sha", path, proposedId));
          continue;
        }
        if (candidateIds.has(normalizedId)) {
          reasons.add("duplicate-plan-candidate");
          exclusions.push(exclusion(scan, "duplicate-plan-candidate", path, proposedId));
          continue;
        }
        candidateIds.add(normalizedId);
        if (repoShaKey) candidateRepoShas.add(repoShaKey);
        candidates.push({
          creator: scan.creatorHandle,
          repo,
          repoUrl: scan.repoUrl,
          defaultBranch: scan.defaultBranch,
          path,
          proposedId,
        });
      }
    }

    repositories.push({
      creator: scan.creatorHandle,
      repo,
      discoveredSkillCount: paths.length,
      candidateCount: candidates.length - startCandidates,
      excludedCount: exclusions.length - startExclusions,
      reviewRequired,
      reasons: [...reasons].sort(),
    });
  }

  candidates.sort((left, right) =>
    left.creator.localeCompare(right.creator)
      || left.repo.localeCompare(right.repo)
      || left.path.localeCompare(right.path)
  );
  exclusions.sort((left, right) =>
    left.creator.localeCompare(right.creator)
      || left.repo.localeCompare(right.repo)
      || (left.path ?? "").localeCompare(right.path ?? "")
      || left.reason.localeCompare(right.reason)
  );
  const creatorHandles = [...new Set(repositories.map((repo) => repo.creator))].sort();
  const creators = creatorHandles.map((handle) => {
    const creatorRepos = repositories.filter((repo) => repo.creator === handle);
    return {
      handle,
      repositoryCount: creatorRepos.length,
      discoveredSkillCount: creatorRepos.reduce((sum, repo) => sum + repo.discoveredSkillCount, 0),
      candidateCount: creatorRepos.reduce((sum, repo) => sum + repo.candidateCount, 0),
    };
  });

  return {
    version: CREATOR_BACKFILL_PLAN_VERSION,
    complete: true,
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    policyDigest: input.policyDigest,
    quota: {
      initialRemaining: input.initialQuotaRemaining,
      requiredAtStart: CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM,
      reservedForScheduledCrawler: CREATOR_BACKFILL_QUOTA_RESERVE,
    },
    summary: {
      creatorCount: creators.length,
      repositoryCount: repositories.length,
      discoveredSkillCount: repositories.reduce((sum, repo) => sum + repo.discoveredSkillCount, 0),
      candidateCount: candidates.length,
      excludedCount: exclusions.length,
      reviewRequiredRepositoryCount: repositories.filter((repo) => repo.reviewRequired).length,
    },
    creators,
    repositories,
    candidates,
    exclusions,
  };
}

export async function executeCreatorBackfillPlan(input: {
  preflight: () => Promise<number>;
  collectScans: () => Promise<CreatorBackfillRepoScan[]>;
  build: (initialQuotaRemaining: number, scans: CreatorBackfillRepoScan[]) => CreatorBackfillPlan;
  write: (plan: CreatorBackfillPlan) => void;
}): Promise<CreatorBackfillPlan> {
  const initialQuotaRemaining = await input.preflight();
  const scans = await input.collectScans();
  const plan = input.build(initialQuotaRemaining, scans);
  input.write(plan);
  return plan;
}

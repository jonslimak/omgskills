import type { Candidate, EnrichResult } from "../enrich.js";
import type { Skill } from "../types.js";
import { deriveSkillIdFromPath } from "./candidate-path.js";
import type { BootstrapRepoSample, BootstrapSource, RebootstrapEligibleRepoSample, RepoBootstrapCandidate, ShadowCadence, ShadowRepoIndex } from "./types.js";

export const TRUSTED_CREATOR_FALLBACK_ATTEMPT_LIMIT = 10;

const BOOTSTRAP_SOURCE_PRIORITY: Record<BootstrapSource, number> = {
  official: 0,
  skillssh: 1,
  awesome: 2,
  registry: 3,
  "creator-watch": 4,
  "x-social": 5,
  code: 6,
};

export function repairDeadPersistedRisingSkillLinks(
  repoIndex: ShadowRepoIndex,
  availableSkillIds: Set<string>,
): {
  repairedRepoSample: RebootstrapEligibleRepoSample[];
  preservedFirstSeen: Map<string, string>;
} {
  const repaired: RebootstrapEligibleRepoSample[] = [];
  const preservedFirstSeen = new Map<string, string>();

  for (const repo of repoIndex.repos) {
    if (repo.state !== "rising") continue;
    if (repo.skillIds.length === 0) continue;
    if (repo.skillIds.some((id) => availableSkillIds.has(id))) continue;
    const preservedDate = repo.lastSeenAt.slice(0, 10);

    repaired.push({
      repo: repo.repo,
      missingSkillIds: [...repo.skillIds],
    });
    for (const skillId of repo.skillIds) {
      if (!preservedFirstSeen.has(skillId)) {
        preservedFirstSeen.set(skillId, preservedDate);
      }
    }
    repo.skillIds = [];
    repo.skillCount = 0;
    repo.topSkillId = null;
    repo.topSkillStars = 0;
  }

  return {
    repairedRepoSample: repaired,
    preservedFirstSeen,
  };
}

export function isBootstrapEligibleCandidate(candidate: RepoBootstrapCandidate): boolean {
  if (candidate.source === "registry" || candidate.source === "code") return true;
  if (candidate.source === "official") return candidate.skill_md_path !== "__RESOLVE__";
  if (candidate.source === "skillssh" || candidate.source === "awesome") return candidate.skill_md_path !== "__RESOLVE__";
  if (candidate.source === "creator-watch") return candidate.skill_md_path !== "__RESOLVE__";
  if (candidate.source === "x-social") return candidate.skill_md_path !== "__RESOLVE__";
  return false;
}

export function selectBetterBootstrapCandidate(
  current: RepoBootstrapCandidate | undefined,
  next: RepoBootstrapCandidate,
): RepoBootstrapCandidate {
  if (!current) return next;
  const currentRank = BOOTSTRAP_SOURCE_PRIORITY[current.source];
  const nextRank = BOOTSTRAP_SOURCE_PRIORITY[next.source];
  if (nextRank < currentRank) return next;
  if (nextRank > currentRank) return current;
  const currentStars = current.stars ?? 0;
  const nextStars = next.stars ?? 0;
  if (nextStars > currentStars) return next;
  if (nextStars < currentStars) return current;
  return next.id.localeCompare(current.id) < 0 ? next : current;
}

export function sortBootstrapCandidates(candidates: RepoBootstrapCandidate[]): RepoBootstrapCandidate[] {
  const byKey = new Map<string, RepoBootstrapCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.id.toLowerCase()}\n${candidate.skill_md_path.toLowerCase()}`;
    const current = byKey.get(key);
    byKey.set(key, current ? selectBetterBootstrapCandidate(current, candidate) : candidate);
  }
  return [...byKey.values()].sort((left, right) => {
    const preferred = selectBetterBootstrapCandidate(left, right);
    if (preferred === left && preferred !== right) return -1;
    if (preferred === right && preferred !== left) return 1;
    return left.id.localeCompare(right.id);
  });
}

export function toEnrichCandidate(candidate: RepoBootstrapCandidate): Candidate {
  return {
    id: candidate.id,
    skill_md_path: candidate.skill_md_path,
    skill_name_hint: candidate.skill_name_hint,
    ref: candidate.ref,
    github_url: candidate.github_url,
    stars: candidate.stars,
    last_updated: candidate.last_updated,
    tags: candidate.tags,
  };
}

function isSkillPath(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

function fallbackPathRank(path: string): number {
  if (path === "SKILL.md") return 0;
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) return 1;
  if (!path.split("/").some((part) => part.startsWith("."))) return 2;
  return 3;
}

export function buildTrustedCreatorFallbackCandidates(
  repo: string,
  candidate: RepoBootstrapCandidate,
  paths: string[],
): RepoBootstrapCandidate[] {
  const sourceRepoId = candidate.id.split(":", 1)[0]?.trim() || repo;
  return [...new Set(paths)]
    .filter(isSkillPath)
    .sort((left, right) =>
      fallbackPathRank(left) - fallbackPathRank(right) ||
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right),
    )
    .map((path) => ({
      ...candidate,
      id: deriveSkillIdFromPath(sourceRepoId, path),
      skill_md_path: path,
      skill_name_hint: path === "SKILL.md" ? candidate.skill_name_hint : path.split("/").at(-2),
    }));
}

function repoKeyFromGithubUrl(githubUrl: string): string | null {
  const match = githubUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return null;
  return `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`;
}

function skillBelongsToRepo(skill: Skill, repo: string): boolean {
  return repoKeyFromGithubUrl(skill.github_url) === repo.toLowerCase();
}

export function removeFailedNewlyAdmittedRepos(repoIndex: ShadowRepoIndex, newlyAdmittedRepos: Set<string>): string[] {
  const removed: string[] = [];
  repoIndex.repos = repoIndex.repos.filter((repo) => {
    const isAdmissionEntry = newlyAdmittedRepos.has(repo.repo) || repo.promotionReasons.includes("library-admission");
    if (!isAdmissionEntry) return true;
    if (repo.skillIds.length > 0) return true;
    removed.push(repo.repo);
    return false;
  });
  repoIndex.repoCount = repoIndex.repos.length;
  return removed.sort();
}

type BootstrapOptions = {
  cadence: ShadowCadence;
  checkedAt: string;
  repoIndex: ShadowRepoIndex;
  bootstrapCandidateByRepo: Map<string, RepoBootstrapCandidate>;
  existingFirstSeen: Map<string, string>;
  existingSkills: Map<string, Skill>;
  newlyAdmittedRepos?: Set<string>;
  resolveCandidatePathFn: (candidate: RepoBootstrapCandidate) => Promise<string | null>;
  listCandidatePathsFn?: (repo: string, candidate: RepoBootstrapCandidate) => Promise<string[]>;
  fallbackCandidateRejectionFn?: (repo: string, candidate: RepoBootstrapCandidate) => string | null;
  enrichCandidateFn: (
    candidate: Candidate,
    existingFirstSeen: Map<string, string>,
    existingSkills: Map<string, Skill>,
    today: string,
  ) => Promise<EnrichResult>;
};

type BootstrapResult = {
  bootstrappedSkills: Skill[];
  bootstrappedRepoSample: BootstrapRepoSample[];
  bootstrapFailedRepoSample: BootstrapRepoSample[];
  bootstrapSkippedRepoSample: BootstrapRepoSample[];
};

export async function bootstrapRisingRepos({
  cadence,
  checkedAt,
  repoIndex,
  bootstrapCandidateByRepo,
  existingFirstSeen,
  existingSkills,
  newlyAdmittedRepos = new Set(),
  resolveCandidatePathFn,
  listCandidatePathsFn,
  fallbackCandidateRejectionFn,
  enrichCandidateFn,
}: BootstrapOptions): Promise<BootstrapResult> {
  if (cadence !== "combined") {
    return {
      bootstrappedSkills: [],
      bootstrappedRepoSample: [],
      bootstrapFailedRepoSample: [],
      bootstrapSkippedRepoSample: [],
    };
  }

  const today = checkedAt.slice(0, 10);
  const bootstrappedSkills: Skill[] = [];
  const bootstrappedRepoSample: BootstrapRepoSample[] = [];
  const bootstrapFailedRepoSample: BootstrapRepoSample[] = [];
  const bootstrapSkippedRepoSample: BootstrapRepoSample[] = [];

  const eligibleRepos = repoIndex.repos
    .filter((repo) => repo.state !== "core" && repo.skillIds.length === 0)
    .sort((a, b) => a.repo.localeCompare(b.repo));

  for (const repo of eligibleRepos) {
    const candidate = bootstrapCandidateByRepo.get(repo.repo);
    if (!candidate) continue;
    let resolvedCandidate = candidate;
    const resolvesDiscoveryPath =
      candidate.source === "skillssh" || candidate.source === "awesome" || candidate.source === "official";
    if (resolvesDiscoveryPath && candidate.skill_md_path === "__RESOLVE__") {
      // Discovery lists can reference deleted/renamed repos (e.g. stale official-page
      // entries); a failed lookup means unresolvable, not a failed crawl.
      const resolvedPath = await resolveCandidatePathFn(candidate).catch(() => null);
      if (resolvedPath) {
        resolvedCandidate = {
          ...candidate,
          skill_md_path: resolvedPath,
        };
      }
    }

    const candidatesToTry: Array<{ candidate: RepoBootstrapCandidate; fallbackUsed: boolean }> = [];
    if (isBootstrapEligibleCandidate(resolvedCandidate)) {
      candidatesToTry.push({ candidate: resolvedCandidate, fallbackUsed: false });
    } else if (
      resolvesDiscoveryPath &&
      candidate.skill_md_path === "__RESOLVE__" &&
      newlyAdmittedRepos.has(repo.repo) &&
      repo.isTrustedCreator &&
      listCandidatePathsFn &&
      fallbackCandidateRejectionFn
    ) {
      const paths = await listCandidatePathsFn(repo.repo, candidate).catch(() => []);
      candidatesToTry.push(
        ...buildTrustedCreatorFallbackCandidates(repo.repo, candidate, paths)
          .map((fallbackCandidate) => ({ candidate: fallbackCandidate, fallbackUsed: true })),
      );
    }

    if (candidatesToTry.length === 0) {
      bootstrapSkippedRepoSample.push({
        repo: repo.repo,
        source: resolvedCandidate.source,
        candidateId: resolvedCandidate.id,
        outcome: "skipped",
        failureReason: "no-eligible-candidate",
      });
      continue;
    }

    let fallbackAttempts = 0;
    let lastFailureReason = "enrich-failed";
    let lastCandidate = candidatesToTry[0]!;
    let policyRejectionReason: string | null = null;
    let bootstrapped = false;

    for (const candidateAttempt of candidatesToTry) {
      if (candidateAttempt.fallbackUsed) {
        policyRejectionReason = fallbackCandidateRejectionFn
          ? fallbackCandidateRejectionFn(repo.repo, candidateAttempt.candidate)
          : "policy-validation-unavailable";
        if (policyRejectionReason) continue;
        if (fallbackAttempts >= TRUSTED_CREATOR_FALLBACK_ATTEMPT_LIMIT) break;
        fallbackAttempts += 1;
      }
      lastCandidate = candidateAttempt;

      const result = await enrichCandidateFn(
        toEnrichCandidate(candidateAttempt.candidate),
        existingFirstSeen,
        existingSkills,
        today,
      );
      if (!result.skill || !skillBelongsToRepo(result.skill, repo.repo)) {
        lastFailureReason = result.skill ? "repo-mismatch" : result.failure?.reason ?? "enrich-failed";
        continue;
      }

      repo.skillIds = [result.skill.id];
      repo.skillCount = 1;
      repo.topSkillId = result.skill.id;
      repo.topSkillStars = result.skill.stars;
      repo.repoUrl = result.skill.github_url;
      repo.stars = result.skill.stars;
      repo.lastRefreshedAt = checkedAt;
      existingSkills.set(result.skill.id, result.skill);
      bootstrappedSkills.push(result.skill);
      bootstrappedRepoSample.push({
        repo: repo.repo,
        source: candidateAttempt.candidate.source,
        candidateId: candidateAttempt.candidate.id,
        outcome: "bootstrapped",
        ...(candidateAttempt.fallbackUsed ? { fallbackUsed: true } : {}),
      });
      bootstrapped = true;
      break;
    }

    if (bootstrapped) continue;

    if (fallbackAttempts === 0 && candidatesToTry.every((row) => row.fallbackUsed)) {
      bootstrapSkippedRepoSample.push({
        repo: repo.repo,
        source: candidate.source,
        candidateId: candidate.id,
        outcome: "skipped",
        failureReason: policyRejectionReason ?? "no-eligible-candidate",
        fallbackUsed: true,
      });
      continue;
    }

    bootstrapFailedRepoSample.push({
      repo: repo.repo,
      source: lastCandidate.candidate.source,
      candidateId: lastCandidate.candidate.id,
      outcome: "failed",
      failureReason: lastFailureReason,
      ...(lastCandidate.fallbackUsed ? { fallbackUsed: true } : {}),
    });
  }

  return {
    bootstrappedSkills,
    bootstrappedRepoSample,
    bootstrapFailedRepoSample,
    bootstrapSkippedRepoSample,
  };
}

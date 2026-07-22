import type { Candidate, EnrichResult } from "../enrich.js";
import type { Skill } from "../types.js";
import type { BootstrapRepoSample, BootstrapSource, RebootstrapEligibleRepoSample, RepoBootstrapCandidate, ShadowCadence, ShadowRepoIndex } from "./types.js";

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
  repoAliasByCanonical: Map<string, string>;
  existingFirstSeen: Map<string, string>;
  existingSkills: Map<string, Skill>;
  resolveCandidatePathFn: (candidate: RepoBootstrapCandidate) => Promise<string | null>;
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
  repoAliasByCanonical,
  existingFirstSeen,
  existingSkills,
  resolveCandidatePathFn,
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
    const aliasRepo = repoAliasByCanonical.get(repo.repo);
    const candidate = bootstrapCandidateByRepo.get(repo.repo) ?? (aliasRepo ? bootstrapCandidateByRepo.get(aliasRepo) : undefined);
    if (!candidate) continue;
    let resolvedCandidate = candidate;
    if ((candidate.source === "skillssh" || candidate.source === "awesome" || candidate.source === "official") && candidate.skill_md_path === "__RESOLVE__") {
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
    if (!isBootstrapEligibleCandidate(resolvedCandidate)) {
      bootstrapSkippedRepoSample.push({
        repo: repo.repo,
        source: resolvedCandidate.source,
        candidateId: resolvedCandidate.id,
        outcome: "skipped",
        failureReason: "no-eligible-candidate",
      });
      continue;
    }

    const result = await enrichCandidateFn(toEnrichCandidate(resolvedCandidate), existingFirstSeen, existingSkills, today);
    if (result.skill && skillBelongsToRepo(result.skill, repo.repo)) {
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
        source: resolvedCandidate.source,
        candidateId: resolvedCandidate.id,
        outcome: "bootstrapped",
      });
      continue;
    }

    bootstrapFailedRepoSample.push({
      repo: repo.repo,
      source: resolvedCandidate.source,
      candidateId: resolvedCandidate.id,
      outcome: "failed",
      failureReason: result.skill ? "repo-mismatch" : result.failure?.reason ?? "enrich-failed",
    });
  }

  return {
    bootstrappedSkills,
    bootstrappedRepoSample,
    bootstrapFailedRepoSample,
    bootstrapSkippedRepoSample,
  };
}

import type { Candidate, EnrichResult } from "../enrich.js";
import type { Skill } from "../types.js";
import type { BootstrapRepoSample, BootstrapSource, RepoBootstrapCandidate, ShadowCadence, ShadowRepoIndex } from "./types.js";

const BOOTSTRAP_SOURCE_PRIORITY: Record<BootstrapSource, number> = {
  official: 0,
  skillssh: 1,
  awesome: 2,
  registry: 3,
  code: 4,
};

export function isBootstrapEligibleCandidate(candidate: RepoBootstrapCandidate): boolean {
  if (candidate.source === "registry" || candidate.source === "code") return true;
  if (candidate.source === "official") return candidate.skill_md_path !== "__RESOLVE__";
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

type BootstrapOptions = {
  cadence: ShadowCadence;
  checkedAt: string;
  repoIndex: ShadowRepoIndex;
  bootstrapCandidateByRepo: Map<string, RepoBootstrapCandidate>;
  repoAliasByCanonical: Map<string, string>;
  existingFirstSeen: Map<string, string>;
  existingSkills: Map<string, Skill>;
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
    .filter((repo) => repo.state === "rising" && repo.skillIds.length === 0)
    .sort((a, b) => a.repo.localeCompare(b.repo));

  for (const repo of eligibleRepos) {
    const aliasRepo = repoAliasByCanonical.get(repo.repo);
    const candidate = bootstrapCandidateByRepo.get(repo.repo) ?? (aliasRepo ? bootstrapCandidateByRepo.get(aliasRepo) : undefined);
    if (!candidate) continue;
    if (!isBootstrapEligibleCandidate(candidate)) {
      bootstrapSkippedRepoSample.push({
        repo: repo.repo,
        source: candidate.source,
        candidateId: candidate.id,
        outcome: "skipped",
        failureReason: "no-eligible-candidate",
      });
      continue;
    }

    const result = await enrichCandidateFn(toEnrichCandidate(candidate), existingFirstSeen, existingSkills, today);
    if (result.skill) {
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
        source: candidate.source,
        candidateId: candidate.id,
        outcome: "bootstrapped",
      });
      continue;
    }

    bootstrapFailedRepoSample.push({
      repo: repo.repo,
      source: candidate.source,
      candidateId: candidate.id,
      outcome: "failed",
      failureReason: result.failure?.reason ?? "enrich-failed",
    });
  }

  return {
    bootstrappedSkills,
    bootstrappedRepoSample,
    bootstrapFailedRepoSample,
    bootstrapSkippedRepoSample,
  };
}

import { existsSync, readFileSync } from "node:fs";
import { repoFromGithubUrl, repoFromSkillId } from "./do-not-crawl.js";
import type { RepoBootstrapCandidate, ShadowRepoIndex, ShadowSkillRecord } from "./types.js";

export const X_SOCIAL_MIN_STARS = 50;

type TopSkillTweet = {
  valid_skill_repos?: Array<{
    id?: string;
    github_url?: string;
    skill_md_path?: string;
    name?: string;
    description?: string;
    stars?: number;
  }>;
};

export type XSocialDiscoveryCandidate = {
  repo: string;
  repoUrl: string;
  stars: number;
  candidate: RepoBootstrapCandidate;
};

export type XSocialDiscoveryResult = {
  candidates: XSocialDiscoveryCandidate[];
  skippedCount: number;
  warning: string | null;
};

function normalizeRepoId(value: string | undefined): string | null {
  if (!value) return null;
  const [owner, repo] = value.trim().replace(/\.git$/i, "").split("/");
  if (!owner || !repo) return null;
  return `${owner}/${repo}`.toLowerCase();
}

function repoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

function candidateId(repo: string, path: string): string {
  if (path === "SKILL.md") return repo;
  const parts = path.split("/");
  const skillName = parts[parts.length - 2] ?? "skill";
  return `${repo}:${skillName}`;
}

export function buildXSocialDiscoveryCandidates(tweets: TopSkillTweet[]): XSocialDiscoveryResult {
  const byKey = new Map<string, XSocialDiscoveryCandidate>();
  let skippedCount = 0;

  for (const tweet of tweets) {
    for (const hit of tweet.valid_skill_repos ?? []) {
      const repo = normalizeRepoId(hit.id);
      const path = hit.skill_md_path?.trim();
      if (!repo || !path || path === "__RESOLVE__") {
        skippedCount += 1;
        continue;
      }

      const stars = typeof hit.stars === "number" ? hit.stars : 0;
      if (stars < X_SOCIAL_MIN_STARS) {
        skippedCount += 1;
        continue;
      }

      const key = `${repo}::${path.toLowerCase()}`;
      const next: XSocialDiscoveryCandidate = {
        repo,
        repoUrl: repoUrl(repo),
        stars,
        candidate: {
          source: "x-social",
          id: candidateId(repo, path),
          skill_md_path: path,
          skill_name_hint: hit.name,
          github_url: repoUrl(repo),
          stars,
          tags: ["x-social"],
        },
      };

      const current = byKey.get(key);
      if (!current || next.stars > current.stars || next.candidate.id.localeCompare(current.candidate.id) < 0) {
        byKey.set(key, next);
      }
    }
  }

  return {
    candidates: [...byKey.values()].sort((a, b) => a.repo.localeCompare(b.repo) || a.candidate.skill_md_path.localeCompare(b.candidate.skill_md_path)),
    skippedCount,
    warning: null,
  };
}

export function loadXSocialDiscoveryCandidates(path: string): XSocialDiscoveryResult {
  if (!existsSync(path)) {
    return {
      candidates: [],
      skippedCount: 0,
      warning: `x-social discovery skipped: missing ${path}`,
    };
  }

  const tweets = JSON.parse(readFileSync(path, "utf8")) as TopSkillTweet[];
  return buildXSocialDiscoveryCandidates(tweets);
}

export function removeBelowStarXSocialOnlyState(
  repoIndex: ShadowRepoIndex,
  skills: ShadowSkillRecord[],
): {
  skills: ShadowSkillRecord[];
  removedRepos: string[];
} {
  const removedRepos = new Set(
    repoIndex.repos
      .filter(
        (repo) =>
          repo.stars < X_SOCIAL_MIN_STARS &&
          repo.discoveredSources.includes("x-social") &&
          repo.promotionReasons.includes("library-admission") &&
          !repo.isTrustedVendor &&
          !repo.isTrustedCreator &&
          !repo.isGoldBasketRepo,
      )
      .map((repo) => repo.repo),
  );

  if (removedRepos.size === 0) {
    return { skills, removedRepos: [] };
  }

  repoIndex.repos = repoIndex.repos.filter((repo) => !removedRepos.has(repo.repo));
  repoIndex.repoCount = repoIndex.repos.length;

  return {
    skills: skills.filter((skill) => {
      const idRepo = repoFromSkillId(skill.id);
      const urlRepo = repoFromGithubUrl(skill.github_url);
      return !removedRepos.has(idRepo) && (!urlRepo || !removedRepos.has(urlRepo));
    }),
    removedRepos: [...removedRepos].sort(),
  };
}

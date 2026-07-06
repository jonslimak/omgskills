import { octokit } from "../client.js";
import { isHighStarBackfillPathAllowed } from "../sources/code.js";

export type CreatorWatchRepo = {
  repo: string;
  repoUrl: string;
  stars: number;
  defaultBranch: string;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
};

export type CreatorWatchHit = CreatorWatchRepo & {
  path: string;
};

export type CreatorWatchResult = {
  checkedOwnerCount: number;
  discoveredRepoCount: number;
  hits: CreatorWatchHit[];
};

export type CreatorWatchOptions = {
  watchedHandles: Iterable<string>;
  existingRepos?: ReadonlySet<string>;
  maxOwners?: number;
  maxReposPerOwner?: number;
  listReposForOwnerFn?: (owner: string, maxRepos: number) => Promise<CreatorWatchRepo[]>;
  listSkillPathsForRepoFn?: (repo: CreatorWatchRepo) => Promise<string[]>;
};

const DEFAULT_MAX_OWNERS = 5;
const DEFAULT_MAX_REPOS_PER_OWNER = 10;

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

function sortSkillPaths(paths: string[]): string[] {
  return [...paths].filter(isHighStarBackfillPathAllowed).sort((a, b) => a.localeCompare(b));
}

async function listReposForOwner(owner: string, maxRepos: number): Promise<CreatorWatchRepo[]> {
  const response = await octokit.rest.repos.listForUser({
    username: owner,
    sort: "created",
    direction: "desc",
    per_page: Math.min(maxRepos, 100),
  });

  return response.data.map((repo) => ({
    repo: normalizeRepo(repo.full_name ?? `${owner}/${repo.name}`),
    repoUrl: repo.html_url,
    stars: repo.stargazers_count ?? 0,
    defaultBranch: repo.default_branch ?? "main",
    archived: Boolean(repo.archived),
    disabled: Boolean(repo.disabled),
    fork: Boolean(repo.fork),
  }));
}

async function listSkillPathsForRepo(repo: CreatorWatchRepo): Promise<string[]> {
  const [owner, repoName] = repo.repo.split("/");
  if (!owner || !repoName) return [];
  const response = await octokit.rest.git.getTree({
    owner,
    repo: repoName,
    tree_sha: repo.defaultBranch,
    recursive: "true",
  });

  return response.data.tree
    .map((item) => item.path ?? "")
    .filter(Boolean);
}

export async function searchCreatorWatchRepos(options: CreatorWatchOptions): Promise<CreatorWatchResult> {
  const maxOwners = options.maxOwners ?? DEFAULT_MAX_OWNERS;
  const maxReposPerOwner = options.maxReposPerOwner ?? DEFAULT_MAX_REPOS_PER_OWNER;
  const existingRepos = options.existingRepos ?? new Set<string>();
  const listRepos = options.listReposForOwnerFn ?? listReposForOwner;
  const listPaths = options.listSkillPathsForRepoFn ?? listSkillPathsForRepo;
  const owners = [...new Set([...options.watchedHandles].map(normalizeHandle).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, maxOwners);
  const hits: CreatorWatchHit[] = [];

  for (const owner of owners) {
    const repos = await listRepos(owner, maxReposPerOwner);
    for (const repo of repos.slice(0, maxReposPerOwner)) {
      const repoKey = normalizeRepo(repo.repo);
      if (!repoKey || existingRepos.has(repoKey)) continue;
      if (repo.archived || repo.disabled || repo.fork) continue;
      let paths: string[];
      try {
        paths = sortSkillPaths(await listPaths({ ...repo, repo: repoKey }));
      } catch {
        continue;
      }
      const path = paths[0];
      if (!path) continue;
      hits.push({ ...repo, repo: repoKey, path });
    }
  }

  return {
    checkedOwnerCount: owners.length,
    discoveredRepoCount: hits.length,
    hits,
  };
}

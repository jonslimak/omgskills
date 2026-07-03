import type { ShadowRepoIndex, ShadowSkillRecord, TrustedSeeds } from "./types.js";

export function normalizeRepoKey(value: string): string {
  return value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").toLowerCase();
}

export function ownerFromRepo(repo: string): string {
  return normalizeRepoKey(repo).split("/")[0] ?? "";
}

export function repoFromSkillId(id: string): string {
  return normalizeRepoKey(id.includes(":") ? id.split(":")[0]! : id);
}

export function isDoNotCrawlRepo(repo: string, seeds: TrustedSeeds): boolean {
  const normalized = normalizeRepoKey(repo);
  return Boolean(seeds.doNotCrawlRepos?.has(normalized) || seeds.doNotCrawlOwners?.has(ownerFromRepo(normalized)));
}

export function filterDoNotCrawlSkills<T extends { id: string }>(skills: T[], seeds: TrustedSeeds): T[] {
  return skills.filter((skill) => !isDoNotCrawlRepo(repoFromSkillId(skill.id), seeds));
}

export function removeDoNotCrawlReposFromIndex(repoIndex: ShadowRepoIndex, seeds: TrustedSeeds): void {
  repoIndex.repos = repoIndex.repos.filter((repo) => !isDoNotCrawlRepo(repo.repo, seeds));
  repoIndex.repoCount = repoIndex.repos.length;
}

export function removeDoNotCrawlState(
  repoIndex: ShadowRepoIndex,
  skills: ShadowSkillRecord[],
  seeds: TrustedSeeds,
): ShadowSkillRecord[] {
  removeDoNotCrawlReposFromIndex(repoIndex, seeds);
  return filterDoNotCrawlSkills(skills, seeds);
}

export type SuppressedSkillEntry = { id: string; reason: string; stagedAt: string };
export type DoNotCrawlRepoEntry = { repo: string; reason: string; notes?: string };
export type DoNotCrawlOwnerEntry = { owner: string; reason: string; notes?: string };

export type RemovalsSource = {
  suppressedSkills: { skills: SuppressedSkillEntry[] };
  doNotCrawl: { repos: DoNotCrawlRepoEntry[]; owners: DoNotCrawlOwnerEntry[] };
};

export function validateRemovals(
  source: RemovalsSource,
  options: {
    librarySkillIds: ReadonlySet<string>;
    existingSuppressedSkillIds: ReadonlySet<string>;
  },
): string[] {
  const errors: string[] = [];
  const { suppressedSkills, doNotCrawl } = source;
  if (!Array.isArray(suppressedSkills?.skills)) errors.push("suppressedSkills.skills must be an array");
  if (!Array.isArray(doNotCrawl?.repos) || !Array.isArray(doNotCrawl?.owners)) {
    errors.push("doNotCrawl must have repos and owners arrays");
  }
  if (errors.length) return errors;

  for (const entry of suppressedSkills.skills) {
    if (!entry.id?.trim()) {
      errors.push("suppressed skill with empty id");
    } else if (
      !options.librarySkillIds.has(entry.id) &&
      !options.existingSuppressedSkillIds.has(entry.id)
    ) {
      errors.push(`new suppressed skill does not exist in library: ${entry.id}`);
    }
    if (!entry.reason?.trim()) errors.push(`suppressed skill ${entry.id}: reason required`);
  }
  for (const entry of doNotCrawl.repos) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(entry.repo ?? "")) {
      errors.push(`do-not-crawl repo must be owner/repo: ${entry.repo}`);
    }
    if (!entry.reason?.trim()) errors.push(`do-not-crawl repo ${entry.repo}: reason required`);
  }
  for (const entry of doNotCrawl.owners) {
    if (!entry.owner?.trim() || entry.owner.includes("/")) {
      errors.push(`do-not-crawl owner must be a bare handle: ${entry.owner}`);
    }
    if (!entry.reason?.trim()) errors.push(`do-not-crawl owner ${entry.owner}: reason required`);
  }
  return errors;
}

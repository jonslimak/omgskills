import type { Skill } from "../scraper/types.js";
import { repoKeyFromUrl } from "../scraper/new-crawl/refresh-unpinned-skills.js";

type MovedSkill = Pick<Skill, "id" | "github_url" | "skill_md_path" | "skill_md_sha" | "first_seen">;

export type MovedRepoDuplicate = {
  id: string;
  replacementId: string;
  from: string;
  to: string;
  sameContent: boolean;
};

function sourceKey(skill: MovedSkill) {
  const repo = repoKeyFromUrl(skill.github_url);
  // A root ID has no folder suffix. Missing paths for nested IDs are not guessed.
  const path = skill.skill_md_path || (!skill.id.includes(":") ? "SKILL.md" : null);
  return repo && path ? JSON.stringify([repo, path]) : null;
}

/** Plan only: suppress moved aliases, never unrelated or already-listed destination rows. */
export function planMovedRepoDuplicates(skills: readonly MovedSkill[], movedIds: ReadonlySet<string>): MovedRepoDuplicate[] {
  const groups = new Map<string, MovedSkill[]>();
  for (const skill of skills) {
    const key = sourceKey(skill);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(skill);
    groups.set(key, group);
  }
  const duplicates: MovedRepoDuplicate[] = [];
  for (const group of groups.values()) {
    if (group.length < 2 || !group.some(skill => movedIds.has(skill.id))) continue;
    const existing = group.filter(skill => !movedIds.has(skill.id));
    const repo = repoKeyFromUrl(group[0].github_url)!;
    const destinationId = (skill: MovedSkill) => skill.id.split(":")[0].toLowerCase() === repo;
    const [keep] = [...(existing.length ? existing : group)].sort((a, b) =>
      Number(destinationId(b)) - Number(destinationId(a)) ||
      (a.first_seen || "9999").localeCompare(b.first_seen || "9999") || a.id.localeCompare(b.id));
    for (const skill of group) {
      if (skill.id === keep.id || !movedIds.has(skill.id)) continue;
      duplicates.push({ id: skill.id, replacementId: keep.id, from: skill.id.split(":")[0],
        to: repo, sameContent: Boolean(skill.skill_md_sha && skill.skill_md_sha === keep.skill_md_sha) });
    }
  }
  return duplicates.sort((a, b) => a.id.localeCompare(b.id));
}

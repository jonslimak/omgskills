import type { GroupedSyncedSkill } from "../synced-skill-grouping";
import { isMember, type PortalSet, type SetItem } from "../app/model";

export function changeMembership(
  set: PortalSet,
  skills: GroupedSyncedSkill[],
  add: boolean,
): PortalSet {
  if (set.role !== "owner") return set;
  if (!add) {
    const ids = new Set(skills.flatMap((skill) => skill.allSkillIds));
    return {
      ...set,
      items: set.items.filter(
        (item) => !item.syncedSkillId || !ids.has(item.syncedSkillId),
      ),
    };
  }
  const additions: SetItem[] = skills
    .filter((skill) => !isMember(set, skill))
    .map((skill) => ({
      id: `${set.id}-${skill.id}`,
      syncedSkillId: skill.id,
      name: skill.name,
      description: skill.description || "",
      githubUrl: skill.githubUrl,
      kind: "synced",
    }));
  return { ...set, items: [...set.items, ...additions] };
}

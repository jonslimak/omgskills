import type { PortalSet } from "../../app/model";
import { membershipStatus } from "../../app/model";
import type { SkillDisplay } from "../../app/unified/model";

/** Splits skills for one add: installed copies, saved library skills, and saved personal skills (by saved copy). */
export function addable(skills: SkillDisplay[]) {
  const unknown = skills.find(skill => !skill.installed && !skill.catalogId && !skill.cloudKey);
  if (unknown) throw new Error(`${unknown.name} can't be added to a set. Refresh and try again.`);
  return {
    skills: skills.flatMap(skill => skill.installed ? [skill.installed] : []),
    catalogIds: skills.flatMap(skill => !skill.installed && skill.catalogId ? [skill.catalogId] : []),
    saved: skills.flatMap(skill => !skill.installed && !skill.catalogId && skill.cloudKey ? [{ key: skill.cloudKey, name: skill.name }] : []),
  };
}

/** Whether a skill is in a Set: true, false, or null when the Set can't tell. */
export function setStatus(set: PortalSet, skill: SkillDisplay): boolean | null {
  if (skill.installed) return membershipStatus(set, skill.installed);
  if (skill.catalogId) return set.items.some(item => item.catalogSkillId === skill.catalogId);
  if (skill.cloudKey) return set.items.some(item => item.cloudKey === skill.cloudKey);
  return null;
}

import type { Skill } from "./types.js";

export function carryForwardExistingSkills(
  skills: Skill[],
  existingSkills: ReadonlyMap<string, Skill>,
): number {
  const currentIds = new Set(skills.map((skill) => skill.id));
  let carriedForward = 0;
  for (const [id, existing] of existingSkills) {
    if (currentIds.has(id) || !existing.name) continue;
    skills.push(existing);
    currentIds.add(id);
    carriedForward++;
  }
  return carriedForward;
}

import type { Skill } from "../types.js";
import type { Candidate } from "../enrich.js";

export function deriveSkillPathFromId(skillId: string): string | null {
  const colonIndex = skillId.indexOf(":");
  if (colonIndex === -1) return null;
  const suffix = skillId.slice(colonIndex + 1).trim();
  if (!suffix) return null;
  if (suffix === "SKILL.md" || suffix.endsWith("/SKILL.md")) {
    return suffix;
  }
  if (suffix.includes("/") || suffix.startsWith(".")) {
    return `${suffix.replace(/\/+$/, "")}/SKILL.md`;
  }
  return null;
}

export function buildCandidateFromSkill(skill: Skill): Candidate {
  return {
    id: skill.id,
    skill_md_path: skill.skill_md_path ?? deriveSkillPathFromId(skill.id) ?? "__RESOLVE__",
    skill_name_hint: skill.name,
  };
}

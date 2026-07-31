import type { Skill } from "../types.js";
import type { Candidate } from "../enrich.js";

export function deriveSkillIdFromPath(repo: string, skillPath: string): string {
  if (skillPath === "SKILL.md") return repo;
  if (!skillPath.endsWith("/SKILL.md")) {
    throw new Error(`Invalid SKILL.md path: ${skillPath}`);
  }
  return `${repo}:${skillPath.replace(/\/SKILL\.md$/, "")}`;
}

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

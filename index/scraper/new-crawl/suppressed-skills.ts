import type { TrustedSeeds } from "./types.js";
import { normalizePolicySkillId } from "../../../scripts/policy-identifiers.mjs";

export function normalizeSkillId(value: string): string {
  return normalizePolicySkillId(value);
}

export function isSuppressedSkillId(id: string, seeds: TrustedSeeds): boolean {
  return Boolean(seeds.suppressedSkillIds?.has(normalizeSkillId(id)));
}

export function filterSuppressedSkills<T extends { id: string }>(skills: T[], seeds: TrustedSeeds): T[] {
  return skills.filter((skill) => !isSuppressedSkillId(skill.id, seeds));
}

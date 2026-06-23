import type { CatalogRepoRule, ShadowSkillRecord } from "./types.js";

export function isUnresolvedCatalogLikeSkill(skill: ShadowSkillRecord): boolean {
  return !skill.author_handle && (skill.provenance_type === "catalog" || skill.provenance_type === "repackaged");
}

export function isKnownCatalogRepo(repo: string, rules: CatalogRepoRule[]): boolean {
  return rules.some((rule) => rule.repo === repo);
}

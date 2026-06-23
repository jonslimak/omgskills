import type { CatalogAdmissionSample, ShadowSkillRecord } from "./types.js";

function repoForSkill(skill: ShadowSkillRecord): string {
  const match = skill.github_url.match(/^https:\/\/github\.com\/([^/]+\/[^/#?]+)/i);
  return match?.[1]?.toLowerCase() ?? skill.publisher_repo;
}

export function buildCatalogAdmissionSample(skills: ShadowSkillRecord[]): CatalogAdmissionSample[] {
  return skills
    .flatMap((skill): CatalogAdmissionSample[] => {
      if (skill.provenance_type !== "catalog" && skill.provenance_type !== "repackaged") return [];
      return [{
        id: skill.id,
        repo: repoForSkill(skill),
        provenanceType: skill.provenance_type,
        stars: skill.stars,
        authorHandle: skill.author_handle,
      }];
    })
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id))
    .slice(0, 10);
}

import type { Skill } from "../types.js";
import type {
  CutoverValidationFailure,
  ShadowCutoverSkillSignal,
  ShadowRepoIndex,
} from "./types.js";

type CutoverSkillForValidation = Skill & {
  provenance_type?: string;
};

function ownerFromSkillId(id: string): string | null {
  const owner = id.split("/", 1)[0]?.trim();
  return owner ? owner.toLowerCase() : null;
}

export function validateCutoverOutputs(
  skills: CutoverSkillForValidation[],
  signals: ShadowCutoverSkillSignal[],
  repoIndex: ShadowRepoIndex,
): CutoverValidationFailure[] {
  const failures: CutoverValidationFailure[] = [];
  const skillIds = new Set<string>();

  for (const skill of skills) {
    if (skillIds.has(skill.id)) {
      failures.push({
        kind: "duplicateCutoverSkillId",
        id: skill.id,
        details: `Duplicate cutover skill id: ${skill.id}`,
      });
      continue;
    }
    skillIds.add(skill.id);

    if (skill.provenance_type === "original") {
      const idOwner = ownerFromSkillId(skill.id);
      const authorHandle = (skill.author_handle ?? "").trim().toLowerCase();
      if (!idOwner || authorHandle !== idOwner) {
        failures.push({
          kind: "originalAuthorHandleMismatch",
          id: skill.id,
          details: `Original skill ${skill.id} has author_handle "${skill.author_handle ?? ""}" but id owner is "${idOwner ?? ""}"`,
        });
      }
    }
  }

  for (const repo of repoIndex.repos) {
    for (const skillId of repo.skillIds) {
      if (!skillIds.has(skillId)) {
        failures.push({
          kind: "repoSkillIdMissing",
          repo: repo.repo,
          id: skillId,
          details: `Repo ${repo.repo} references missing cutover skill id ${skillId}`,
        });
      }
    }
  }

  for (const signal of signals) {
    if (!skillIds.has(signal.id)) {
      failures.push({
        kind: "cutoverSignalMissingSkill",
        id: signal.id,
        details: `Cutover signal references missing cutover skill id ${signal.id}`,
      });
    }
  }

  return failures;
}

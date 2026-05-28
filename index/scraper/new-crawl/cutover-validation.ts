import type { Skill } from "../types.js";
import type {
  CutoverValidationFailure,
  ShadowCutoverSkillSignal,
  ShadowRepoIndex,
} from "./types.js";

export function validateCutoverOutputs(
  skills: Skill[],
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

import type { Skill } from "../types.js";
import type { ShadowCutoverCompare, ShadowCutoverSkillSignal, ShadowSkillRecord } from "./types.js";

const SAMPLE_LIMIT = 20;

export function buildCutoverCompare(
  checkedAt: string,
  baselineSkills: Skill[],
  cutoverSkills: ShadowSkillRecord[],
  cutoverSignals: ShadowCutoverSkillSignal[],
  validationSummary: {
    cutoverValidationPassed: boolean;
    cutoverValidationFailureCount: number;
  },
): ShadowCutoverCompare {
  const baselineById = new Map(baselineSkills.map((skill) => [skill.id, skill] as const));
  const cutoverById = new Map(cutoverSkills.map((skill) => [skill.id, skill] as const));

  const addedSkillIds = [...cutoverById.keys()]
    .filter((id) => !baselineById.has(id))
    .sort();
  const missingSkillIds = [...baselineById.keys()]
    .filter((id) => !cutoverById.has(id))
    .sort();

  const authorDiffSample = [...cutoverById.keys()]
    .filter((id) => baselineById.has(id))
    .filter((id) => baselineById.get(id)?.author_handle !== cutoverById.get(id)?.author_handle)
    .sort()
    .slice(0, SAMPLE_LIMIT)
    .map((id) => ({
      id,
      baselineAuthorHandle: baselineById.get(id)?.author_handle ?? "",
      cutoverAuthorHandle: cutoverById.get(id)?.author_handle ?? "",
    }));

  return {
    checkedAt,
    counts: {
      baselineSkillCount: baselineSkills.length,
      cutoverSkillCount: cutoverSkills.length,
      countDelta: cutoverSkills.length - baselineSkills.length,
      addedSkillCount: addedSkillIds.length,
      missingSkillCount: missingSkillIds.length,
    },
    addedSkillIdsSample: addedSkillIds.slice(0, SAMPLE_LIMIT),
    missingSkillIdsSample: missingSkillIds.slice(0, SAMPLE_LIMIT),
    authorDiffSample,
    unresolvedAttributionSummary: {
      baselineUnknownAuthorSkillCount: baselineSkills.filter((skill) => !skill.author_handle).length,
      cutoverUnknownAuthorSkillCount: cutoverSkills.filter((skill) => !skill.author_handle).length,
      cutoverUnresolvedCatalogSkillCount: cutoverSkills.filter(
        (skill) => !skill.author_handle && (skill.provenance_type === "catalog" || skill.provenance_type === "repackaged"),
      ).length,
    },
    signalSummary: {
      cutoverSignalCount: cutoverSignals.length,
      cutoverRisingSignalCount: cutoverSignals.filter((signal) => signal.isRising).length,
      cutoverCoreSignalCount: cutoverSignals.filter((signal) => signal.isCore).length,
    },
    validationSummary,
  };
}

export function buildCutoverCompareSummary(compare: ShadowCutoverCompare): string {
  const { counts, unresolvedAttributionSummary, signalSummary, validationSummary } = compare;
  return [
    "# Cutover Compare",
    "",
    `- Checked at: ${compare.checkedAt}`,
    `- Cutover validation passing: ${validationSummary.cutoverValidationPassed ? "yes" : "no"}`,
    `- Cutover validation failures: ${validationSummary.cutoverValidationFailureCount}`,
    `- Baseline skills: ${counts.baselineSkillCount}`,
    `- Cutover skills: ${counts.cutoverSkillCount}`,
    `- Count delta: ${counts.countDelta >= 0 ? "+" : ""}${counts.countDelta}`,
    `- Added skills: ${counts.addedSkillCount}`,
    `- Missing skills: ${counts.missingSkillCount}`,
    `- Baseline unknown-author skills: ${unresolvedAttributionSummary.baselineUnknownAuthorSkillCount}`,
    `- Cutover unknown-author skills: ${unresolvedAttributionSummary.cutoverUnknownAuthorSkillCount}`,
    `- Cutover unresolved catalog skills: ${unresolvedAttributionSummary.cutoverUnresolvedCatalogSkillCount}`,
    `- Cutover signal rows: ${signalSummary.cutoverSignalCount}`,
    `- Cutover rising signals: ${signalSummary.cutoverRisingSignalCount}`,
    `- Cutover core signals: ${signalSummary.cutoverCoreSignalCount}`,
    "",
    "## Added skill ids",
    ...(compare.addedSkillIdsSample.length ? compare.addedSkillIdsSample.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Missing skill ids",
    ...(compare.missingSkillIdsSample.length ? compare.missingSkillIdsSample.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Author diff sample",
    ...(compare.authorDiffSample.length
      ? compare.authorDiffSample.map((row) => `- ${row.id}: @${row.baselineAuthorHandle || "?"} -> @${row.cutoverAuthorHandle || "?"}`)
      : ["- none"]),
  ].join("\n");
}

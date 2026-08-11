import { existsSync, readFileSync } from "node:fs";
import type { ShadowCadence, ShadowRepoIndex, ShadowSkillOverlay, ShadowSkillRecord } from "./types.js";

function sortSkills(skills: ShadowSkillRecord[]): ShadowSkillRecord[] {
  return skills.slice().sort((a, b) => a.id.localeCompare(b.id));
}

function referencedSkillIds(repoIndex: ShadowRepoIndex): Set<string> {
  return new Set(repoIndex.repos.flatMap((repo) => repo.skillIds));
}

export function loadShadowSkillOverlay(path: string): ShadowSkillOverlay | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ShadowSkillOverlay;
}

export function shouldReadShadowSkillOverlay(cadence: ShadowCadence): boolean {
  return cadence === "fast" || cadence === "combined";
}

export function shouldWriteShadowSkillOverlay(cadence: ShadowCadence): boolean {
  return cadence === "combined";
}

export function applyShadowSkillOverlay(
  cadence: ShadowCadence,
  shadowSkills: ShadowSkillRecord[],
  repoIndex: ShadowRepoIndex,
  overlay: ShadowSkillOverlay | null,
): { shadowSkills: ShadowSkillRecord[]; overlayLoaded: boolean; overlayEntryCount: number } {
  if (!shouldReadShadowSkillOverlay(cadence) || !overlay) {
    return { shadowSkills: sortSkills(shadowSkills), overlayLoaded: false, overlayEntryCount: 0 };
  }

  const referenced = referencedSkillIds(repoIndex);
  const byId = new Map(shadowSkills.map((skill) => [skill.id, skill]));
  for (const skill of overlay.skills) {
    if (!referenced.has(skill.id)) continue;
    if (byId.has(skill.id)) continue;
    byId.set(skill.id, skill);
  }

  return {
    shadowSkills: sortSkills([...byId.values()]),
    overlayLoaded: true,
    overlayEntryCount: overlay.skillCount,
  };
}

export function buildShadowSkillRefreshState(shadowSkills: ShadowSkillRecord[]): {
  existingFirstSeen: Map<string, string>;
  existingSkills: Map<string, ShadowSkillRecord>;
} {
  return {
    existingFirstSeen: new Map(shadowSkills.map((skill) => [skill.id, skill.first_seen])),
    existingSkills: new Map(shadowSkills.map((skill) => [skill.id, skill])),
  };
}

export function buildShadowSkillOverlay(
  maintainedSkills: ShadowSkillRecord[],
  baselineSkillIds: Set<string>,
  repoIndex: ShadowRepoIndex,
  generatedAt: string,
): ShadowSkillOverlay {
  const referenced = referencedSkillIds(repoIndex);
  const skills = sortSkills(
    maintainedSkills.filter((skill) => !baselineSkillIds.has(skill.id) && referenced.has(skill.id)),
  );

  return {
    generatedAt,
    skillCount: skills.length,
    skills,
  };
}

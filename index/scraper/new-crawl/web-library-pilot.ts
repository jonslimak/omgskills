import { existsSync, readFileSync } from "node:fs";

import type { ShadowSkillRecord } from "./types.js";

type WebLibraryCollection = {
  type?: string;
  authorHandle?: string;
  featuredSkillIds?: string[];
  skillIds?: string[];
};

type WebLibraryCollectionsFile = {
  collections?: WebLibraryCollection[];
};

const DEFAULT_AUTHOR_SKILL_LIMIT = 3;

function authorSkillLimit(): number {
  const parsed = Number.parseInt(process.env.WEB_LIBRARY_AUTHOR_SKILL_LIMIT || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTHOR_SKILL_LIMIT;
}

function sortAuthorSkills(a: ShadowSkillRecord, b: ShadowSkillRecord): number {
  return (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name);
}

export function buildWebLibraryPilotSkillIds(
  collections: WebLibraryCollection[],
  skills: ShadowSkillRecord[],
  maxAuthorSkills = authorSkillLimit(),
): string[] {
  const skillsByAuthor = new Map<string, ShadowSkillRecord[]>();
  for (const skill of skills) {
    const handle = String(skill.author_handle || "").toLowerCase();
    if (!handle) continue;
    const list = skillsByAuthor.get(handle) || [];
    list.push(skill);
    skillsByAuthor.set(handle, list);
  }
  for (const list of skillsByAuthor.values()) {
    list.sort(sortAuthorSkills);
  }

  const ids = new Set<string>();
  for (const collection of collections) {
    for (const id of collection.featuredSkillIds || []) ids.add(id);
    for (const id of collection.skillIds || []) ids.add(id);
    if (collection.type === "author" && collection.authorHandle) {
      const handle = collection.authorHandle.toLowerCase();
      for (const skill of (skillsByAuthor.get(handle) || []).slice(0, maxAuthorSkills)) {
        ids.add(skill.id);
      }
    }
  }
  return [...ids];
}

export function loadWebLibraryPilotCollections(path: string): WebLibraryCollection[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as WebLibraryCollectionsFile;
  return Array.isArray(parsed.collections) ? parsed.collections : [];
}

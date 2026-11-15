import type { PortalData } from "../../app/model";
import type { MySkillAddition } from "../../app/my-skills-additions";
import type { CloudSaveState } from "../../cloud-save/cloud-save";

/**
 * The last My skills this browser showed, so a return visit paints at once and then refreshes.
 * Shown until the live load replaces it. One entry per account; signing out removes them all.
 * Bump the version when the saved shape changes, so an older page's entry is ignored.
 */
export type MySkillsCache = { data: PortalData; cloud: CloudSaveState | null; additions: MySkillAddition[] | null };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const prefix = "omgskills.myskills.v1.";
const maxAge = 7 * 24 * 60 * 60 * 1000;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function validData(data: unknown): data is PortalData {
  if (!isObject(data) || !Array.isArray(data.skills) || !Array.isArray(data.sets) || !Array.isArray(data.devices) || !isObject(data.profile)) return false;
  return data.skills.every(skill => isObject(skill) && typeof skill.id === "string" && typeof skill.name === "string" && typeof skill.source === "string")
    && data.sets.every(set => isObject(set) && typeof set.id === "string" && typeof set.name === "string" && Array.isArray(set.items))
    && data.devices.every(device => isObject(device) && typeof device.id === "string")
    && typeof data.profile.handle === "string";
}

function validCloud(cloud: unknown): cloud is CloudSaveState | null {
  return cloud === null || (isObject(cloud) && isObject(cloud.settings) && isObject(cloud.usage)
    && Array.isArray(cloud.skills) && cloud.skills.every(skill => isObject(skill) && typeof skill.key === "string" && isObject(skill.currentVersion))
    && Array.isArray(cloud.needsReview) && isObject(cloud.skipped));
}

function validAdditions(additions: unknown): additions is MySkillAddition[] | null {
  return additions === null || (Array.isArray(additions) && additions.every(skill => isObject(skill) && typeof skill.catalogId === "string"));
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readMySkillsCache(userId: string, now = Date.now(), store = storage()): MySkillsCache | null {
  if (!userId || !store) return null;
  try {
    const saved = JSON.parse(store.getItem(prefix + userId) || "null") as unknown;
    if (isObject(saved) && typeof saved.at === "number" && now - saved.at >= 0 && now - saved.at < maxAge
      && validData(saved.data) && validCloud(saved.cloud) && validAdditions(saved.additions)) {
      return { data: saved.data, cloud: saved.cloud, additions: saved.additions };
    }
    store.removeItem(prefix + userId);
  } catch { try { store.removeItem(prefix + userId); } catch { /* Best effort. */ } }
  return null;
}

export function writeMySkillsCache(userId: string, cache: MySkillsCache, now = Date.now(), store = storage()) {
  if (!userId || !store) return;
  try { store.setItem(prefix + userId, JSON.stringify({ at: now, ...cache })); }
  catch { try { store.removeItem(prefix + userId); } catch { /* Live loads still work. */ } }
}

/** Removes every account's entry, for sign-out and lost access. */
export function clearMySkillsCache(store = storage()) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach(key => store.removeItem(key));
  } catch { /* Best effort. */ }
}

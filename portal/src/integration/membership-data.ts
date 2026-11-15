import type { PortalApi } from "../portal-api";
import { PortalApiError, isAccessError } from "../api-error";
import { addSavedSkillToGroup, addSyncedSkillToGroup, createCatalogFavoritesGroup, createFavoritesGroup, createGroup, listOwnedGroups, removeGroupItem, reorderGroupItems, updateGroupItem } from "../groups/api";
import { groupSyncedSkills, hasCatalogId, type GroupedSyncedSkill } from "../synced-skill-grouping";
import { isMember, type MembershipResult, type PortalData, type PortalSet } from "../app/model";
import { loadSetData } from "./data";

export const emptyMembershipResult = (): MembershipResult => ({ completedIds: [], failed: [], added: 0, removed: 0, unchanged: 0, uncertain: false });
export type MembershipCommand =
  | { kind: "catalog"; catalogId: string; favorite: boolean; id?: string }
  | { kind: "change"; id: string; skills: GroupedSyncedSkill[]; add: boolean }
  | { kind: "favorites"; skills: GroupedSyncedSkill[]; add: boolean }
  | { kind: "remove-favorite"; catalogId?: string; skillId?: string }
  | { kind: "create-selected"; name: string; skills: GroupedSyncedSkill[] }
  /** Any mix of installed, saved library and saved personal skills, into a Set (`id`) or a new one (`name`). */
  | { kind: "add-many"; id?: string; name?: string; skills: GroupedSyncedSkill[]; catalogIds: string[];
      saved: { key: string; name: string }[] }
  | { kind: "remove-item"; id: string; itemId: string }
  | { kind: "reorder"; id: string; itemIds: string[] }
  | { kind: "update-item"; id: string; itemId: string };
/** The server's answer when a skill is already in the Set, however it got there. */
const alreadyInSet = "Skill is already in this group";
const message = (error: unknown) => error instanceof Error ? error.message : "Could not update this skill.";
const uncertain = (error: unknown) => !(error instanceof PortalApiError) || error.status >= 500;
function checkSignal(signal: AbortSignal) { if (signal.aborted) throw new DOMException("Account changed", "AbortError"); }
function groupId(value: unknown) {
  const id = (value as { groupId?: unknown })?.groupId;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Unexpected set response. Refresh before trying again.");
  return id;
}
async function ownedSet(api: PortalApi, id: string, signal: AbortSignal) {
  const set = await loadSetData(api, id);
  checkSignal(signal);
  if (set.role !== "owner") throw new PortalApiError("Only the owner can edit this set.", 403);
  return set;
}

// Catalog additions use the existing release-resolving endpoint, never synthetic installs.
export async function addCatalogMembership(api: PortalApi, sets: PortalSet[], command: Extract<MembershipCommand, { kind: "catalog" }>, signal: AbortSignal): Promise<MembershipResult> {
  if (!command.catalogId || command.catalogId.length > 500) throw new PortalApiError("Choose a catalog skill.", 400);
  checkSignal(signal);
  let id = command.favorite ? sets.find(set => set.isFavorites && set.role === "owner")?.id : command.id;
  if (!id && command.favorite) {
    try {
      id = groupId(await createCatalogFavoritesGroup(api, command.catalogId));
      checkSignal(signal);
      return { ...emptyMembershipResult(), groupId: id, added: 1, completedIds: [command.catalogId] };
    } catch (error) {
      checkSignal(signal);
      if (!(error instanceof PortalApiError) || error.status !== 409) throw error;
      const groups = await listOwnedGroups(api);
      checkSignal(signal);
      id = groups.find(group => group.isFavorites)?.id;
      if (!id) throw error;
    }
  }
  checkSignal(signal);
  if (!id) throw new PortalApiError("Choose a set you own.", 400);
  let set = await ownedSet(api, id, signal);
  if (set.hidden || (command.favorite ? !set.isFavorites : set.isFavorites)) throw new PortalApiError("This set is not available for this action.", 409);
  const result = { ...emptyMembershipResult(), groupId: id, completedIds: [command.catalogId] };
  if (set.items.some(item => item.catalogSkillId === command.catalogId)) return { ...result, unchanged: 1 };
  // Older read responses omit catalog identity, so a repeated save cannot be verified.
  if (set.items.some(item => item.kind === "catalog" && !item.catalogSkillId)) {
    throw new PortalApiError("This set contains catalog skills whose identity is unavailable. Adding is paused to avoid duplicates.", 409);
  }
  try {
    const value = await api<{ itemId: string }>(`/api/portal/groups/${id}/items`, {
      method: "POST", body: JSON.stringify({ kind: "catalog", catalogSkillId: command.catalogId }),
    });
    checkSignal(signal);
    if (typeof value?.itemId !== "string" || !value.itemId) throw new Error("Unexpected add response. Refresh before trying again.");
    return { ...result, added: 1 };
  } catch (error) {
    checkSignal(signal);
    if (!(error instanceof PortalApiError) || error.status !== 409) throw error;
    set = await ownedSet(api, id, signal);
    if (!set.items.some(item => item.catalogSkillId === command.catalogId)) throw error;
    return { ...result, unchanged: 1 };
  }
}

// Read actual item IDs once per operation. Never persist mappings across accounts or refreshes.
export async function changeMembership(api: PortalApi, id: string, skills: GroupedSyncedSkill[], add: boolean, signal: AbortSignal): Promise<MembershipResult> {
  let set = await ownedSet(api, id, signal);
  const result = { ...emptyMembershipResult(), groupId: id };
  for (const skill of skills) {
    checkSignal(signal);
    if (result.uncertain) {
      result.failed.push({ id: skill.id, name: skill.name, message: "Not attempted. Refresh before continuing." });
      continue;
    }
    try {
      const matches = set.items.filter((item) => item.syncedSkillId && skill.allSkillIds.includes(item.syncedSkillId));
      // Items added by their saved copy carry its key instead of a synced skill.
      const unknown = set.items.some((item) => item.kind === "synced" && !item.syncedSkillId && !item.cloudKey);
      if ((add && matches.length) || (!add && !matches.length && !unknown)) {
        result.unchanged++;
      } else {
        if (unknown) {
          throw new PortalApiError("Membership information is incomplete. Refresh this set.", 409);
        }
        if (add) {
          try {
            const value = await addSyncedSkillToGroup(api, id, skill.id) as { itemId?: unknown };
            checkSignal(signal);
            if (typeof value?.itemId !== "string" || !value.itemId) throw new Error("Unexpected add response. Refresh before trying again.");
            set.items.push({ id: value.itemId, syncedSkillId: skill.id, name: skill.name,
              description: skill.description ?? "", githubUrl: skill.githubUrl, kind: "synced" });
            result.added++;
          } catch (error) {
            if (!(error instanceof PortalApiError) || error.status !== 409) throw error;
            // Its saved copy may already be in the Set (an item the list can't match to this Mac's copy).
            if (error.message === alreadyInSet) { result.unchanged++; }
            else {
              set = await ownedSet(api, id, signal);
              if (!isMember(set, skill)) throw error;
              result.unchanged++;
            }
          }
        } else {
          for (const item of matches) {
            await removeMembershipItem(api, id, item.id, signal);
            set.items = set.items.filter((value) => value.id !== item.id);
          }
          result.removed++;
        }
      }
      result.completedIds.push(skill.id);
    } catch (error) {
      checkSignal(signal);
      if (isAccessError(error)) throw error;
      result.failed.push({ id: skill.id, name: skill.name, message: message(error) });
      result.uncertain = uncertain(error);
    }
  }
  return result;
}

export async function removeMembershipItem(api: PortalApi, id: string, itemId: string, signal: AbortSignal) {
  checkSignal(signal);
  try {
    const value = await removeGroupItem(api, id, itemId) as { itemId?: unknown; deleted?: unknown };
    checkSignal(signal);
    if (value?.itemId !== itemId || value.deleted !== true) throw new Error("Unexpected removal response. Refresh before trying again.");
  } catch (error) {
    if (!(error instanceof PortalApiError) || error.status !== 404) throw error;
    const set = await ownedSet(api, id, signal);
    if (set.items.some((item) => item.id === itemId)) throw error;
  }
}

export async function reorderMembership(api: PortalApi, id: string, itemIds: string[], signal: AbortSignal) {
  const set = await ownedSet(api, id, signal);
  if (new Set(itemIds).size !== itemIds.length || itemIds.length !== set.items.length || set.items.some((item) => !itemIds.includes(item.id))) {
    throw new PortalApiError("The set changed. Refresh before reordering.", 409);
  }
  const value = await reorderGroupItems(api, id, itemIds) as { itemIds?: unknown };
  checkSignal(signal);
  if (!Array.isArray(value?.itemIds) || value.itemIds.length !== itemIds.length || value.itemIds.some((item, index) => item !== itemIds[index])) {
    throw new Error("Unexpected order response. Refresh before trying again.");
  }
}

export async function updateMembershipItem(api: PortalApi, id: string, itemId: string, signal: AbortSignal) {
  const value = await updateGroupItem(api, id, itemId) as { itemId?: unknown; releaseId?: unknown };
  checkSignal(signal);
  if (value?.itemId !== itemId || typeof value.releaseId !== "string") throw new Error("Unexpected update response. Refresh before trying again.");
}

export async function createSelectedSet(api: PortalApi, name: string, skills: GroupedSyncedSkill[], signal: AbortSignal): Promise<MembershipResult> {
  const id = groupId(await createGroup(api, name, "private", skills.map((skill) => skill.id)));
  checkSignal(signal);
  return { ...emptyMembershipResult(), groupId: id, added: skills.length, completedIds: skills.map((skill) => skill.id) };
}

/** Adds saved skills no Mac has now, by their saved copy. Already in the Set counts as done. */
export async function addSavedMembership(api: PortalApi, id: string, saved: { key: string; name: string }[], signal: AbortSignal): Promise<MembershipResult> {
  let set = await ownedSet(api, id, signal);
  if (set.hidden || set.isFavorites) throw new PortalApiError("This set is not available for this action.", 409);
  const result = { ...emptyMembershipResult(), groupId: id };
  for (const skill of saved) {
    checkSignal(signal);
    if (result.uncertain) {
      result.failed.push({ id: skill.key, name: skill.name, message: "Not attempted. Refresh before continuing." });
      continue;
    }
    try {
      if (set.items.some((item) => item.cloudKey === skill.key)) result.unchanged++;
      else {
        try {
          const value = await addSavedSkillToGroup(api, id, skill.key) as { itemId?: unknown };
          checkSignal(signal);
          if (typeof value?.itemId !== "string" || !value.itemId) throw new Error("Unexpected add response. Refresh before trying again.");
          result.added++;
        } catch (error) {
          if (!(error instanceof PortalApiError) || error.status !== 409) throw error;
          if (error.message !== alreadyInSet) {
            set = await ownedSet(api, id, signal);
            if (!set.items.some((item) => item.cloudKey === skill.key)) throw error;
          }
          result.unchanged++;
        }
      }
      result.completedIds.push(skill.key);
    } catch (error) {
      checkSignal(signal);
      if (isAccessError(error)) throw error;
      result.failed.push({ id: skill.key, name: skill.name, message: message(error) });
      result.uncertain = uncertain(error);
    }
  }
  return result;
}

/** One add for any mix of skills: installed ones, then saved library skills, then saved personal skills. */
export async function addManyMembership(api: PortalApi, sets: PortalSet[], command: Extract<MembershipCommand, { kind: "add-many" }>,
  skills: GroupedSyncedSkill[], signal: AbortSignal): Promise<MembershipResult> {
  let total: MembershipResult;
  let id = command.id;
  if (command.name !== undefined) {
    total = await createSelectedSet(api, command.name, skills, signal);
    id = total.groupId;
  } else {
    if (!id) throw new PortalApiError("Choose a set you own.", 400);
    total = skills.length ? await changeMembership(api, id, skills, true, signal) : { ...emptyMembershipResult(), groupId: id };
  }
  const merge = (next: MembershipResult) => {
    total = { ...total, completedIds: [...total.completedIds, ...next.completedIds], failed: [...total.failed, ...next.failed],
      added: total.added + next.added, unchanged: total.unchanged + next.unchanged, uncertain: total.uncertain || next.uncertain };
  };
  for (const catalogId of command.catalogIds) {
    if (total.uncertain) { total.failed.push({ id: catalogId, name: catalogId, message: "Not attempted. Refresh before continuing." }); continue; }
    try { merge(await addCatalogMembership(api, sets, { kind: "catalog", catalogId, favorite: false, id }, signal)); }
    catch (error) {
      checkSignal(signal);
      if (isAccessError(error)) throw error;
      total.failed.push({ id: catalogId, name: catalogId, message: message(error) });
      total.uncertain = total.uncertain || uncertain(error);
    }
  }
  if (command.saved.length) {
    if (total.uncertain) total.failed.push(...command.saved.map((skill) => ({ id: skill.key, name: skill.name, message: "Not attempted. Refresh before continuing." })));
    else merge(await addSavedMembership(api, id!, command.saved, signal));
  }
  return total;
}

export async function changeFavorites(api: PortalApi, sets: PortalSet[], skills: GroupedSyncedSkill[], add: boolean, signal: AbortSignal): Promise<MembershipResult> {
  let id = sets.find((set) => set.role === "owner" && set.isFavorites)?.id;
  if (!id && !add) return { ...emptyMembershipResult(), unchanged: skills.length, completedIds: skills.map((skill) => skill.id) };
  if (!skills.length) return emptyMembershipResult();
  if (!id) {
    try {
      id = groupId(await createFavoritesGroup(api, skills[0].id));
      checkSignal(signal);
    } catch (error) {
      if (!(error instanceof PortalApiError) || error.status !== 409) throw error;
      const groups = await listOwnedGroups(api);
      checkSignal(signal);
      id = groups.find((group) => group.isFavorites)?.id;
      if (!id) throw error;
      return changeMembership(api, id, skills, add, signal);
    }
    const result = { ...emptyMembershipResult(), groupId: id, added: 1, completedIds: [skills[0].id] };
    if (skills.length === 1) return result;
    try {
      const rest = await changeMembership(api, id, skills.slice(1), add, signal);
      return { ...rest, added: rest.added + 1, completedIds: [...result.completedIds, ...rest.completedIds] };
    } catch (error) {
      checkSignal(signal);
      if (isAccessError(error)) throw error;
      return { ...result, uncertain: true, failed: skills.slice(1).map((skill) => ({ id: skill.id, name: skill.name, message: message(error) })) };
    }
  }
  return changeMembership(api, id, skills, add, signal);
}

// Remove exact saved representations only, never the installed skill or its files.
export async function removeFavoriteMembership(api: PortalApi, sets: PortalSet[], catalogId: string | undefined, skill: GroupedSyncedSkill | undefined, signal: AbortSignal): Promise<MembershipResult> {
  checkSignal(signal);
  if ((!catalogId && !skill) || (catalogId && catalogId.length > 500)) throw new PortalApiError("Choose a skill to remove from Favorites.", 400);
  const id = sets.find(set => set.role === "owner" && set.isFavorites)?.id;
  const result = { ...emptyMembershipResult(), groupId: id, completedIds: [catalogId || skill!.id] };
  if (!id) return { ...result, unchanged: 1 };
  const set = await ownedSet(api, id, signal);
  if (!set.isFavorites || set.hidden) throw new PortalApiError("Favorites is not available for this action.", 409);
  if (set.items.some(item => (catalogId && item.kind === "catalog" && !item.catalogSkillId) ||
    (skill && item.kind === "synced" && !item.syncedSkillId && !item.cloudKey))) {
    throw new PortalApiError("Membership information is incomplete. Refresh Favorites.", 409);
  }
  const matches = set.items.filter(item =>
    (item.kind === "catalog" && item.catalogSkillId && (item.catalogSkillId === catalogId
      || (skill && hasCatalogId(skill, item.catalogSkillId)))) ||
    (skill && item.kind === "synced" && item.syncedSkillId && skill.allSkillIds.includes(item.syncedSkillId)));
  for (const item of matches) await removeMembershipItem(api, id, item.id, signal);
  return { ...result, removed: matches.length ? 1 : 0, unchanged: matches.length ? 0 : 1 };
}

/**
 * Favorites as they will be once a heart tap saves, shown before the server answers.
 * The reload after the save replaces it; a first favorite, which creates the set, waits for that reload.
 */
export function withFavoriteChange(data: PortalData, command: MembershipCommand): PortalData {
  const favorites = data.sets.find(set => set.role === "owner" && set.isFavorites);
  if (!favorites || favorites.hidden) return data;
  let next: PortalSet;
  if (command.kind === "favorites" && command.add) {
    const skills = command.skills.filter(skill => !isMember(favorites, skill));
    if (!skills.length) return data;
    next = { ...favorites, itemCount: (favorites.itemCount ?? favorites.items.length) + skills.length,
      membershipSkillIds: favorites.membershipSkillIds && [...favorites.membershipSkillIds, ...skills.map(skill => skill.id)],
      items: [...favorites.items, ...skills.map(skill => ({ id: `pending:${skill.id}`, syncedSkillId: skill.id, name: skill.name,
        description: skill.description ?? "", githubUrl: skill.githubUrl, kind: "synced" as const }))] };
  } else if (command.kind === "catalog" && command.favorite) {
    if (favorites.items.some(item => item.catalogSkillId === command.catalogId)) return data;
    next = { ...favorites, itemCount: (favorites.itemCount ?? favorites.items.length) + 1,
      items: [...favorites.items, { id: `pending:${command.catalogId}`, syncedSkillId: null, catalogSkillId: command.catalogId,
        name: "", description: "", githubUrl: null, kind: "catalog" }] };
  } else if (command.kind === "remove-favorite" || (command.kind === "favorites" && !command.add)) {
    // Mirror what the save removes: Favorites by skill or catalog ID, or a plain Set change by the chosen copies only.
    const groups = groupSyncedSkills(data.skills, { groupInstallations: true });
    const skills = command.kind === "favorites" ? command.skills
      : command.skillId ? groups.filter(group => group.allSkillIds.includes(command.skillId!)) : [];
    const catalogId = command.kind === "remove-favorite" ? command.catalogId : undefined;
    const ids = new Set(skills.flatMap(skill => skill.allSkillIds));
    const matches = (item: PortalSet["items"][number]) => (item.syncedSkillId !== null && ids.has(item.syncedSkillId))
      || (command.kind === "remove-favorite" && !!item.catalogSkillId
        && (item.catalogSkillId === catalogId || skills.some(skill => hasCatalogId(skill, item.catalogSkillId!))));
    const items = favorites.items.filter(item => !matches(item));
    const membershipSkillIds = favorites.membershipSkillIds?.filter(id => !ids.has(id));
    const removed = Math.max(favorites.items.length - items.length, (favorites.membershipSkillIds?.length ?? 0) - (membershipSkillIds?.length ?? 0));
    if (!removed) return data;
    next = { ...favorites, items, membershipSkillIds, itemCount: Math.max(0, (favorites.itemCount ?? favorites.items.length) - removed) };
  } else return data;
  return { ...data, sets: data.sets.map(set => set === favorites ? next : set) };
}

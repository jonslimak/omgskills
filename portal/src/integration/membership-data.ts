import type { PortalApi } from "../portal-api";
import { PortalApiError, isAccessError } from "../api-error";
import { addSyncedSkillToGroup, createFavoritesGroup, createGroup, listOwnedGroups, removeGroupItem, reorderGroupItems } from "../groups/api";
import type { GroupedSyncedSkill } from "../synced-skill-grouping";
import { isMember, type MembershipResult, type PortalSet } from "../app/model";
import { loadSetData } from "./data";

export const emptyMembershipResult = (): MembershipResult => ({ completedIds: [], failed: [], added: 0, removed: 0, unchanged: 0, uncertain: false });
export type MembershipCommand =
  | { kind: "change"; id: string; skills: GroupedSyncedSkill[]; add: boolean }
  | { kind: "favorites"; skills: GroupedSyncedSkill[]; add: boolean }
  | { kind: "create-selected"; name: string; skills: GroupedSyncedSkill[] }
  | { kind: "remove-item"; id: string; itemId: string }
  | { kind: "reorder"; id: string; itemIds: string[] };
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
      if ((add && matches.length) || (!add && !matches.length && !set.items.some((item) => item.kind === "synced" && !item.syncedSkillId))) {
        result.unchanged++;
      } else {
        if (set.items.some((item) => item.kind === "synced" && !item.syncedSkillId)) {
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
            set = await ownedSet(api, id, signal);
            if (!isMember(set, skill)) throw error;
            result.unchanged++;
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

export async function createSelectedSet(api: PortalApi, name: string, skills: GroupedSyncedSkill[], signal: AbortSignal): Promise<MembershipResult> {
  const id = groupId(await createGroup(api, name, "private", skills.map((skill) => skill.id)));
  checkSignal(signal);
  return { ...emptyMembershipResult(), groupId: id, added: skills.length, completedIds: skills.map((skill) => skill.id) };
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

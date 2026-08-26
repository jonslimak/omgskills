import type { PortalApi } from "@/portal-api";
import type { SkillGroup, SkillGroupDetail, SkillGroupItem } from "@/groups/types";

export async function listOwnedGroups(api: PortalApi): Promise<SkillGroup[]> {
  const result = await api<{ groups: SkillGroup[] }>("/api/portal/groups");
  return result.groups;
}

export async function listSharedGroups(api: PortalApi): Promise<SkillGroup[]> {
  const result = await api<{ groups: SkillGroup[] }>("/api/portal/shared");
  return result.groups;
}

export async function createGroup(api: PortalApi, name: string) {
  return api<{ groupId: string }>("/api/portal/groups", {
    method: "POST",
    body: JSON.stringify({ name, visibility: "restricted", syncedSkillIds: [] }),
  });
}

export async function createFavoritesGroup(
  api: PortalApi,
  syncedSkillId: string
) {
  return api("/api/portal/groups", {
    method: "POST",
    body: JSON.stringify({
      name: "Favorite Skills",
      visibility: "public",
      isFavorites: true,
      syncedSkillIds: [syncedSkillId],
    }),
  });
}

export async function updateGroupVisibility(
  api: PortalApi,
  groupId: string,
  visibility: string
) {
  return api(`/api/portal/groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify({ visibility }),
  });
}

export async function updateGroupModeration(
  api: PortalApi,
  groupId: string,
  disabled: boolean
) {
  return api(`/api/portal/groups/${groupId}/moderation`, {
    method: "PATCH",
    body: JSON.stringify({ disabled }),
  });
}

export async function loadGroupDetail(api: PortalApi, groupId: string) {
  const result = await api<{
    group: SkillGroup;
    items: SkillGroupItem[];
    accessRole: SkillGroupDetail["accessRole"];
  }>(`/api/portal/groups/${groupId}`);
  return {
    group: { ...result.group, accessRole: result.accessRole },
    items: result.items,
  };
}

export async function addGroupAllowedEmail(api: PortalApi, groupId: string, email: string) {
  return api(`/api/portal/groups/${groupId}/allowed-emails`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function removeGroupAllowedEmail(api: PortalApi, groupId: string, emailId: string) {
  return api(`/api/portal/groups/${groupId}/allowed-emails`, {
    method: "DELETE",
    body: JSON.stringify({ emailId }),
  });
}

export async function addSyncedSkillToGroup(
  api: PortalApi,
  groupId: string,
  syncedSkillId: string
) {
  return api(`/api/portal/groups/${groupId}/items`, {
    method: "POST",
    body: JSON.stringify({ kind: "synced", syncedSkillId }),
  });
}

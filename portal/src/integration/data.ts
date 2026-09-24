import type { PortalApi } from "../portal-api";
import { listOwnedGroups, listSharedGroups, loadGroupDetail } from "../groups/api";
import type { SkillGroup } from "../groups/types";
import type { SyncedSkill } from "../synced-skill-grouping";
import type { PortalData, PortalSet } from "../app/model";
import { isIntegrationRead } from "../../integration-config";

export type AccountIdentity = { name: string; email: string };
export type ProfileResponse = {
  handle: string | null;
  profilePublished: boolean;
  publicUrl: string | null;
};

export function isProfileResponse(value: unknown): value is ProfileResponse {
  if (!value || typeof value !== "object") return false;
  const profile = value as ProfileResponse;
  return (profile.handle === null || typeof profile.handle === "string") &&
    typeof profile.profilePublished === "boolean" &&
    (profile.publicUrl === null || typeof profile.publicUrl === "string");
}

export async function saveProfileData(
  api: PortalApi,
  current: PortalData["profile"],
  changes: { handle?: string; published?: boolean },
  signal: AbortSignal,
) {
  const result = await api<{ profile: ProfileResponse }>("/api/portal/profile", {
    method: "PATCH", signal, redirect: "error", cache: "no-store",
    body: JSON.stringify({ handle: changes.handle ?? current.handle,
      profilePublished: changes.published ?? current.published }),
  });
  if (!isProfileResponse(result?.profile)) throw new Error("Invalid profile response.");
  return { ...current, handle: result.profile.handle ?? "",
    published: result.profile.profilePublished, publicUrl: result.profile.publicUrl };
}

export function readOnlyApi(api: PortalApi, signal?: AbortSignal): PortalApi {
  return (path, init = {}) => {
    if (!isIntegrationRead(path, init.method) || init.body != null) {
      return Promise.reject(
        new Error("This integration view only allows portal reads."),
      );
    }
    return api(path, {
      ...init,
      signal: signal ?? init.signal,
      redirect: "error",
      cache: "no-store",
    });
  };
}

export function setSummary(
  group: SkillGroup,
  owner: boolean,
  name: string,
): PortalSet {
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? "",
    visibility: group.visibility ?? "private",
    isFavorites: Boolean(group.isFavorites),
    hidden: Boolean(group.disabledAt),
    role: owner ? "owner" : "invited",
    ownerName: owner ? name : group.ownerDisplayName || "Owner",
    emails: owner
      ? (group.allowedEmails ?? []).map((entry) => entry.email)
      : [],
    itemCount: group.itemCount,
    membershipSkillIds: owner ? (group.syncedSkillIds ?? []) : undefined,
    items: [], // Summaries are not detail responses. Never invent item records.
  };
}

export async function loadAccountData(
  api: PortalApi,
  identity: AccountIdentity,
): Promise<PortalData> {
  const [synced, owned, shared, profile] = await Promise.all([
    api<{ skills: SyncedSkill[] }>("/api/portal/synced-skills"),
    listOwnedGroups(api),
    listSharedGroups(api),
    api<{ profile: ProfileResponse }>("/api/portal/profile"),
  ]);
  if (
    !Array.isArray(synced.skills) ||
    !Array.isArray(owned) ||
    !Array.isArray(shared) ||
    !isProfileResponse(profile.profile)
  ) {
    throw new Error("The portal returned an invalid account response.");
  }
  return {
    skills: synced.skills,
    sets: [
      ...owned.map((group) => setSummary(group, true, identity.name)),
      ...shared.map((group) => setSummary(group, false, identity.name)),
    ],
    devices: [],
    profile: {
      ...identity,
      handle: profile.profile.handle ?? "",
      published: profile.profile.profilePublished,
      publicUrl: profile.profile.publicUrl,
    },
    privateSourceConnected: null,
  };
}

export async function loadSetData(api: PortalApi, groupId: string): Promise<PortalSet> {
  const { group, items } = await loadGroupDetail(api, groupId);
  if (
    group.id !== groupId || typeof group.name !== "string" ||
    !["owner", "invited", "public"].includes(group.accessRole) ||
    !["public", "restricted", "private"].includes(group.visibility ?? "") ||
    !Array.isArray(items) || items.some((item) =>
      !item || typeof item.id !== "string" || typeof item.name !== "string" ||
      typeof item.description !== "string" || !Number.isFinite(item.position) ||
      !["synced", "catalog", "github"].includes(item.kind) ||
      (item.githubUrl !== null && typeof item.githubUrl !== "string")) ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) throw new Error("The portal returned an invalid set response.");
  return {
    ...setSummary(group, group.accessRole === "owner", group.ownerDisplayName || "Owner"),
    role: group.accessRole,
    items: [...items].sort((a, b) => a.position - b.position).map((item) => ({
      id: item.id,
      // The current detail endpoint has no physical ID; never infer it by name.
      syncedSkillId: null,
      name: item.name,
      description: item.description,
      githubUrl: item.githubUrl,
      kind: item.kind as "synced" | "catalog" | "github",
    })),
  };
}

export function emptyAccount(identity: AccountIdentity): PortalData {
  return {
    skills: [],
    sets: [],
    devices: [],
    profile: { ...identity, handle: "", published: false, publicUrl: null },
    privateSourceConnected: null,
  };
}

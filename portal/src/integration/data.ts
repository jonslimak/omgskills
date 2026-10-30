import type { PortalApi } from "../portal-api";
import { listOwnedGroups, listSharedGroups, loadGroupDetail } from "../groups/api";
import type { SkillGroup } from "../groups/types";
import type { SyncedSkill, ScanCoverage } from "../synced-skill-grouping";
import type { PortalData, PortalSet } from "../app/model";
import { isPortalRead } from "../portal-read-policy";

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

export function readOnlyApi(api: PortalApi, signal?: AbortSignal, connectedInventory = false, inventoryReconciliation = false): PortalApi {
  return (path, init = {}) => {
    if (!isPortalRead(path, init.method, connectedInventory, inventoryReconciliation) || init.body != null) {
      return Promise.reject(
        new Error("This transport only allows portal reads."),
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
  if (owner && group.allowedEmails !== undefined &&
    (!Array.isArray(group.allowedEmails) || group.allowedEmails.some((entry) =>
      !entry || typeof entry.id !== "string" || !entry.id || typeof entry.email !== "string") ||
      new Set(group.allowedEmails.map((entry) => entry.id)).size !== group.allowedEmails.length)) {
    throw new Error("The portal returned invalid access records.");
  }
  return {
    id: group.id,
    slug: typeof group.slug === "string" ? group.slug : undefined,
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
    allowedEmails: owner ? group.allowedEmails?.map((entry) => ({ ...entry })) : undefined,
    itemCount: group.itemCount,
    membershipSkillIds: owner ? group.syncedSkillIds : undefined,
    items: [], // Summaries are not detail responses. Never invent item records.
  };
}

export async function loadAccountData(
  api: PortalApi,
  identity: AccountIdentity,
  includeFavoriteItems = false,
  connectedInventory = false,
  inventoryReconciliation = false,
): Promise<PortalData> {
  if (inventoryReconciliation && !connectedInventory) throw new Error("Reconciliation requires connected inventory.");
  const [synced, owned, shared, profile] = await Promise.all([
    api<{ skills: SyncedSkill[] }>(inventoryReconciliation ? "/api/portal/synced-skills?version=3"
      : connectedInventory ? "/api/portal/synced-skills?version=2" : "/api/portal/synced-skills"),
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
  const inventory = connectedInventory ? parseConnectedInventory(synced, inventoryReconciliation ? 3 : 2) : null;
  const sets = [
    ...owned.map((group) => setSummary(group, true, identity.name)),
    ...shared.map((group) => setSummary(group, false, identity.name)),
  ];
  // Only the unified shell needs catalog membership; leave legacy reads unchanged.
  const favorites = sets.find(set => set.role === "owner" && set.isFavorites);
  if (includeFavoriteItems && favorites) {
    const detail = await loadSetData(api, favorites.id);
    if (detail.role !== "owner" || !detail.isFavorites) throw new Error("Favorites changed. Refresh your account.");
    favorites.items = detail.items;
    favorites.itemCount = detail.items.length;
    favorites.membershipSkillIds = detail.items.some(item => item.kind === "synced" && !item.syncedSkillId)
      ? undefined : detail.items.flatMap(item => item.syncedSkillId ? [item.syncedSkillId] : []);
  }
  return {
    ...(inventory ? { inventoryVersion: inventoryReconciliation ? 3 as const : 2 as const } : {}),
    skills: inventory?.skills ?? synced.skills,
    sets,
    devices: inventory?.devices ?? [],
    profile: {
      ...identity,
      handle: profile.profile.handle ?? "",
      published: profile.profile.profilePublished,
      publicUrl: profile.profile.publicUrl,
    },
    privateSourceConnected: null,
  };
}

type InventoryDevice = { id: string; deviceName: string; status: NonNullable<SyncedSkill["deviceStatus"]>; lastReportedAt: string | null; lastCheckedAt?: string | null; scanCoverage?: ScanCoverage[] | null };

function validCoverage(value: unknown): value is ScanCoverage[] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length !== 3) return false;
  return new Set(value.map(root => root?.source)).size === 3 && value.every(root => {
    if (!root || typeof root !== "object" || Array.isArray(root)
      || Object.keys(root).some(key => !["source", "state", "reason"].includes(key))
      || !["claude", "codex", "agents"].includes(root.source)
      || !["complete", "incomplete", "unavailable"].includes(root.state)) return false;
    if (root.state === "complete") return !Object.hasOwn(root, "reason");
    const reasons = root.state === "incomplete" ? ["changed", "invalid-entry", "invalid-metadata"] : ["missing", "unreadable", "redirected"];
    return Object.hasOwn(root, "reason") && reasons.includes(root.reason);
  });
}

export function parseConnectedInventory(value: unknown, version: 2 | 3 = 2) {
  const data = value as { inventoryVersion?: unknown; skills?: SyncedSkill[]; devices?: InventoryDevice[] } | null;
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  if (data?.inventoryVersion !== version || !Array.isArray(data.skills) || !Array.isArray(data.devices)
    || data.devices.some(device => !device || typeof device.id !== "string" || !device.id
      || typeof device.deviceName !== "string" || !device.deviceName.trim()
      || !["active", "revoked", "expired", "inactive"].includes(device.status)
      || !(device.lastReportedAt === null || date(device.lastReportedAt))
      || (version === 3 && ((!validCoverage(device.scanCoverage) || (device.scanCoverage !== null && device.lastReportedAt === null))
        || !(device.lastCheckedAt == null || date(device.lastCheckedAt)))))
    || new Set(data.devices.map(device => device.id)).size !== data.devices.length
    || data.skills.some(skill => !skill || typeof skill.id !== "string" || !skill.id
      || typeof skill.name !== "string" || !nullableString(skill.description)
      || typeof skill.source !== "string" || !date(skill.lastSeenAt)
      || !nullableString(skill.deviceId) || skill.deviceId === ""
      || !nullableString(skill.installationFolder) || !nullableString(skill.githubUrl)
      || typeof skill.isLocalOnly !== "boolean"
      || (version === 3 && typeof skill.isCurrent !== "boolean")
      || (skill.catalogSkillId != null && typeof skill.catalogSkillId !== "string")
      || (skill.gitRelativePath != null && typeof skill.gitRelativePath !== "string")
      || (skill.catalogSkillIdHint != null && typeof skill.catalogSkillIdHint !== "string")
      || (skill.installedFromSet != null && (typeof skill.installedFromSet !== "string" || skill.installedFromSet.length > 200)))
    || new Set(data.skills.map(skill => skill.id)).size !== data.skills.length) {
    throw new Error("The portal returned an invalid connected inventory response.");
  }
  const devices = new Map(data.devices.map(device => [device.id, device]));
  return {
    skills: data.skills.map(skill => {
      const device = skill.deviceId ? devices.get(skill.deviceId) : undefined;
      return { ...skill, inventoryVersion: version, deviceName: device?.deviceName ?? null,
        deviceStatus: device?.status ?? null, lastReportedAt: device?.lastReportedAt ?? null,
        ...(version === 3 ? { scanCoverage: device?.scanCoverage ?? null } : {}) };
    }),
    devices: data.devices.map(device => ({ id: device.id, name: device.deviceName,
      status: device.status, lastActive: device.lastReportedAt ?? "", lastReportedAt: device.lastReportedAt,
      ...(version === 3 ? { scanCoverage: device.scanCoverage ?? null, lastCheckedAt: device.lastCheckedAt ?? null } : {}) })),
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
      (item.syncedSkillId != null && (typeof item.syncedSkillId !== "string" || !item.syncedSkillId)) ||
      (item.catalogSkillId != null && (typeof item.catalogSkillId !== "string" || !item.catalogSkillId)) ||
      typeof item.description !== "string" || !Number.isFinite(item.position) ||
      !["synced", "catalog", "github"].includes(item.kind) ||
      (item.githubUrl !== null && typeof item.githubUrl !== "string")) ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) throw new Error("The portal returned an invalid set response.");
  return {
    ...setSummary(group, group.accessRole === "owner", group.ownerDisplayName || "Owner"),
    role: group.accessRole,
    appDeepLink: typeof group.appDeepLink === "string" ? group.appDeepLink : null,
    items: [...items].sort((a, b) => a.position - b.position).map((item) => ({
      id: item.id,
      // Older responses omit this ID. Shared viewers never get owner mappings.
      syncedSkillId: group.accessRole === "owner" && item.kind === "synced" ? item.syncedSkillId ?? null : null,
      catalogSkillId: item.catalogSkillId ?? null,
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

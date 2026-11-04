import type { GroupAccessRole } from "./group-access.js";

export type PortalGroupItemRow = {
  id: string;
  kind: string;
  syncedSkillId: string | null;
  catalogSkillId: string | null;
  itemGithubUrl: string | null;
  snapshotName: string | null;
  snapshotDescription: string | null;
  note: string | null;
  position: number;
  skillName: string | null;
  skillDescription: string | null;
  githubUrl: string | null;
  source: string | null;
  sourceKind?: string | null;
  metadataOnlyReason?: string | null;
  releaseId?: string | null;
  /** The owner's newest saved version, for owners only. */
  savedReleaseId?: string | null;
  /** The Set's owner owns the item's source (false in a duplicated Set). */
  sharedByOwner?: boolean | null;
};

export function portalGroupItem(row: PortalGroupItemRow, role: GroupAccessRole) {
  const publicCloudItem = role === "public" && (row.sourceKind === "cloud"
    || row.metadataOnlyReason === "cloud_deleted"
    || row.metadataOnlyReason === "cloud_confirmed_secret"
    || row.metadataOnlyReason === "synced_local_only");
  return {
    id: row.id,
    kind: row.kind,
    ...(role === "owner" ? { syncedSkillId: row.kind === "synced" ? row.syncedSkillId ?? null : null } : {}),
    ...(role === "owner" ? { catalogSkillId: row.kind === "catalog" ? row.catalogSkillId ?? null : null } : {}),
    name: row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill",
    description: publicCloudItem ? "" : row.skillDescription || row.snapshotDescription || row.note || "",
    githubUrl: publicCloudItem ? null : row.githubUrl || row.itemGithubUrl || null,
    source: publicCloudItem ? row.kind : row.source || row.kind,
    position: row.position,
    // Shared from the owner's cloud save; the owner also learns when a newer version is saved.
    ...(row.sourceKind === "cloud" && role !== "public" ? { cloudShared: true } : {}),
    // Invitees and the owner can read a private item's instructions on the web (same check as the download).
    ...(role !== "public" && (row.sourceKind === "cloud" || row.sourceKind === "private_github") && row.releaseId
      && !row.metadataOnlyReason && row.sharedByOwner === true ? { sharedReleaseId: row.releaseId } : {}),
    ...(role === "owner" && row.sourceKind === "cloud" && row.savedReleaseId && row.savedReleaseId !== row.releaseId
      ? { updateAvailable: true } : {}),
  };
}

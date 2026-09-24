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
};

export function portalGroupItem(row: PortalGroupItemRow, role: GroupAccessRole) {
  return {
    id: row.id,
    kind: row.kind,
    ...(role === "owner" ? { syncedSkillId: row.kind === "synced" ? row.syncedSkillId ?? null : null } : {}),
    name: row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill",
    description: row.skillDescription || row.snapshotDescription || row.note || "",
    githubUrl: row.githubUrl || row.itemGithubUrl || null,
    source: row.source || row.kind,
    position: row.position,
  };
}

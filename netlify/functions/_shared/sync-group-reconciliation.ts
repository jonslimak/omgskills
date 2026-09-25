import type { PoolClient } from "pg";
import { incrementGroupRevision } from "./group-storage.js";

export type ReconciliationSkill = {
  id: string;
  stableKey: string;
  source: string;
  sha: string | null;
  current: boolean;
};

export type ReconciliationItem = { id: string; groupId: string; syncedSkillId: string };
export type SyncedReferenceRepair = ReconciliationItem & { replacementId: string };

function migratedKey(skill: ReconciliationSkill): string | null {
  const source = skill.source.toLowerCase();
  if (!["codex", "claude", "agents"].includes(source)) return null;
  const prefix = `${skill.source}:`;
  if (!skill.stableKey.startsWith(prefix)) return null;
  // Only the old standard agent roots are known to map to location:v1 keys.
  const match = /^\/Users\/[^/]+\/\.(codex|claude|agents)\/skills\/([^/]+)$/.exec(
    skill.stableKey.slice(prefix.length),
  );
  if (!match || match[1] !== source || [".", ".."].includes(match[2])) return null;
  return `location:v1:${source}:${match[2]}`;
}

export function planSyncedReferenceRepairs(
  skills: ReconciliationSkill[],
  items: ReconciliationItem[],
): SyncedReferenceRepair[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const candidates: SyncedReferenceRepair[] = [];
  for (const item of items) {
    const old = byId.get(item.syncedSkillId);
    if (!old || old.current || !old.sha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(old.sha)) continue;
    const key = migratedKey(old);
    if (!key) continue;
    const matches = skills.filter((skill) => skill.current
      && skill.stableKey === key
      && skill.source.toLowerCase() === old.source.toLowerCase()
      && skill.sha === old.sha);
    if (matches.length !== 1) continue;
    const replacementId = matches[0].id;
    if (items.some((other) => other.groupId === item.groupId && other.syncedSkillId === replacementId)) continue;
    candidates.push({ ...item, replacementId });
  }
  // Never silently merge two historical memberships into the same installation.
  return candidates.filter((candidate) => candidates.filter((other) =>
    other.groupId === candidate.groupId && other.replacementId === candidate.replacementId,
  ).length === 1);
}

/** Caller owns the transaction. Dry runs also work in a read-only transaction. */
export async function reconcileSyncedGroupReferences(
  client: PoolClient,
  userId: string,
  options: { dryRun?: boolean; groupId?: string } = {},
): Promise<SyncedReferenceRepair[]> {
  if (!options.dryRun) {
    // Same lock order as inventory writes: owner, then groups in stable order.
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    await client.query(
      `SELECT id FROM skill_groups WHERE owner_user_id = $1
       AND ($2::uuid IS NULL OR id = $2) ORDER BY id FOR UPDATE`,
      [userId, options.groupId ?? null],
    );
  }
  const skills = await client.query<ReconciliationSkill>(
    `SELECT id, stable_key AS "stableKey", source, skill_md_sha AS sha, is_current AS current
     FROM synced_skills WHERE user_id = $1`,
    [userId],
  );
  const items = await client.query<ReconciliationItem>(
    `SELECT i.id, i.group_id AS "groupId", i.synced_skill_id AS "syncedSkillId"
     FROM skill_group_items i JOIN skill_groups g ON g.id = i.group_id
     WHERE g.owner_user_id = $1 AND i.kind = 'synced'
       AND ($2::uuid IS NULL OR g.id = $2) ORDER BY i.id`,
    [userId, options.groupId ?? null],
  );
  const repairs = planSyncedReferenceRepairs(skills.rows, items.rows);
  if (options.dryRun) return repairs;
  for (const repair of repairs) {
    const result = await client.query(
      `UPDATE skill_group_items SET synced_skill_id = $1
       WHERE id = $2 AND group_id = $3 AND synced_skill_id = $4`,
      [repair.replacementId, repair.id, repair.groupId, repair.syncedSkillId],
    );
    if (result.rowCount !== 1) throw new Error("Synced reference changed during reconciliation");
  }
  for (const groupId of new Set(repairs.map((repair) => repair.groupId))) {
    await incrementGroupRevision(client, groupId);
  }
  return repairs;
}

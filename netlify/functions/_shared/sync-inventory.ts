import type { PoolClient } from "pg";
import type { SyncSkill } from "./sync-skill.js";
import { reconcileSyncedGroupReferences } from "./sync-group-reconciliation.js";

export async function writeSyncInventory(
  client: PoolClient,
  userId: string,
  skills: SyncSkill[],
  options: { deviceId?: string; now?: Date } = {}
) {
  const deviceId = options.deviceId ?? null;
  const now = options.now ?? new Date();
  await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const runResult = await client.query<{ id: string }>(
    "INSERT INTO sync_runs (user_id, device_id, status) VALUES ($1, $2, 'started') RETURNING id",
    [userId, deviceId]
  );
  const syncRunId = runResult.rows[0].id;

  for (const skill of skills) {
    await client.query(
      `
        INSERT INTO synced_skills (
          user_id, sync_run_id, stable_key, skill_md_sha, identity_status, name, description,
          catalog_skill_id, github_url, is_local_only, source, device_id,
          git_relative_path, catalog_skill_id_hint, is_current, last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15)
        ON CONFLICT ${deviceId
          ? "(user_id, device_id, stable_key) WHERE device_id IS NOT NULL"
          : "(user_id, stable_key) WHERE device_id IS NULL"}
        DO UPDATE SET
          sync_run_id = EXCLUDED.sync_run_id,
          skill_md_sha = EXCLUDED.skill_md_sha,
          identity_status = EXCLUDED.identity_status,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          catalog_skill_id = EXCLUDED.catalog_skill_id,
          github_url = EXCLUDED.github_url,
          is_local_only = EXCLUDED.is_local_only,
          source = EXCLUDED.source,
          git_relative_path = EXCLUDED.git_relative_path,
          catalog_skill_id_hint = EXCLUDED.catalog_skill_id_hint,
          is_current = true,
          last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        userId,
        syncRunId,
        skill.stableKey,
        skill.skillMdSha,
        skill.identityStatus,
        skill.name,
        skill.description,
        skill.catalogSkillId,
        skill.githubUrl,
        skill.isLocalOnly,
        skill.source,
        deviceId,
        skill.gitRelativePath ?? null,
        skill.catalogSkillIdHint ?? null,
        now
      ]
    );
  }

  // Only legacy snapshots infer absence. Presence reports never remove history.
  if (!deviceId && skills.length > 0) {
    await client.query(
      `
        UPDATE synced_skills
        SET is_current = false
        WHERE user_id = $1
          AND device_id IS NULL
          AND stable_key <> ALL($2::text[])
      `,
      [userId, skills.map((skill) => skill.stableKey)]
    );
  } else if (!deviceId) {
    await client.query("UPDATE synced_skills SET is_current = false WHERE user_id = $1 AND device_id IS NULL", [userId]);
  }

  if (!deviceId) await reconcileSyncedGroupReferences(client, userId);

  await client.query(
    "UPDATE sync_runs SET status = 'completed', completed_at = $2 WHERE id = $1",
    [syncRunId, now]
  );
  return syncRunId;
}

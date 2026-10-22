import type { Pool, PoolClient } from "pg";
import type { SyncSkill } from "./sync-skill.js";
import { reconcileSyncedGroupReferences } from "./sync-group-reconciliation.js";
import { lockLegacyInventorySchema } from "./legacy-inventory-schema.js";
import { rollback } from "./device-auth.js";

export async function writeSyncInventory(
  client: PoolClient,
  userId: string,
  skills: SyncSkill[]
) {
  const deviceScoped = await lockLegacyInventorySchema(client);
  await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const runResult = await client.query<{ id: string }>(
    "INSERT INTO sync_runs (user_id, status) VALUES ($1, 'started') RETURNING id",
    [userId]
  );
  const syncRunId = runResult.rows[0].id;

  for (const skill of skills) {
    await client.query(
      `
        INSERT INTO synced_skills (
          user_id, sync_run_id, stable_key, skill_md_sha, identity_status, name, description,
          catalog_skill_id, github_url, is_local_only, source, is_current, last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now())
        ON CONFLICT (user_id, stable_key) ${deviceScoped ? "WHERE device_id IS NULL" : ""}
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
          is_current = true,
          last_seen_at = now()
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
        skill.source
      ]
    );
  }

  if (skills.length > 0) {
    await client.query(
      `
        UPDATE synced_skills
        SET is_current = false
        WHERE user_id = $1
          ${deviceScoped ? "AND device_id IS NULL" : ""}
          AND stable_key <> ALL($2::text[])
      `,
      [userId, skills.map((skill) => skill.stableKey)]
    );
  } else {
    await client.query(`UPDATE synced_skills SET is_current = false WHERE user_id = $1
      ${deviceScoped ? "AND device_id IS NULL" : ""}`, [userId]);
  }

  await reconcileSyncedGroupReferences(client, userId);

  await client.query(
    "UPDATE sync_runs SET status = 'completed', completed_at = now() WHERE id = $1",
    [syncRunId]
  );
  return syncRunId;
}

export async function readLegacySyncInventory(pool: Pool, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const deviceScoped = await lockLegacyInventorySchema(client, true);
    const result = await client.query(
      `SELECT id, stable_key AS "stableKey", skill_md_sha AS "skillMdSha",
         identity_status AS "identityStatus", name, description,
         catalog_skill_id AS "catalogSkillId", github_url AS "githubUrl",
         is_local_only AS "isLocalOnly", source, is_current AS "isCurrent",
         last_seen_at AS "lastSeenAt"
       FROM synced_skills WHERE user_id = $1 AND is_current = true
         ${deviceScoped ? "AND device_id IS NULL" : ""}
       ORDER BY lower(name), source`, [userId]
    );
    await client.query("COMMIT");
    return { skills: result.rows };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

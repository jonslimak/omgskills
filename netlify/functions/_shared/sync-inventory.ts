import type { Pool, PoolClient } from "pg";
import type { SyncSkill } from "./sync-skill.js";
import { reconcileSyncedGroupReferences } from "./sync-group-reconciliation.js";
import type { RootCoverage } from "./inventory-reconciliation.js";
import { hasInventorySetOrigin, lockLegacyInventorySchema } from "./legacy-inventory-schema.js";
import { rollback } from "./device-auth.js";

export async function writeSyncInventory(
  client: PoolClient,
  userId: string,
  skills: SyncSkill[],
  options: { deviceId?: string; now?: Date; roots?: RootCoverage[] } = {}
) {
  const deviceId = options.deviceId ?? null;
  const now = options.now ?? new Date();
  if (!deviceId) {
    return { syncRunId: await writeLegacyInventory(client, userId, skills), missingSkillCount: 0 };
  }
  if (!await lockLegacyInventorySchema(client)) {
    throw new Response("Per-Mac inventory schema is not available", { status: 503 });
  }
  const storesSetOrigin = await hasInventorySetOrigin(client);
  await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const runResult = await client.query<{ id: string }>(
    "INSERT INTO sync_runs (user_id, device_id, status, scan_coverage) VALUES ($1, $2, 'started', $3::jsonb) RETURNING id",
    [userId, deviceId, options.roots ? JSON.stringify(options.roots) : null]
  );
  const syncRunId = runResult.rows[0].id;

  for (const skill of skills) {
    await client.query(
      `
        INSERT INTO synced_skills (
          user_id, sync_run_id, stable_key, skill_md_sha, identity_status, name, description,
          catalog_skill_id, github_url, is_local_only, source, device_id,
          git_relative_path, catalog_skill_id_hint, is_current, last_seen_at
          ${storesSetOrigin ? ", installed_from_set" : ""}
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15${storesSetOrigin ? ", $16" : ""})
        ON CONFLICT (user_id, device_id, stable_key) WHERE device_id IS NOT NULL
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
          ${storesSetOrigin ? ", installed_from_set = EXCLUDED.installed_from_set" : ""}
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
        now,
        ...(storesSetOrigin ? [skill.installedFromSet ?? null] : [])
      ]
    );
  }

  let missingSkillCount = 0;
  if (deviceId && options.roots) {
    const completeSources = options.roots.filter(root => root.state === "complete").map(root => root.source);
    const missing = await client.query(
      `UPDATE synced_skills SET is_current = false
       WHERE user_id = $1 AND device_id = $2 AND source = ANY($3::text[])
         AND is_current = true AND sync_run_id <> $4`,
      [userId, deviceId, completeSources, syncRunId]
    );
    missingSkillCount = missing.rowCount ?? 0;
  }

  await client.query(
    "UPDATE sync_runs SET status = 'completed', completed_at = $2 WHERE id = $1",
    [syncRunId, now]
  );
  return { syncRunId, missingSkillCount };
}

// Keep the bridge writer independent of columns introduced by later migrations.
async function writeLegacyInventory(client: PoolClient, userId: string, skills: SyncSkill[]) {
  const deviceScoped = await lockLegacyInventorySchema(client);
  const storesSetOrigin = await hasInventorySetOrigin(client);
  await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const runResult = await client.query<{ id: string }>(
    "INSERT INTO sync_runs (user_id, status) VALUES ($1, 'started') RETURNING id", [userId]
  );
  const syncRunId = runResult.rows[0].id;
  for (const skill of skills) {
    await client.query(
      `INSERT INTO synced_skills (
        user_id, sync_run_id, stable_key, skill_md_sha, identity_status, name, description,
        catalog_skill_id, github_url, is_local_only, source, is_current, last_seen_at
        ${storesSetOrigin ? ", installed_from_set" : ""}
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now()${storesSetOrigin ? ", $12" : ""})
      ON CONFLICT (user_id, stable_key) ${deviceScoped ? "WHERE device_id IS NULL" : ""}
      DO UPDATE SET sync_run_id = EXCLUDED.sync_run_id,
        skill_md_sha = EXCLUDED.skill_md_sha, identity_status = EXCLUDED.identity_status,
        name = EXCLUDED.name, description = EXCLUDED.description,
        catalog_skill_id = EXCLUDED.catalog_skill_id, github_url = EXCLUDED.github_url,
        is_local_only = EXCLUDED.is_local_only, source = EXCLUDED.source,
        is_current = true, last_seen_at = now()
        ${storesSetOrigin ? ", installed_from_set = EXCLUDED.installed_from_set" : ""}`,
      [userId, syncRunId, skill.stableKey, skill.skillMdSha, skill.identityStatus,
        skill.name, skill.description, skill.catalogSkillId, skill.githubUrl, skill.isLocalOnly, skill.source,
        ...(storesSetOrigin ? [skill.installedFromSet ?? null] : [])]
    );
  }
  await client.query(
    `UPDATE synced_skills SET is_current = false WHERE user_id = $1
      ${deviceScoped ? "AND device_id IS NULL" : ""}
      AND stable_key <> ALL($2::text[])`,
    [userId, skills.map(skill => skill.stableKey)]
  );
  await reconcileSyncedGroupReferences(client, userId);
  await client.query("UPDATE sync_runs SET status = 'completed', completed_at = now() WHERE id = $1", [syncRunId]);
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
         , to_jsonb(skill)->>'installed_from_set' AS "installedFromSet"
       FROM synced_skills skill WHERE user_id = $1 AND is_current = true
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

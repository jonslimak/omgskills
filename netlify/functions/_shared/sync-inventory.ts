import type { PoolClient } from "pg";
import type { SyncSkill } from "./sync-skill.js";

export async function writeSyncInventory(
  client: PoolClient,
  userId: string,
  skills: SyncSkill[]
) {
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
        ON CONFLICT (user_id, stable_key)
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
          AND stable_key <> ALL($2::text[])
      `,
      [userId, skills.map((skill) => skill.stableKey)]
    );
  } else {
    await client.query("UPDATE synced_skills SET is_current = false WHERE user_id = $1", [userId]);
  }

  await client.query(
    "UPDATE sync_runs SET status = 'completed', completed_at = now() WHERE id = $1",
    [syncRunId]
  );
  return syncRunId;
}

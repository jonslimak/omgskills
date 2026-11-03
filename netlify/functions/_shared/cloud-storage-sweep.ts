import type { Pool } from "pg";
import { cloudBlobKey, type CloudSweepStore } from "./cloud-store.js";
import { drainCloudPurge } from "./cloud-save.js";

const HOUR = 60 * 60 * 1000;
const PAGE_SIZE = 20;
const LOCK_ID = 174285916;
const KEY = /^cloud\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{40})(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;

/** Scan bounded, resumable pages. Unknown keys are left alone. */
export async function sweepCloudStorage(pool: Pool, store: CloudSweepStore, options: { now?: Date; budgetMs?: number } = {}) {
  const cutoff = (options.now ?? new Date()).getTime() - HOUR;
  const deadline = Date.now() + (options.budgetMs ?? 20_000);
  const client = await pool.connect();
  let locked = false;
  let scanned = 0, deleted = 0, skipped = 0;
  try {
    locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_ID])).rows[0].locked;
    if (!locked) return { skippedRun: true, scanned, deleted, skipped };
    let cursor = (await client.query<{ continuation_token: string | null }>("SELECT continuation_token FROM cloud_storage_sweep_cursor WHERE id = true")).rows[0]?.continuation_token ?? null;
    do {
    const page = await store.listCloudObjects(cursor, PAGE_SIZE);
    for (const object of page.objects) {
      if (Date.now() >= deadline) return { skippedRun: false, scanned, deleted, skipped, incomplete: true };
      scanned += 1;
      const match = KEY.exec(object.key);
      if (!match || object.modifiedAt.getTime() >= cutoff) { skipped += 1; continue; }
      const [, userId, sha] = match;
      const lock = await pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("SELECT 1 FROM cloud_save_settings WHERE user_id = $1 FOR UPDATE", [userId]);
        const referenced = await lock.query(`
          SELECT 1 FROM cloud_blobs WHERE user_id = $1 AND (storage_key = $2 OR (storage_key IS NULL AND blob_sha = $3 AND $2 = $4))
          UNION ALL SELECT 1 FROM cloud_storage_purge_queue WHERE user_id = $1 AND storage_key = $2
          UNION ALL SELECT 1 FROM cloud_purge_queue WHERE user_id = $1 AND blob_sha = $3 AND $2 = $4
          UNION ALL SELECT 1 FROM cloud_release_files file
            JOIN skill_releases release ON release.id = file.release_id
            JOIN skill_sources source ON source.id = release.source_id
            WHERE source.owner_user_id = $1 AND file.blob_sha = $3 AND $2 = $4
          LIMIT 1`, [userId, object.key, sha, cloudBlobKey(userId, sha)]);
        if (referenced.rowCount) { skipped += 1; await lock.query("ROLLBACK"); continue; }
        if ((await store.deleteMany([object.key])).length) throw new Error("Cloud storage deletion failed");
        await lock.query("COMMIT");
        deleted += 1;
      } catch (error) {
        await lock.query("ROLLBACK");
        throw error;
      } finally {
        lock.release();
      }
    }
    cursor = page.next;
    await client.query("INSERT INTO cloud_storage_sweep_cursor (id, continuation_token) VALUES (true, $1) ON CONFLICT (id) DO UPDATE SET continuation_token = EXCLUDED.continuation_token", [cursor]);
    } while (cursor && Date.now() < deadline);
    if (Date.now() < deadline) {
      const owners = await client.query<{ user_id: string }>(`
        SELECT user_id FROM (
          SELECT user_id, min(queued_at) AS oldest FROM cloud_purge_queue GROUP BY user_id
          UNION ALL SELECT user_id, min(queued_at) AS oldest FROM cloud_storage_purge_queue GROUP BY user_id
        ) queued GROUP BY user_id ORDER BY min(oldest) LIMIT 1`);
      if (owners.rows[0]) await drainCloudPurge(pool, store, owners.rows[0].user_id, 20);
    }
    return { skippedRun: false, scanned, deleted, skipped, incomplete: false };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
    client.release();
  }
}

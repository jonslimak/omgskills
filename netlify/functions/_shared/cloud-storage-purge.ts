import pg, { type Pool } from "pg";
import type { CloudObjectStore } from "./cloud-store.js";

/*
 * The one queue of stored files to remove, and the one place that removes them.
 *
 * Every upload stores its file under a new, never reused name, so a name that no saved
 * record points at can never be needed again. Queued names are of two kinds:
 *   - reserved by an upload before it writes the file. A finished upload takes the row off
 *     the queue; a failed one makes it due at once; a crashed one becomes due after an hour,
 *     far longer than any upload can run.
 *   - freed by a delete, or found unused by the hourly sweep. These are due at once.
 * Removing a due name needs no per-user lock. A file that fails to delete is retried an hour
 * later and never holds up the others.
 */

export const UPLOAD_RESERVATION = "1 hour";
const RETRY_AFTER = "1 hour";
const BATCH = 1000;
const WARN_AFTER_ATTEMPTS = 5;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** cloud/<user>/<blob sha>, optionally followed by /<upload id>. Anything else is not ours. */
export const CLOUD_KEY = new RegExp(`^cloud/(${UUID})/([0-9a-f]{40})(?:/${UUID})?$`);

/**
 * SQL for the names in `$1::text[]` that saved records still point at: a file row with that
 * name, or, for names from before per-upload names, a file row or saved version that lists
 * the same user and file. Used as the last check before anything is queued or removed.
 */
const IN_USE = `
  WITH name AS (
    SELECT key,
      CASE WHEN key ~ '^cloud/${UUID}/[0-9a-f]{40}$' THEN split_part(key, '/', 2)::uuid END AS legacy_user,
      split_part(key, '/', 3) AS sha
    FROM unnest($1::text[]) AS key
  )
  SELECT name.key FROM name
  WHERE EXISTS (SELECT 1 FROM cloud_blobs blob WHERE blob.storage_key = name.key)
    OR (name.legacy_user IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM cloud_blobs blob
        WHERE blob.user_id = name.legacy_user AND blob.blob_sha = name.sha AND blob.storage_key IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM cloud_release_files file
        JOIN skill_releases release ON release.id = file.release_id
        JOIN skill_sources source ON source.id = release.source_id
        WHERE source.owner_user_id = name.legacy_user AND file.blob_sha = name.sha
      )
    ))
`;

type Queryable = Pick<Pool, "query">;

/**
 * Reserves names before an upload writes them. Runs on its own connection, outside the
 * upload's transaction, so the reservation stands even if that transaction rolls back.
 */
export async function reserveStorageKeys(pool: Pool, userId: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const client = new pg.Client(pool.options);
  try {
    await client.connect();
    await client.query(
      `INSERT INTO cloud_storage_purge_queue (user_id, storage_key, not_before)
       SELECT $1, key, now() + interval '${UPLOAD_RESERVATION}' FROM unnest($2::text[]) AS key
       ON CONFLICT (storage_key) DO NOTHING`,
      [userId, keys]
    );
  } finally {
    await client.end();
  }
}

/**
 * After an upload failed and every one of its writes has finished, its reserved names are
 * due for removal at once. Never throws: if this fails the reservation expires on its own.
 */
export async function releaseStorageKeys(db: Queryable, userId: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await db.query(
      "UPDATE cloud_storage_purge_queue SET not_before = now() WHERE user_id = $1 AND storage_key = ANY($2::text[])",
      [userId, keys]
    );
  } catch {
    // The reservation becomes due after an hour anyway.
  }
}

/**
 * Queues names found in storage that nothing points at. Names already queued keep their
 * place, so an upload's reservation is never cut short. Returns how many were queued.
 */
export async function queueUnusedStorageKeys(db: Queryable, candidates: { userId: string; key: string }[]): Promise<number> {
  if (!candidates.length) return 0;
  const result = await db.query(
    `WITH in_use AS (${IN_USE})
     INSERT INTO cloud_storage_purge_queue (user_id, storage_key)
     SELECT candidate.user_id, candidate.key
     FROM unnest($2::uuid[], $1::text[]) AS candidate(user_id, key)
     WHERE candidate.key NOT IN (SELECT key FROM in_use)
     ON CONFLICT (storage_key) DO NOTHING`,
    [candidates.map((candidate) => candidate.key), candidates.map((candidate) => candidate.userId)]
  );
  return result.rowCount ?? 0;
}

export type PurgeStats = { deleted: number; failed: number; kept: number; storageDown: boolean };

/**
 * Removes up to BATCH due names, for one user or for everyone. Rows are claimed with SKIP
 * LOCKED, so runs at the same time never take the same rows.
 */
async function purgeBatch(pool: Pool, store: CloudObjectStore, userId: string | null, size: number): Promise<PurgeStats & { claimed: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query<{ storage_key: string }>(
      `SELECT storage_key FROM cloud_storage_purge_queue
       WHERE not_before <= now() AND ($1::uuid IS NULL OR user_id = $1)
       ORDER BY not_before, storage_key
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [userId, size]
    );
    const claimed = due.rows.map((row) => row.storage_key);
    if (!claimed.length) {
      await client.query("COMMIT");
      return { claimed: 0, deleted: 0, failed: 0, kept: 0, storageDown: false };
    }
    // Last check: a name something still points at is not garbage. Drop it from the queue.
    const inUse = new Set((await client.query<{ key: string }>(IN_USE, [claimed])).rows.map((row) => row.key));
    const doomed = claimed.filter((key) => !inUse.has(key));
    let failed: Set<string>;
    let storageDown = false;
    try {
      failed = new Set(doomed.length ? await store.deleteMany(doomed) : []);
    } catch {
      failed = new Set(doomed);
      storageDown = true;
    }
    const done = claimed.filter((key) => !failed.has(key));
    await client.query("DELETE FROM cloud_storage_purge_queue WHERE storage_key = ANY($1::text[])", [done]);
    if (failed.size) {
      const retried = await client.query<{ attempts: number }>(
        `UPDATE cloud_storage_purge_queue
         SET attempts = attempts + 1, not_before = now() + interval '${RETRY_AFTER}', last_error = $2
         WHERE storage_key = ANY($1::text[])
         RETURNING attempts`,
        [[...failed], storageDown ? "storage unavailable" : "delete failed"]
      );
      const stuck = retried.rows.filter((row) => row.attempts >= WARN_AFTER_ATTEMPTS).length;
      if (stuck) console.warn("cloud storage purge: files keep failing to delete", { files: stuck });
    }
    await client.query("COMMIT");
    return { claimed: claimed.length, deleted: doomed.length - failed.size, failed: failed.size, kept: inUse.size, storageDown };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Removes due names for everyone until the queue is empty, storage is down, or time runs out. */
export async function purgeDueStorage(pool: Pool, store: CloudObjectStore, deadline: number): Promise<PurgeStats> {
  const total: PurgeStats = { deleted: 0, failed: 0, kept: 0, storageDown: false };
  while (Date.now() < deadline) {
    const batch = await purgeBatch(pool, store, null, BATCH);
    total.deleted += batch.deleted;
    total.failed += batch.failed;
    total.kept += batch.kept;
    if (batch.storageDown) total.storageDown = true;
    if (batch.claimed < BATCH || batch.storageDown) break;
  }
  return total;
}

/**
 * Removes up to `limit` of one user's due names right away, as after a delete, and returns
 * how many of that user's names are still queued.
 */
export async function drainCloudPurge(pool: Pool, store: CloudObjectStore, userId: string, limit = 3000): Promise<number> {
  for (let left = limit; left > 0;) {
    const size = Math.min(BATCH, left);
    const batch = await purgeBatch(pool, store, userId, size);
    left -= batch.claimed;
    if (batch.claimed < size || batch.storageDown) break;
  }
  return queuedFileCount(pool, userId);
}

export async function queuedFileCount(db: Queryable, userId: string): Promise<number> {
  return (await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM cloud_storage_purge_queue WHERE user_id = $1", [userId]
  )).rows[0].count;
}

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { CloudSweepStore } from "./cloud-store.js";
import { CLOUD_KEY, purgeDueStorage, queueUnusedStorageKeys, type PurgeStats } from "./cloud-storage-purge.js";

/** Files newer than this are left alone: a backstop on top of upload reservations. */
const MIN_AGE_MS = 60 * 60 * 1000;
/** The most R2 lists in one call. */
const PAGE_SIZE = 1000;
/** Far longer than one run can last (scheduled functions stop at 30 s), so a crashed run frees it. */
const LEASE = "2 minutes";
const DEFAULT_BUDGET_MS = 20_000;
/** Share of the budget spent removing queued files before scanning. */
const FIRST_PURGE_SHARE = 0.4;

export type SweepResult = {
  skippedRun: boolean;
  purged: PurgeStats;
  scanned: number;
  queued: number;
  passComplete: boolean;
};

/**
 * One hourly run: remove due files from the queue, scan the next pages of storage for files
 * nothing points at and queue them, then remove what is due again. Only one run works at a
 * time, held by a lease row that expires by itself. The scan position is saved after every
 * page, so each run carries on where the last one stopped.
 */
export async function sweepCloudStorage(
  pool: Pool,
  store: CloudSweepStore,
  options: { now?: Date; budgetMs?: number; pageSize?: number } = {}
): Promise<SweepResult> {
  const started = Date.now();
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = started + budget;
  const purged: PurgeStats = { deleted: 0, failed: 0, kept: 0, storageDown: false };
  const result: SweepResult = { skippedRun: false, purged, scanned: 0, queued: 0, passComplete: false };
  const add = (stats: PurgeStats) => {
    purged.deleted += stats.deleted;
    purged.failed += stats.failed;
    purged.kept += stats.kept;
    purged.storageDown ||= stats.storageDown;
  };

  const lease = randomUUID();
  const claim = await pool.query<{ continuation_token: string | null }>(
    `INSERT INTO cloud_storage_sweep_cursor AS cursor (id, lease_token, lease_until)
     VALUES (true, $1, now() + interval '${LEASE}')
     ON CONFLICT (id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
       WHERE cursor.lease_until IS NULL OR cursor.lease_until < now()
     RETURNING continuation_token`,
    [lease]
  );
  if (!claim.rowCount) return { ...result, skippedRun: true };

  try {
    add(await purgeDueStorage(pool, store, started + budget * FIRST_PURGE_SHARE));

    const cutoff = (options.now ?? new Date()).getTime() - MIN_AGE_MS;
    let cursor = claim.rows[0].continuation_token;
    while (Date.now() < deadline) {
      const page = await store.listCloudObjects(cursor, options.pageSize ?? PAGE_SIZE);
      const candidates: { userId: string; key: string }[] = [];
      for (const object of page.objects) {
        const match = CLOUD_KEY.exec(object.key);
        if (match && object.modifiedAt.getTime() < cutoff) candidates.push({ userId: match[1], key: object.key });
      }
      result.scanned += page.objects.length;
      result.queued += await queueUnusedStorageKeys(pool, candidates);
      cursor = page.next;
      const saved = await pool.query(
        `UPDATE cloud_storage_sweep_cursor
         SET continuation_token = $2, lease_until = now() + interval '${LEASE}',
             last_pass_completed_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_pass_completed_at END
         WHERE id AND lease_token = $1`,
        [lease, cursor]
      );
      if (!saved.rowCount) throw new Error("Cloud storage sweep lost its lease");
      if (!cursor) {
        result.passComplete = true;
        break;
      }
    }

    if (!purged.storageDown) add(await purgeDueStorage(pool, store, deadline));
    return result;
  } finally {
    await pool.query(
      "UPDATE cloud_storage_sweep_cursor SET lease_token = NULL, lease_until = NULL WHERE id AND lease_token = $1",
      [lease]
    ).catch(() => undefined);
  }
}

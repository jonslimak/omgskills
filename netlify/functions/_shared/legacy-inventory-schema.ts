import type { PoolClient } from "pg";

/** Caller owns the transaction. Acquire these before authenticating an upload. */
export async function lockLegacyInventorySchema(client: PoolClient, readOnly = false) {
  // The device-inventory migration locks sync_runs before synced_skills. Hold
  // the same order until commit so its constraint cannot change after inspection.
  await client.query(readOnly
    ? "LOCK TABLE sync_runs, synced_skills IN ACCESS SHARE MODE"
    : "LOCK TABLE sync_runs, synced_skills IN ROW EXCLUSIVE MODE");
  const result = await client.query<{ device_scoped: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = 'synced_skills'::regclass AND attname = 'device_id'
         AND attnum > 0 AND NOT attisdropped
     ) AS device_scoped`
  );
  return result.rows[0].device_scoped;
}

/** Inspect under the upload's schema locks so an additive migration cannot race the write. */
export async function hasInventorySetOrigin(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ available: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute
     WHERE attrelid = 'synced_skills'::regclass AND attname = 'installed_from_set'
       AND attnum > 0 AND NOT attisdropped) AS available`
  );
  return result.rows[0]?.available === true;
}

export function requireLegacyInventoryReport(body: Record<string, unknown>) {
  if (body.reportVersion === 2 || body.reportVersion === 3) {
    throw new Response("Per-Mac inventory is not enabled on this release", { status: 503 });
  }
  if (body.reportVersion !== undefined && body.reportVersion !== 1) {
    throw new Response("Unsupported reportVersion", { status: 400 });
  }
}

export function requireLegacyInventoryRead(req: Request) {
  const versions = new URL(req.url).searchParams.getAll("version");
  if (!versions.length || (versions.length === 1 && versions[0] === "1")) return;
  if (versions.length === 1 && ["2", "3"].includes(versions[0])) {
    throw new Response("Per-Mac inventory is not enabled on this release", { status: 503 });
  }
  throw new Response("Unsupported inventory version", { status: 400 });
}

import type { Pool, PoolClient } from "pg";
import { requireDeviceToken, rollback, touchDeviceAfterSuccessfulUse } from "./device-auth.js";
import { requireProductionInventory } from "./production-inventory.js";

export const inventorySources = ["claude", "codex", "agents"] as const;
type InventorySource = typeof inventorySources[number];
export type RootCoverage = {
  source: InventorySource;
  state: "complete" | "incomplete" | "unavailable";
  reason?: "changed" | "invalid-entry" | "invalid-metadata" | "missing" | "unreadable" | "redirected";
};
export type ReconciliationInput = { baseRevision: string | null; roots: RootCoverage[] };

export function parseInventoryCheck(body: Record<string, unknown>): { baseRevision: string } {
  if (Object.keys(body).length !== 3
    || Object.keys(body).some(key => !["reportVersion", "mode", "baseRevision"].includes(key))
    || body.reportVersion !== 3 || body.mode !== "check" || typeof body.baseRevision !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.baseRevision)) {
    throw new Response("Use the exact version-3 check body with a non-null revision", { status: 400 });
  }
  return { baseRevision: body.baseRevision.toLowerCase() };
}

export function parseReconciliationFields(body: Record<string, unknown>): ReconciliationInput {
  const revision = body.baseRevision;
  if (revision !== null && (typeof revision !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(revision))) {
    throw new Response("baseRevision must be a UUID or null", { status: 400 });
  }
  if (!Array.isArray(body.roots) || body.roots.length !== 3) {
    throw new Response("roots must cover all three agent folders", { status: 400 });
  }
  const roots = body.roots.map((value): RootCoverage => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["source", "state", "reason"].includes(key))
      || !inventorySources.includes(value.source)) {
      throw new Response("Invalid root coverage", { status: 400 });
    }
    const reasons = value.state === "incomplete" ? ["changed", "invalid-entry", "invalid-metadata"]
      : value.state === "unavailable" ? ["missing", "unreadable", "redirected"] : [];
    if (value.state === "complete" ? Object.hasOwn(value, "reason")
      : !reasons.includes(value.reason)) {
      throw new Response("Root state and reason do not match", { status: 400 });
    }
    return value.state === "complete" ? { source: value.source, state: "complete" }
      : { source: value.source, state: value.state, reason: value.reason };
  });
  if (new Set(roots.map(root => root.source)).size !== 3) {
    throw new Response("Duplicate root coverage", { status: 400 });
  }
  return { baseRevision: revision?.toLowerCase() ?? null, roots };
}

export function requireInventoryReconciliation(
  req: Request, env: Record<string, string | undefined> = process.env, deployContext?: string,
  endpoint: "/api/portal/sync-upload" | "/api/portal/synced-skills" = "/api/portal/sync-upload",
  siteId?: string,
) {
  if (env.CONTEXT !== "dev") {
    requireProductionInventory(req, env, deployContext, siteId, endpoint === "/api/portal/synced-skills" ? "read" : "sync");
    if (new URL(req.url).pathname !== endpoint) throw new Response("Invalid inventory endpoint", { status: 400 });
    return;
  }
  requireLocalInventoryReconciliation(req, env, deployContext, endpoint);
}

export function requireLocalInventoryReconciliation(
  req: Request, env: Record<string, string | undefined> = process.env, deployContext?: string,
  endpoint: "/api/portal/sync-upload" | "/api/portal/synced-skills" = "/api/portal/sync-upload"
) {
  let configured: URL;
  const invalid = () => new Response("Inventory reconciliation is not enabled for this environment", { status: 503 });
  try { configured = new URL(env.PORTAL_TEST_API_ORIGIN ?? ""); } catch { throw invalid(); }
  const request = new URL(req.url);
  if (env.OMGSKILLS_INVENTORY_RECONCILIATION_TEST !== "1"
    || env.OMGSKILLS_CONNECTED_INVENTORY_TEST !== "1"
    || env.PORTAL_TEST_ENVIRONMENT_VERIFIED !== "1" || env.CONTEXT !== "dev"
    || (deployContext !== undefined && deployContext !== "dev")
    || !["development", "test"].includes(env.NODE_ENV ?? "")
    || configured.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)
    || !configured.port || configured.username || configured.password || configured.pathname !== "/"
    || configured.search || configured.hash || request.origin !== configured.origin
    || !["/api/portal/sync-upload", "/api/portal/synced-skills"].includes(endpoint)
    || request.pathname !== endpoint) throw invalid();
}

export async function inventoryRevisionState(client: PoolClient, userId: string, deviceId: string) {
  const result = await client.query<{ revision: string | null; protocol: number }>(
    `SELECT inventory_revision AS revision, inventory_protocol AS protocol
     FROM device_tokens WHERE id = $1 AND user_id = $2 FOR UPDATE`, [deviceId, userId]
  );
  if (!result.rows[0]) throw new Response("Device is unavailable", { status: 401 });
  return result.rows[0];
}

export async function readInventoryRevision(pool: Pool, req: Request, now = new Date()) {
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw new Response("Database is not available", { status: 503 }); }
  try {
    await client.query("BEGIN");
    const device = await requireDeviceToken(req, client, "sync:write", now);
    const state = await inventoryRevisionState(client, device.userId, device.deviceId);
    await client.query("COMMIT");
    return { reportVersion: 3 as const, revision: state.revision };
  } catch (error) { await rollback(client); throw error; }
  finally { client.release(); }
}

export async function performInventoryCheck(pool: Pool, req: Request, body: Record<string, unknown>, now = new Date()) {
  const { baseRevision } = parseInventoryCheck(body);
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw new Response("Database is not available", { status: 503 }); }
  try {
    await client.query("BEGIN");
    const device = await requireDeviceToken(req, client, "sync:write", now);
    // The upload writer takes the same device lock before advancing its revision.
    const state = await inventoryRevisionState(client, device.userId, device.deviceId);
    const stale = () => new Response("A current complete report is required; take a fresh scan", { status: 409 });
    if (state.protocol !== 3 || state.revision !== baseRevision) throw stale();
    const report = await client.query<{ coverage: unknown }>(
      `SELECT scan_coverage AS coverage FROM sync_runs
       WHERE id=$1 AND user_id=$2 AND device_id=$3 AND status='completed' AND completed_at IS NOT NULL`,
      [baseRevision, device.userId, device.deviceId]
    );
    let roots: RootCoverage[];
    try { roots = parseReconciliationFields({ baseRevision, roots: report.rows[0]?.coverage }).roots; }
    catch (error) { if (error instanceof Response) throw stale(); throw error; }
    if (!roots.every(root => root.state === "complete")) throw stale();
    const checked = await client.query<{ checkedAt: Date }>(
      `UPDATE device_tokens SET inventory_checked_at=GREATEST(inventory_checked_at,$3::timestamptz)
       WHERE id=$1 AND user_id=$2 RETURNING inventory_checked_at AS "checkedAt"`,
      [device.deviceId, device.userId, now]
    );
    await touchDeviceAfterSuccessfulUse(client, device.deviceId, now);
    await client.query("COMMIT");
    return { reportVersion: 3 as const, mode: "checked" as const, deviceId: device.deviceId,
      revision: baseRevision, checkedAt: checked.rows[0].checkedAt.toISOString() };
  } catch (error) { await rollback(client); throw error; }
  finally { client.release(); }
}

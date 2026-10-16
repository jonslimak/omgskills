import type { Pool, PoolClient } from "pg";
import { requireDeviceToken, rollback } from "./device-auth.js";

export const inventorySources = ["claude", "codex", "agents"] as const;
type InventorySource = typeof inventorySources[number];
export type RootCoverage = {
  source: InventorySource;
  state: "complete" | "incomplete" | "unavailable";
  reason?: "changed" | "invalid-entry" | "invalid-metadata" | "missing" | "unreadable" | "redirected";
};
export type ReconciliationInput = { baseRevision: string | null; roots: RootCoverage[] };

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

export function requireLocalInventoryReconciliation(
  req: Request, env: Record<string, string | undefined> = process.env, deployContext?: string
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
    || request.pathname !== "/api/portal/sync-upload") throw invalid();
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

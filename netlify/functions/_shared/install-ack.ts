import type { Pool } from "pg";
import { requireDeviceToken, rollback, touchDeviceAfterSuccessfulUse } from "./device-auth.js";

/** A Mac app tells the server it received a website install request, so the pop-over can say "Approve it". */
export type InstallAckTarget = { catalogId: string; agent: "claude" | "codex" };

/** Rows kept per person; older ones only mattered while a pop-over was polling. */
export const INSTALL_ACK_KEEP_ROWS = 20;
const INSTALL_ACK_KEEP_FOR = "1 hour";
/** The pop-over asks only about the request it just opened (it polls for 2 minutes). */
export const INSTALL_ACK_LOOKBACK_MS = 3 * 60 * 1000;

/** The Mac's own check: one non-empty catalog ID of at most 500 bytes, no control or format characters. */
export function parseInstallAckTarget(catalogId: unknown, agent: unknown): InstallAckTarget {
  if (typeof catalogId !== "string" || !catalogId.trim() || Buffer.byteLength(catalogId, "utf8") > 500
    || /[\p{Cc}\p{Cf}]/u.test(catalogId)) {
    throw new Response("catalogId is invalid", { status: 400 });
  }
  if (agent !== "claude" && agent !== "codex") {
    throw new Response("agent must be claude or codex", { status: 400 });
  }
  return { catalogId, agent };
}

/** Extra fields are ignored, so a later Mac app can add some without breaking older servers. */
export function parseInstallAckBody(body: Record<string, unknown>): InstallAckTarget {
  return parseInstallAckTarget(body.catalogId, body.agent);
}

/**
 * GET query: one catalogId, one agent, and optionally one since time. The pop-over's first call has no since and
 * only learns the server's time; later calls send that time back, so the browser's clock never matters.
 * since is clamped to the last 3 minutes.
 */
export function parseInstallAckQuery(url: URL, now = new Date()): InstallAckTarget & { since: Date | null } {
  const query = url.searchParams;
  if ([...query.keys()].some(key => !["catalogId", "agent", "since"].includes(key))
    || ["catalogId", "agent"].some(key => query.getAll(key).length !== 1) || query.getAll("since").length > 1) {
    throw new Response("catalogId and agent are required", { status: 400 });
  }
  const target = parseInstallAckTarget(query.get("catalogId"), query.get("agent"));
  if (!query.has("since")) return { ...target, since: null };
  const sinceMs = Date.parse(query.get("since") ?? "");
  if (!Number.isFinite(sinceMs)) throw new Response("since must be a time", { status: 400 });
  return { ...target, since: new Date(Math.max(sinceMs, now.getTime() - INSTALL_ACK_LOOKBACK_MS)) };
}

/** Records the presenting device's ack and trims the person's old rows, in one transaction. */
export async function recordInstallAck(pool: Pool, req: Request, target: InstallAckTarget, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await requireDeviceToken(req, client, "sync:write", now);
    await client.query(
      `INSERT INTO install_acks (user_id, device_id, catalog_id, agent, received_at) VALUES ($1, $2, $3, $4, $5)`,
      [device.userId, device.deviceId, target.catalogId, target.agent, now]
    );
    await client.query(
      `
        DELETE FROM install_acks
        WHERE user_id = $1
          AND (
            received_at < $2::timestamptz - $3::interval
            OR id NOT IN (
              SELECT id FROM install_acks WHERE user_id = $1 ORDER BY received_at DESC, id DESC LIMIT $4
            )
          )
      `,
      [device.userId, now, INSTALL_ACK_KEEP_FOR, INSTALL_ACK_KEEP_ROWS]
    );
    await touchDeviceAfterSuccessfulUse(client, device.deviceId, now);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Whether any of the person's non-revoked devices acked this request at or after since.
 * Keyed by the Clerk user so a poll costs one query, not a Clerk profile load; no portal user means no devices.
 */
export async function readInstallAck(pool: Pool, clerkUserId: string, query: InstallAckTarget & { since: Date }) {
  const result = await pool.query<{ acked: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM users
        JOIN install_acks ack ON ack.user_id = users.id
        JOIN device_tokens device ON device.id = ack.device_id AND device.user_id = users.id
        WHERE users.clerk_user_id = $1
          AND device.revoked_at IS NULL
          AND ack.catalog_id = $2
          AND ack.agent = $3
          AND ack.received_at >= $4
      ) AS acked
    `,
    [clerkUserId, query.catalogId, query.agent, query.since]
  );
  return result.rows[0]?.acked === true;
}

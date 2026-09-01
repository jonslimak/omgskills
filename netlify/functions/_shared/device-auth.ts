import type { Pool, PoolClient } from "pg";
import { hashToken, isDeviceCredential } from "./crypto.js";

const DEVICE_AUTH_ERROR = "Device credential is invalid or expired";
const DEVICE_INACTIVITY_INTERVAL = "6 months";
const LAST_USED_WRITE_INTERVAL = "1 day";

export const BASE_DEVICE_SCOPES = ["sync:write", "self:revoke"] as const;
export const ALL_DEVICE_SCOPES = [...BASE_DEVICE_SCOPES, "content:read"] as const;
export type DeviceScope = typeof ALL_DEVICE_SCOPES[number];

export class DeviceScopeError extends Error {
  constructor() {
    super("Device scopes are invalid");
  }
}

export function normalizeDeviceScopes(value: unknown): DeviceScope[] {
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== "string")) {
    throw new DeviceScopeError();
  }
  const scopes = [...new Set(value)];
  if (
    scopes.some((scope) => !ALL_DEVICE_SCOPES.includes(scope as DeviceScope))
    || BASE_DEVICE_SCOPES.some((scope) => !scopes.includes(scope))
  ) {
    throw new DeviceScopeError();
  }
  return ALL_DEVICE_SCOPES.filter((scope) => scopes.includes(scope));
}

export function normalizeApprovedDeviceScopes(
  value: unknown,
  browserApproval: boolean
): DeviceScope[] {
  const scopes = normalizeDeviceScopes(value);
  if (scopes.includes("content:read") && !browserApproval) {
    throw new DeviceScopeError();
  }
  return scopes;
}

export class DeviceAuthError extends Error {
  readonly status = 401;

  constructor() {
    super(DEVICE_AUTH_ERROR);
  }
}

export function deviceCredentialFromRequest(req: Request): string {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  if (!match || !isDeviceCredential(match[1])) {
    throw new DeviceAuthError();
  }
  return match[1];
}

export async function requireDeviceToken(
  req: Request,
  client: PoolClient,
  allowedScope: DeviceScope,
  now = new Date()
) {
  if (!ALL_DEVICE_SCOPES.includes(allowedScope)) {
    throw new DeviceAuthError();
  }
  const credential = deviceCredentialFromRequest(req);
  const result = await client.query<{
    id: string;
    user_id: string;
    email: string;
    granted_scopes: DeviceScope[];
  }>(
    `
      SELECT device.id, device.user_id, users.email, device.granted_scopes
      FROM device_tokens device
      JOIN users ON users.id = device.user_id
      WHERE device.token_hash = $1
        AND device.revoked_at IS NULL
        AND device.expires_at > $2
        AND device.granted_scopes @> ARRAY[$3]::text[]
        AND COALESCE(device.last_used_at, device.created_at) > $2 - $4::interval
      FOR UPDATE
    `,
    [hashToken(credential), now, allowedScope, DEVICE_INACTIVITY_INTERVAL]
  );
  const device = result.rows[0];
  if (!device) {
    throw new DeviceAuthError();
  }
  return {
    deviceId: device.id,
    userId: device.user_id,
    email: device.email,
    grantedScopes: normalizeDeviceScopes(device.granted_scopes)
  };
}

export async function requireDeviceActor(
  pool: Pool,
  req: Request,
  allowedScope: DeviceScope,
  now = new Date()
) {
  const client = await pool.connect();
  try {
    return await requireDeviceToken(req, client, allowedScope, now);
  } finally {
    client.release();
  }
}

export async function touchDeviceAfterSuccessfulUse(
  client: PoolClient,
  deviceId: string,
  now = new Date()
) {
  await client.query(
    `
      UPDATE device_tokens
      SET last_used_at = $2
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at <= $2::timestamptz - $3::interval)
    `,
    [deviceId, now, LAST_USED_WRITE_INTERVAL]
  );
}

export async function revokePresentedDevice(pool: Pool, req: Request, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await requireDeviceToken(req, client, "self:revoke", now);
    await client.query("UPDATE device_tokens SET revoked_at = $2 WHERE id = $1", [
      device.deviceId,
      now
    ]);
    await client.query("COMMIT");
    return device.deviceId;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function listUserDevices(pool: Pool, userId: string, now = new Date()) {
  const result = await pool.query(
    `
      SELECT
        id,
        device_name AS "deviceName",
        last_used_at AS "lastUsedAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt",
        created_at AS "createdAt",
        CASE
          WHEN revoked_at IS NOT NULL THEN 'revoked'
          WHEN expires_at <= $2 THEN 'expired'
          WHEN COALESCE(last_used_at, created_at) <= $2::timestamptz - $3::interval THEN 'inactive'
          ELSE 'active'
        END AS status
      FROM device_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId, now, DEVICE_INACTIVITY_INTERVAL]
  );
  return result.rows;
}

export async function revokeOwnedDevice(
  pool: Pool,
  userId: string,
  deviceId: string,
  now = new Date()
) {
  const result = await pool.query<{ id: string }>(
    `
      UPDATE device_tokens
      SET revoked_at = COALESCE(revoked_at, $3)
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [deviceId, userId, now]
  );
  return result.rows[0]?.id ?? null;
}

export async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}

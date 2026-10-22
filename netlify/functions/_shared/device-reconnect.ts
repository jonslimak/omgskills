import type { Pool, PoolClient } from "pg";
import { hashToken } from "./crypto.js";
import { requireDeviceToken, rollback } from "./device-auth.js";

export class DeviceReconnectError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function requireReconnectKey(value: unknown): string {
  if (typeof value !== "string" || value.length !== 64 || !/^[0-9a-f]{64}$/.test(value)) {
    throw new DeviceReconnectError(400, "reconnectKey must be 64 lowercase hexadecimal characters");
  }
  return value;
}

export function hashReconnectKey(value: unknown): string {
  return hashToken(`device-reconnect:${requireReconnectKey(value)}`);
}

export async function lockDevicePairingAccount(client: PoolClient, userId: string) {
  // Serialize exchanges/bindings without taking the user row before auth's
  // device/user row locks. Transaction completion releases this lock.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('omgskills:device-pairing:' || $1::text, 0))",
    [userId]
  );
}

export async function findReconnectDevice(client: PoolClient, userId: string, keyHash: string) {
  // Key ownership changes are serialized by lockDevicePairingAccount.
  // A row lock here could deadlock a binding collision with another device's auth.
  const result = await client.query<{ id: string }>(
    `SELECT id FROM device_tokens
     WHERE user_id = $1 AND reconnect_key_hash = $2`,
    [userId, keyHash]
  );
  return result.rows[0]?.id ?? null;
}

export async function bindDeviceReconnectKey(pool: Pool, req: Request, key: unknown, now = new Date()) {
  const keyHash = hashReconnectKey(key);
  const client = await pool.connect();
  try {
    // Discover the account without retaining row locks, then revalidate under
    // the same account lock used by pairing exchanges.
    const actor = await requireDeviceToken(req, client, "sync:write", now);
    await client.query("BEGIN");
    await lockDevicePairingAccount(client, actor.userId);
    const device = await requireDeviceToken(req, client, "sync:write", now);
    const current = await client.query<{ reconnect_key_hash: string | null }>(
      "SELECT reconnect_key_hash FROM device_tokens WHERE id = $1", [device.deviceId]
    );
    const boundHash = current.rows[0].reconnect_key_hash;
    if (boundHash !== null && boundHash !== keyHash) {
      throw new DeviceReconnectError(409, "This connection already has a reconnect key");
    }
    const ownerId = await findReconnectDevice(client, device.userId, keyHash);
    if (ownerId !== null && ownerId !== device.deviceId) {
      throw new DeviceReconnectError(409, "Reconnect key is already bound to another connection");
    }
    await client.query("UPDATE device_tokens SET reconnect_key_hash = $2 WHERE id = $1",
      [device.deviceId, keyHash]);
    await client.query("COMMIT");
    return { deviceId: device.deviceId, reconnectSupported: true as const };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

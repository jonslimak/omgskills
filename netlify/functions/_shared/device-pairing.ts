import type { Pool, PoolClient } from "pg";
import {
  createDeviceCredential,
  createPairingCode,
  hashToken,
  verifyCodeChallenge
} from "./crypto.js";
import {
  BASE_DEVICE_SCOPES,
  normalizeDeviceScopes,
  type DeviceScope
} from "./device-auth.js";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_PAIRING_CODES = 5;
export const MAX_PAIRING_CODES_PER_HOUR = 10;
export const MAX_ACTIVE_DEVICES = 10;

export class PairingError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type PairingCodeOptions = {
  codeChallenge: string | null;
  grantedScopes?: readonly DeviceScope[];
  now?: Date;
  createCode?: () => string;
};

export async function issuePairingCode(
  pool: Pool,
  userId: string,
  options: PairingCodeOptions
) {
  const client = await pool.connect();
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  const code = (options.createCode ?? createPairingCode)();
  const grantedScopes = normalizeDeviceScopes(options.grantedScopes ?? BASE_DEVICE_SCOPES);

  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

    const counts = await client.query<{ active_count: string; hourly_count: string }>(
      `
        SELECT
          count(*) FILTER (WHERE used_at IS NULL AND expires_at > $2)::text AS active_count,
          count(*) FILTER (WHERE created_at > $2 - interval '1 hour')::text AS hourly_count
        FROM sync_tokens
        WHERE user_id = $1
          AND purpose = 'device_exchange'
      `,
      [userId, now]
    );
    const activeCount = Number(counts.rows[0]?.active_count ?? 0);
    const hourlyCount = Number(counts.rows[0]?.hourly_count ?? 0);
    if (activeCount >= MAX_ACTIVE_PAIRING_CODES || hourlyCount >= MAX_PAIRING_CODES_PER_HOUR) {
      throw new PairingError(429, "Too many pairing codes requested");
    }

    await client.query(
      `
        INSERT INTO sync_tokens (
          user_id, token_hash, purpose, code_challenge, code_challenge_method,
          granted_scopes, expires_at, created_at
        )
        VALUES ($1, $2, 'device_exchange', $3, $4, $5, $6, $7)
      `,
      [
        userId,
        hashToken(code),
        options.codeChallenge,
        options.codeChallenge ? "S256" : null,
        grantedScopes,
        expiresAt,
        now
      ]
    );
    await client.query("COMMIT");
    return { code, expiresAt };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

type ExchangeOptions = {
  pairingCode: string;
  deviceName: string;
  codeVerifier: string | null;
  now?: Date;
  createCredential?: () => string;
};

export async function exchangePairingCode(pool: Pool, options: ExchangeOptions) {
  const client = await pool.connect();
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_CREDENTIAL_TTL_MS);
  const credential = (options.createCredential ?? createDeviceCredential)();

  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      user_id: string;
      code_challenge: string | null;
      granted_scopes: DeviceScope[];
      display_name: string | null;
      email: string;
    }>(
      `
        SELECT st.id, st.user_id, st.code_challenge, st.granted_scopes, u.display_name, u.email
        FROM sync_tokens st
        JOIN users u ON u.id = st.user_id
        WHERE st.token_hash = $1
          AND st.purpose = 'device_exchange'
          AND st.used_at IS NULL
          AND st.expires_at > $2
        FOR UPDATE OF st
      `,
      [hashToken(options.pairingCode), now]
    );
    const pairing = result.rows[0];
    if (!pairing) {
      throw new PairingError(401, "Pairing code is invalid or expired");
    }
    const grantedScopes = normalizeDeviceScopes(pairing.granted_scopes);

    if (pairing.code_challenge) {
      if (!options.codeVerifier || !verifyCodeChallenge(options.codeVerifier, pairing.code_challenge)) {
        throw new PairingError(401, "Pairing code is invalid or expired");
      }
    } else if (options.codeVerifier) {
      throw new PairingError(400, "codeVerifier was not expected");
    }

    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [pairing.user_id]);
    const deviceCount = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM device_tokens
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > $2
      `,
      [pairing.user_id, now]
    );
    if (Number(deviceCount.rows[0]?.count ?? 0) >= MAX_ACTIVE_DEVICES) {
      throw new PairingError(409, "Active device limit reached");
    }

    const device = await client.query<{ id: string }>(
      `
        INSERT INTO device_tokens (
          user_id, token_hash, device_name, granted_scopes, expires_at, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [pairing.user_id, hashToken(credential), options.deviceName, grantedScopes, expiresAt, now]
    );
    await client.query("UPDATE sync_tokens SET used_at = $2 WHERE id = $1", [pairing.id, now]);
    await client.query("COMMIT");

    return {
      credential,
      deviceId: device.rows[0].id,
      expiresAt,
      accountLabel: pairing.display_name || pairing.email,
      grantedScopes
    };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollback(client: PoolClient) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}

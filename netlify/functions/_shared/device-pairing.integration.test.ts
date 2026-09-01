import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { codeChallengeForVerifier, hashToken } from "./crypto.js";
import {
  BASE_DEVICE_SCOPES,
  DeviceAuthError,
  requireDeviceToken
} from "./device-auth.js";
import {
  exchangePairingCode,
  issuePairingCode,
  PairingError
} from "./device-pairing.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for device pairing integration tests");
}
const pool = new pg.Pool({ connectionString });
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

async function createUser(label: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, clerk_user_id, email, display_name) VALUES ($1, $2, $3, $4)`,
    [id, `auth2-${label}-${id}`, `${id}@example.com`, label]
  );
  return id;
}

async function removeUser(id: string) {
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

test("manual exchange stores only the device hash and rejects replay", async () => {
  const userId = await createUser("Manual Mac");
  try {
    const pairing = await issuePairingCode(pool, userId, { codeChallenge: null });
    const exchanged = await exchangePairingCode(pool, {
      pairingCode: pairing.code,
      deviceName: "Jon Mac",
      codeVerifier: null
    });
    const stored = await pool.query<{ token_hash: string; granted_scopes: string[] }>(
      "SELECT token_hash, granted_scopes FROM device_tokens WHERE id = $1",
      [exchanged.deviceId]
    );

    assert.equal(exchanged.accountLabel, "Manual Mac");
    assert.equal(stored.rows[0].token_hash, hashToken(exchanged.credential));
    assert.notEqual(stored.rows[0].token_hash, exchanged.credential);
    assert.deepEqual(stored.rows[0].granted_scopes, [...BASE_DEVICE_SCOPES]);
    assert.deepEqual(exchanged.grantedScopes, [...BASE_DEVICE_SCOPES]);
    await assert.rejects(
      exchangePairingCode(pool, {
        pairingCode: pairing.code,
        deviceName: "Replay Mac",
        codeVerifier: null
      }),
      (error) => error instanceof PairingError && error.status === 401
    );
  } finally {
    await removeUser(userId);
  }
});

test("approved content scope is copied from pairing to the device credential", async () => {
  const userId = await createUser("Private Mac");
  try {
    const pairing = await issuePairingCode(pool, userId, {
      codeChallenge: codeChallengeForVerifier(verifier),
      grantedScopes: [...BASE_DEVICE_SCOPES, "content:read"]
    });
    const exchanged = await exchangePairingCode(pool, {
      pairingCode: pairing.code,
      deviceName: "Private Mac",
      codeVerifier: verifier
    });
    const stored = await pool.query<{ granted_scopes: string[] }>(
      "SELECT granted_scopes FROM device_tokens WHERE id = $1",
      [exchanged.deviceId]
    );

    assert.deepEqual(exchanged.grantedScopes, ["sync:write", "self:revoke", "content:read"]);
    assert.deepEqual(stored.rows[0].granted_scopes, exchanged.grantedScopes);
  } finally {
    await removeUser(userId);
  }
});

test("private content authorization requires a credential with the approved scope", async () => {
  const userId = await createUser("Scope Mac");
  const client = await pool.connect();
  try {
    const metadataPairing = await issuePairingCode(pool, userId, { codeChallenge: null });
    const metadataDevice = await exchangePairingCode(pool, {
      pairingCode: metadataPairing.code,
      deviceName: "Metadata Mac",
      codeVerifier: null
    });
    await assert.rejects(
      requireDeviceToken(
        new Request("https://example.com", {
          headers: { Authorization: `Bearer ${metadataDevice.credential}` }
        }),
        client,
        "content:read"
      ),
      (error) => error instanceof DeviceAuthError && error.status === 401
    );

    const contentPairing = await issuePairingCode(pool, userId, {
      codeChallenge: codeChallengeForVerifier(verifier),
      grantedScopes: [...BASE_DEVICE_SCOPES, "content:read"]
    });
    const contentDevice = await exchangePairingCode(pool, {
      pairingCode: contentPairing.code,
      deviceName: "Content Mac",
      codeVerifier: verifier
    });
    const actor = await requireDeviceToken(
      new Request("https://example.com", {
        headers: { Authorization: `Bearer ${contentDevice.credential}` }
      }),
      client,
      "content:read"
    );

    assert.equal(actor.userId, userId);
    assert.equal(actor.deviceId, contentDevice.deviceId);
    assert.equal(actor.email, `${userId}@example.com`);
  } finally {
    client.release();
    await removeUser(userId);
  }
});

test("challenged exchange rejects a wrong verifier without consuming the code", async () => {
  const userId = await createUser("PKCE Mac");
  try {
    const pairing = await issuePairingCode(pool, userId, {
      codeChallenge: codeChallengeForVerifier(verifier)
    });
    await assert.rejects(
      exchangePairingCode(pool, {
        pairingCode: pairing.code,
        deviceName: "Wrong Mac",
        codeVerifier: `${verifier}x`
      }),
      (error) => error instanceof PairingError && error.status === 401
    );
    const exchanged = await exchangePairingCode(pool, {
      pairingCode: pairing.code,
      deviceName: "Right Mac",
      codeVerifier: verifier
    });
    assert.match(exchanged.credential, /^device_/);
  } finally {
    await removeUser(userId);
  }
});

test("legacy and expired tokens cannot exchange", async () => {
  const userId = await createUser("Invalid Mac");
  try {
    const legacy = `legacy-${randomUUID()}`;
    await pool.query(
      `INSERT INTO sync_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
      [userId, hashToken(legacy)]
    );
    await assert.rejects(
      exchangePairingCode(pool, {
        pairingCode: legacy,
        deviceName: "Legacy Mac",
        codeVerifier: null
      }),
      (error) => error instanceof PairingError && error.status === 401
    );

    const expired = await issuePairingCode(pool, userId, {
      codeChallenge: null,
      now: new Date(Date.now() - 20 * 60 * 1000)
    });
    await assert.rejects(
      exchangePairingCode(pool, {
        pairingCode: expired.code,
        deviceName: "Expired Mac",
        codeVerifier: null
      }),
      (error) => error instanceof PairingError && error.status === 401
    );
  } finally {
    await removeUser(userId);
  }
});

test("pairing codes are excluded from the legacy upload token query", async () => {
  const userId = await createUser("Purpose Mac");
  try {
    const pairing = await issuePairingCode(pool, userId, { codeChallenge: null });
    const legacyLookup = await pool.query(
      `
        SELECT id
        FROM sync_tokens
        WHERE token_hash = $1
          AND purpose = 'legacy_upload'
          AND used_at IS NULL
          AND expires_at > now()
      `,
      [hashToken(pairing.code)]
    );
    assert.equal(legacyLookup.rowCount, 0);
  } finally {
    await removeUser(userId);
  }
});

test("pairing issuance enforces the active-code limit", async () => {
  const userId = await createUser("Limited Mac");
  try {
    for (let index = 0; index < 5; index += 1) {
      await issuePairingCode(pool, userId, { codeChallenge: null });
    }
    await assert.rejects(
      issuePairingCode(pool, userId, { codeChallenge: null }),
      (error) => error instanceof PairingError && error.status === 429
    );
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sync_tokens WHERE user_id = $1`,
      [userId]
    );
    assert.equal(count.rows[0].count, "5");
  } finally {
    await removeUser(userId);
  }
});

test("pairing issuance enforces the hourly limit after codes are used", async () => {
  const userId = await createUser("Hourly Mac");
  try {
    for (let index = 0; index < 10; index += 1) {
      const pairing = await issuePairingCode(pool, userId, { codeChallenge: null });
      await pool.query(
        "UPDATE sync_tokens SET used_at = now() WHERE token_hash = $1",
        [hashToken(pairing.code)]
      );
    }
    await assert.rejects(
      issuePairingCode(pool, userId, { codeChallenge: null }),
      (error) => error instanceof PairingError && error.status === 429
    );
  } finally {
    await removeUser(userId);
  }
});

test("concurrent replay creates exactly one device", async () => {
  const userId = await createUser("Concurrent Mac");
  try {
    const pairing = await issuePairingCode(pool, userId, { codeChallenge: null });
    const results = await Promise.allSettled([
      exchangePairingCode(pool, {
        pairingCode: pairing.code,
        deviceName: "Mac One",
        codeVerifier: null
      }),
      exchangePairingCode(pool, {
        pairingCode: pairing.code,
        deviceName: "Mac Two",
        codeVerifier: null
      })
    ]);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM device_tokens WHERE user_id = $1",
      [userId]
    );

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(count.rows[0].count, "1");
  } finally {
    await removeUser(userId);
  }
});

test("user locking prevents concurrent exchanges from exceeding the device cap", async () => {
  const userId = await createUser("Capped Mac");
  try {
    for (let index = 0; index < 9; index += 1) {
      await pool.query(
        `
          INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at)
          VALUES ($1, $2, $3, now() + interval '1 year')
        `,
        [userId, hashToken(`existing-${userId}-${index}`), `Existing Mac ${index}`]
      );
    }
    const first = await issuePairingCode(pool, userId, { codeChallenge: null });
    const second = await issuePairingCode(pool, userId, { codeChallenge: null });
    const results = await Promise.allSettled([
      exchangePairingCode(pool, {
        pairingCode: first.code,
        deviceName: "Tenth Mac",
        codeVerifier: null
      }),
      exchangePairingCode(pool, {
        pairingCode: second.code,
        deviceName: "Eleventh Mac",
        codeVerifier: null
      })
    ]);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM device_tokens WHERE user_id = $1",
      [userId]
    );

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      results.some(
        (result) => result.status === "rejected"
          && result.reason instanceof PairingError
          && result.reason.status === 409
      ),
      true
    );
    assert.equal(count.rows[0].count, "10");
  } finally {
    await removeUser(userId);
  }
});

test.after(async () => {
  await pool.end();
});

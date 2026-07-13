import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createDeviceCredential, createPairingCode, createSyncToken, hashToken } from "./crypto.js";
import {
  DeviceAuthError,
  listUserDevices,
  revokeOwnedDevice,
  revokePresentedDevice
} from "./device-auth.js";
import { parseSyncSkill, type SyncSkill } from "./sync-skill.js";
import { performSyncUpload } from "./sync-upload.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for device upload integration tests");
}
const pool = new pg.Pool({ connectionString });

function deviceRequest(credential: string) {
  return new Request("https://example.com/api/portal/sync-upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}` }
  });
}

function skill(name = "review") {
  return parseSyncSkill({
    stableKey: `location:v1:codex:${name}`,
    installationPath: name,
    identityStatus: "resolved",
    name,
    description: "Review code",
    catalogSkillId: `owner/repo:${name}`,
    githubUrl: "https://github.com/owner/repo",
    isLocalOnly: false,
    source: "Codex"
  });
}

async function createUser(label: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, clerk_user_id, email, display_name) VALUES ($1, $2, $3, $4)`,
    [id, `auth3-${label}-${id}`, `${id}@example.com`, label]
  );
  return id;
}

async function createDevice(
  userId: string,
  overrides: { revokedAt?: Date; expiresAt?: Date; createdAt?: Date; lastUsedAt?: Date } = {}
) {
  const credential = createDeviceCredential();
  const createdAt = overrides.createdAt ?? new Date();
  const expiresAt = overrides.expiresAt ?? new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1000);
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO device_tokens (
        user_id, token_hash, device_name, last_used_at, expires_at, revoked_at, created_at
      ) VALUES ($1, $2, 'Test Mac', $3, $4, $5, $6)
      RETURNING id
    `,
    [
      userId,
      hashToken(credential),
      overrides.lastUsedAt ?? null,
      expiresAt,
      overrides.revokedAt ?? null,
      createdAt
    ]
  );
  return { credential, deviceId: result.rows[0].id };
}

async function removeUser(userId: string) {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("device upload writes inventory and throttles last-used updates", async () => {
  const userId = await createUser("Upload Mac");
  try {
    const device = await createDevice(userId);
    const firstUse = new Date("2026-07-13T12:00:00Z");
    const first = await performSyncUpload(
      pool,
      { kind: "device", request: deviceRequest(device.credential) },
      [skill()],
      firstUse
    );
    const afterFirst = await pool.query<{ last_used_at: Date }>(
      "SELECT last_used_at FROM device_tokens WHERE id = $1",
      [device.deviceId]
    );
    const secondUse = new Date(firstUse.getTime() + 60 * 60 * 1000);
    await performSyncUpload(
      pool,
      { kind: "device", request: deviceRequest(device.credential) },
      [skill()],
      secondUse
    );
    const afterSecond = await pool.query<{ last_used_at: Date }>(
      "SELECT last_used_at FROM device_tokens WHERE id = $1",
      [device.deviceId]
    );

    assert.equal(first.syncedSkillCount, 1);
    assert.equal(afterFirst.rows[0].last_used_at.toISOString(), firstUse.toISOString());
    assert.equal(afterSecond.rows[0].last_used_at.toISOString(), firstUse.toISOString());
  } finally {
    await removeUser(userId);
  }
});

test("legacy upload remains one-use and pairing codes cannot upload", async () => {
  const userId = await createUser("Legacy Mac");
  try {
    const legacy = createSyncToken();
    const pairing = createPairingCode();
    await pool.query(
      `
        INSERT INTO sync_tokens (user_id, token_hash, purpose, expires_at)
        VALUES
          ($1, $2, 'legacy_upload', now() + interval '10 minutes'),
          ($1, $3, 'device_exchange', now() + interval '10 minutes')
      `,
      [userId, hashToken(legacy), hashToken(pairing)]
    );
    await performSyncUpload(pool, { kind: "legacy", token: legacy }, [skill()]);
    await assert.rejects(
      performSyncUpload(pool, { kind: "legacy", token: legacy }, [skill()]),
      (error) => error instanceof Response && error.status === 401
    );
    await assert.rejects(
      performSyncUpload(pool, { kind: "legacy", token: pairing }, [skill()]),
      (error) => error instanceof Response && error.status === 401
    );
  } finally {
    await removeUser(userId);
  }
});

test("unknown, revoked, expired, and inactive credentials share one error", async () => {
  const userId = await createUser("Invalid Mac");
  const now = new Date("2026-07-13T12:00:00Z");
  try {
    const revoked = await createDevice(userId, { revokedAt: new Date(now.getTime() - 1000) });
    const expired = await createDevice(userId, {
      createdAt: new Date("2025-01-01T00:00:00Z"),
      expiresAt: new Date("2026-01-01T00:00:00Z")
    });
    const inactive = await createDevice(userId, {
      createdAt: new Date("2025-01-01T00:00:00Z"),
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      lastUsedAt: new Date("2025-12-01T00:00:00Z")
    });
    const credentials = [createDeviceCredential(), revoked.credential, expired.credential, inactive.credential];

    for (const credential of credentials) {
      await assert.rejects(
        performSyncUpload(pool, { kind: "device", request: deviceRequest(credential) }, [skill()], now),
        (error) => error instanceof DeviceAuthError
          && error.status === 401
          && error.message === "Device credential is invalid or expired"
      );
    }
  } finally {
    await removeUser(userId);
  }
});

test("failed device upload preserves inventory and last-used state", async () => {
  const userId = await createUser("Rollback Mac");
  try {
    const device = await createDevice(userId);
    const initialUse = new Date("2026-07-13T12:00:00Z");
    await performSyncUpload(
      pool,
      { kind: "device", request: deviceRequest(device.credential) },
      [skill("existing")],
      initialUse
    );
    const invalid = {
      ...skill("invalid"),
      identityStatus: "resolved",
      catalogSkillId: null
    } as SyncSkill;
    await assert.rejects(
      performSyncUpload(
        pool,
        { kind: "device", request: deviceRequest(device.credential) },
        [invalid],
        new Date(initialUse.getTime() + 2 * 24 * 60 * 60 * 1000)
      )
    );
    const inventory = await pool.query<{ stable_key: string; is_current: boolean }>(
      "SELECT stable_key, is_current FROM synced_skills WHERE user_id = $1",
      [userId]
    );
    const storedDevice = await pool.query<{ last_used_at: Date }>(
      "SELECT last_used_at FROM device_tokens WHERE id = $1",
      [device.deviceId]
    );

    assert.deepEqual(inventory.rows, [{ stable_key: "location:v1:codex:existing", is_current: true }]);
    assert.equal(storedDevice.rows[0].last_used_at.toISOString(), initialUse.toISOString());
  } finally {
    await removeUser(userId);
  }
});

test("self and owner revocation remain device- and owner-scoped", async () => {
  const firstUser = await createUser("First Mac");
  const secondUser = await createUser("Second Mac");
  try {
    const first = await createDevice(firstUser);
    const second = await createDevice(secondUser);
    const revokedId = await revokePresentedDevice(pool, deviceRequest(first.credential));
    const crossOwnerResult = await revokeOwnedDevice(pool, firstUser, second.deviceId);
    const ownResult = await revokeOwnedDevice(pool, secondUser, second.deviceId);

    assert.equal(revokedId, first.deviceId);
    assert.equal(crossOwnerResult, null);
    assert.equal(ownResult, second.deviceId);
    await assert.rejects(
      performSyncUpload(pool, { kind: "device", request: deviceRequest(first.credential) }, [skill()]),
      (error) => error instanceof DeviceAuthError && error.status === 401
    );
  } finally {
    await removeUser(firstUser);
    await removeUser(secondUser);
  }
});

test("revocation serializes with upload and blocks every later use", async () => {
  const userId = await createUser("Race Mac");
  try {
    const device = await createDevice(userId);
    const request = deviceRequest(device.credential);
    const results = await Promise.allSettled([
      performSyncUpload(pool, { kind: "device", request }, [skill()]),
      revokePresentedDevice(pool, request)
    ]);
    const revoked = await pool.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM device_tokens WHERE id = $1",
      [device.deviceId]
    );

    assert.equal(results[1].status, "fulfilled");
    assert.notEqual(revoked.rows[0].revoked_at, null);
    await assert.rejects(
      performSyncUpload(pool, { kind: "device", request }, [skill()]),
      (error) => error instanceof DeviceAuthError && error.status === 401
    );
  } finally {
    await removeUser(userId);
  }
});

test("device listing excludes token hashes and derives credential status", async () => {
  const userId = await createUser("List Mac");
  try {
    const now = new Date("2026-07-13T12:00:00Z");
    await createDevice(userId, { createdAt: new Date("2026-07-01T12:00:00Z") });
    await createDevice(userId, { createdAt: new Date("2025-12-01T12:00:00Z") });
    await createDevice(userId, {
      createdAt: new Date("2026-01-01T12:00:00Z"),
      expiresAt: new Date("2026-07-01T12:00:00Z")
    });
    await createDevice(userId, {
      createdAt: new Date("2026-07-01T12:00:00Z"),
      revokedAt: new Date("2026-07-10T12:00:00Z")
    });
    const devices = await listUserDevices(pool, userId, now);
    assert.equal(devices.length, 4);
    assert.deepEqual(new Set(devices.map((device) => device.status)), new Set([
      "active",
      "inactive",
      "expired",
      "revoked"
    ]));
    assert.deepEqual(Object.keys(devices[0]).sort(), [
      "createdAt",
      "deviceName",
      "expiresAt",
      "id",
      "lastUsedAt",
      "revokedAt",
      "status"
    ]);
  } finally {
    await removeUser(userId);
  }
});

test.after(async () => {
  await pool.end();
});

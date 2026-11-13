import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createDeviceCredential, hashToken } from "./crypto.js";
import { DeviceAuthError } from "./device-auth.js";
import { INSTALL_ACK_KEEP_ROWS, readInstallAck, recordInstallAck } from "./install-ack.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for install ack integration tests");
}
const pool = new pg.Pool({ connectionString });
test.after(() => pool.end());

async function createUser(label: string) {
  const id = randomUUID();
  const clerkUserId = `install-ack-${label}-${id}`;
  await pool.query(`INSERT INTO users (id, clerk_user_id, email, display_name) VALUES ($1, $2, $3, $4)`,
    [id, clerkUserId, `${id}@example.com`, label]);
  return { id, clerkUserId };
}

async function createDevice(userId: string) {
  const credential = createDeviceCredential();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at, granted_scopes)
     VALUES ($1, $2, 'Test Mac', now() + interval '30 days', ARRAY['sync:write', 'self:revoke']) RETURNING id`,
    [userId, hashToken(credential)]
  );
  return { id: result.rows[0].id, credential };
}

const ack = (credential: string) => new Request("https://example.test/api/portal/install-ack", {
  method: "POST", headers: { Authorization: `Bearer ${credential}` }
});

test("an ack is visible to its owner from since onward, and only while the device is not revoked", async () => {
  const user = await createUser("owner");
  const other = await createUser("other");
  try {
    const device = await createDevice(user.id);
    const before = new Date(Date.now() - 1000);
    await recordInstallAck(pool, ack(device.credential), { catalogId: "anthropics/skills/pdf", agent: "claude" });
    const query = { catalogId: "anthropics/skills/pdf", agent: "claude" as const, since: before };
    assert.equal(await readInstallAck(pool, user.clerkUserId, query), true);
    assert.equal(await readInstallAck(pool, user.clerkUserId, { ...query, agent: "codex" }), false);
    assert.equal(await readInstallAck(pool, user.clerkUserId, { ...query, catalogId: "anthropics/skills/docx" }), false);
    assert.equal(await readInstallAck(pool, user.clerkUserId, { ...query, since: new Date(Date.now() + 60_000) }), false);
    assert.equal(await readInstallAck(pool, other.clerkUserId, query), false);
    assert.equal(await readInstallAck(pool, "no-such-clerk-user", query), false);

    await pool.query("UPDATE device_tokens SET revoked_at = now() WHERE id = $1", [device.id]);
    assert.equal(await readInstallAck(pool, user.clerkUserId, query), false);
    await assert.rejects(recordInstallAck(pool, ack(device.credential), { catalogId: "x", agent: "claude" }),
      (error) => error instanceof DeviceAuthError);
  } finally {
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[user.id, other.id]]);
  }
});

test("each ack keeps only the person's newest rows from the last hour; deleting the device removes its acks", async () => {
  const user = await createUser("trim");
  try {
    const device = await createDevice(user.id);
    await pool.query(
      `INSERT INTO install_acks (user_id, device_id, catalog_id, agent, received_at)
       VALUES ($1, $2, 'old', 'claude', now() - interval '2 hours')`, [user.id, device.id]);
    for (let index = 0; index < INSTALL_ACK_KEEP_ROWS + 5; index += 1) {
      await recordInstallAck(pool, ack(device.credential), { catalogId: `skill-${index}`, agent: "codex" },
        new Date(Date.now() + index));
    }
    const rows = await pool.query<{ catalog_id: string }>(
      "SELECT catalog_id FROM install_acks WHERE user_id = $1 ORDER BY received_at", [user.id]);
    assert.equal(rows.rows.length, INSTALL_ACK_KEEP_ROWS);
    assert.equal(rows.rows[0].catalog_id, "skill-5");
    assert.ok(!rows.rows.some(row => row.catalog_id === "old"));

    await pool.query("DELETE FROM device_tokens WHERE id = $1", [device.id]);
    assert.equal((await pool.query("SELECT 1 FROM install_acks WHERE user_id = $1", [user.id])).rowCount, 0);
  } finally {
    await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
  }
});

test("an expired device cannot ack", async () => {
  const user = await createUser("expired");
  try {
    const device = await createDevice(user.id);
    await pool.query("UPDATE device_tokens SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [device.id]);
    await assert.rejects(recordInstallAck(pool, ack(device.credential), { catalogId: "x", agent: "claude" }),
      (error) => error instanceof DeviceAuthError);
  } finally {
    await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
  }
});

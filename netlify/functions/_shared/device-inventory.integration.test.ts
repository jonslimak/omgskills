import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg, { type Pool, type PoolClient } from "pg";
import { createDeviceCredential, createSyncToken, hashToken } from "./crypto.js";
import { DeviceAuthError, requireDeviceToken, revokeOwnedDevice } from "./device-auth.js";
import { parsePresenceSkill, parseSyncSkill } from "./sync-skill.js";
import { performSyncUpload } from "./sync-upload.js";
import { readSyncInventory } from "./sync-inventory-read.js";
import { reconcileSyncedGroupReferences } from "./sync-group-reconciliation.js";
import { addGroupItemWithClient } from "./group-items.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) throw new Error("AUTH_TEST_DATABASE_URL is required; use a disposable local database");
const target = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  || target.search || !/test/i.test(target.pathname)) {
  throw new Error("Device inventory tests require an explicit local test database without connection overrides");
}
const migrationRoot = new URL("../../database/migrations/", import.meta.url);
const inventoryMigration = "20261016120000_add_device_inventory";

async function migrate(client: PoolClient, predicate: (name: string) => boolean = () => true) {
  const names = (await readdir(migrationRoot)).filter((name) => /^\d{14}_/.test(name)).sort();
  for (const name of names.filter(predicate)) {
    await client.query(await readFile(new URL(`${name}/migration.sql`, migrationRoot), "utf8"));
  }
}

async function withSchema(run: (pool: Pool) => Promise<void>, beforeMigration?: (pool: Pool) => Promise<void>) {
  const schema = `device_inventory_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
  try {
    await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const client = await pool.connect();
    try { await migrate(client, (name) => name < inventoryMigration); }
    finally { client.release(); }
    if (beforeMigration) await beforeMigration(pool);
    const migrationClient = await pool.connect();
    try { await migrate(migrationClient, (name) => name >= inventoryMigration); }
    finally { migrationClient.release(); }
    await run(pool);
  } finally {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.end(); }
  }
}

async function user(pool: Pool) {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id, clerk_user_id, email) VALUES ($1, $2, $3)",
    [id, `inventory-${id}`, `${id}@example.test`]);
  return id;
}

async function device(pool: Pool, userId: string, name = "Test Mac") {
  const credential = createDeviceCredential();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO device_tokens(user_id, token_hash, device_name, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 year') RETURNING id`,
    [userId, hashToken(credential), name]
  );
  return { id: result.rows[0].id, credential };
}

function request(credential: string) {
  return new Request("https://example.test/api/portal/sync-upload", {
    method: "POST", headers: { Authorization: `Bearer ${credential}` }
  });
}
function presence(folder = "review", source = "codex") {
  return parsePresenceSkill({ source, installationPath: folder, name: folder,
    skillMdSha: "a".repeat(40), githubUrl: "https://github.com/owner/repo",
    gitRelativePath: `skills/${folder}`, catalogSkillIdHint: `owner/repo:skills/${folder}` });
}
function legacy(folder = "review") {
  return parseSyncSkill({ source: "Codex", installationPath: folder,
    stableKey: `location:v1:codex:${folder}`, name: folder,
    skillMdSha: "a".repeat(40), identityStatus: "localOnly" });
}
function upload(pool: Pool, reporter: { credential: string }, skills = [presence()], now = new Date()) {
  return performSyncUpload(pool, { kind: "device", request: request(reporter.credential) }, skills, now, 2);
}
async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function setFixture(pool: Pool, owner: string, skillId: string) {
  const group = (await pool.query(
    "INSERT INTO skill_groups(owner_user_id, name, slug) VALUES ($1, 'My Set', $2) RETURNING id",
    [owner, randomUUID()]
  )).rows[0].id;
  await transaction(pool, (client) => addGroupItemWithClient(client, group,
    { kind: "synced", syncedSkillId: skillId, note: "Keep this note" }, {
      kind: "release", source: { kind: "catalog", normalizedRoot: "skills/review", catalogSkillId: "owner/repo:review" },
      coordinates: { commitSha: "1".repeat(40), treeSha: "2".repeat(40), skillMdSha: "a".repeat(40) }, createdBy: "test"
    }));
  return group;
}
async function snapshot(pool: Pool, owner: string) {
  const skills = (await pool.query("SELECT * FROM synced_skills WHERE user_id = $1 ORDER BY id", [owner])).rows;
  const runs = (await pool.query("SELECT * FROM sync_runs WHERE user_id = $1 ORDER BY id", [owner])).rows;
  const devices = (await pool.query("SELECT * FROM device_tokens WHERE user_id = $1 ORDER BY id", [owner])).rows;
  return { skills, runs, devices };
}

test("migration preserves legacy inventory IDs and complete Set snapshots/pins", async () => {
  let before: unknown;
  let rowsBefore: unknown;
  let owner: string;
  await withSchema(async (pool) => {
    assert.deepEqual((await pool.query("SELECT * FROM skill_group_items")).rows, before);
    const rows = (await pool.query("SELECT * FROM synced_skills")).rows;
    assert.deepEqual(rows.map(({ device_id, git_relative_path, catalog_skill_id_hint, installed_from_set, ...old }) => old), rowsBefore);
    assert.ok(rows.every((row) => row.device_id === null));
    assert.ok(rows.every((row) => row.installed_from_set === null));
    const legacyRead = await readSyncInventory(pool, owner, 1);
    assert.equal(legacyRead.skills.length, 1);
    const v2 = await readSyncInventory(pool, owner, 2);
    assert.equal(v2.skills[0].deviceId, null);
  }, async (pool) => {
    owner = await user(pool);
    const run = (await pool.query("INSERT INTO sync_runs(user_id,status) VALUES ($1,'completed') RETURNING id", [owner])).rows[0].id;
    const id = (await pool.query(
      `INSERT INTO synced_skills(user_id,sync_run_id,stable_key,name,source,identity_status,is_local_only)
       VALUES ($1,$2,'location:v1:codex:review','Review','Codex','localOnly',true) RETURNING id`, [owner, run]
    )).rows[0].id;
    await setFixture(pool, owner, id);
    before = (await pool.query("SELECT * FROM skill_group_items")).rows;
    rowsBefore = (await pool.query("SELECT * FROM synced_skills")).rows;
  });
});

test("presence isolates accounts/devices/agents and repeated uploads retain IDs and Set links", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), other = await user(pool);
    const a = await device(pool, owner, "Mac A"), b = await device(pool, owner, "Mac B");
    const c = await device(pool, other, "Other Mac");
    const first = await upload(pool, a);
    assert.equal(first.reportVersion, 2);
    assert.equal(first.deviceId, a.id);
    assert.equal(first.mode, "presence");
    const id = (await pool.query("SELECT id FROM synced_skills WHERE device_id=$1", [a.id])).rows[0].id;
    const group = await setFixture(pool, owner, id);
    const itemsBefore = (await pool.query("SELECT * FROM skill_group_items WHERE group_id=$1", [group])).rows;
    const groupBefore = (await pool.query("SELECT * FROM skill_groups WHERE id=$1", [group])).rows;
    await upload(pool, b);
    await upload(pool, c);
    await upload(pool, a, [presence(), presence("review", "claude"), presence("review", "agents")]);
    assert.equal((await pool.query("SELECT id FROM synced_skills WHERE device_id=$1 AND source='codex'", [a.id])).rows[0].id, id);
    assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE group_id=$1", [group])).rows, itemsBefore);
    assert.deepEqual((await pool.query("SELECT * FROM skill_groups WHERE id=$1", [group])).rows, groupBefore);
    const inventory = await readSyncInventory(pool, owner, 2);
    assert.equal(inventory.skills.length, 4);
    assert.equal(inventory.devices?.length, 2);
    assert.ok(inventory.skills.every((row) => row.deviceId !== c.id));
    assert.deepEqual((await readSyncInventory(pool, other, 2)).skills.map((row) => row.deviceId), [c.id]);
  });
});

test("fewer/empty presence reports retain rows and update freshness independently of auth use", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner);
    const firstTime = new Date();
    await upload(pool, a, [presence(), presence("second")], firstTime);
    const rows = (await snapshot(pool, owner)).skills;
    await upload(pool, a, [presence()]);
    const emptyTime = new Date(firstTime.getTime() + 60_000);
    await upload(pool, a, [], emptyTime);
    assert.equal((await snapshot(pool, owner)).skills.length, 2);
    assert.ok((await snapshot(pool, owner)).skills.every((row) => row.is_current));
    assert.equal((await snapshot(pool, owner)).skills.find((row) => row.name === "second").id,
      rows.find((row) => row.name === "second").id);
    const inventory = await readSyncInventory(pool, owner, 2);
    const reportedAt = inventory.devices?.[0].lastReportedAt;
    assert.ok(reportedAt);
    assert.equal(reportedAt.toISOString(), emptyTime.toISOString());
    assert.equal((await snapshot(pool, owner)).devices[0].last_used_at.toISOString(), firstTime.toISOString());
    const emptyMac = await device(pool, owner, "Empty Mac");
    await upload(pool, emptyMac, []);
    assert.ok((await readSyncInventory(pool, owner, 2)).devices?.find((row) => row.id === emptyMac.id)?.lastReportedAt);
  });
});

test("unversioned bearer and one-time uploads replace only legacy scope, never device rows", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner), b = await device(pool, owner);
    await upload(pool, a);
    await upload(pool, b);
    const deviceRows = (await snapshot(pool, owner)).skills;
    const oldAuth = { kind: "device" as const, request: request(a.credential) };
    await performSyncUpload(pool, oldAuth, [legacy()]);
    const legacyId = (await pool.query("SELECT id FROM synced_skills WHERE device_id IS NULL")).rows[0].id;
    const group = await setFixture(pool, owner, legacyId);
    const items = (await pool.query("SELECT * FROM skill_group_items WHERE group_id=$1", [group])).rows;
    const token = createSyncToken();
    await pool.query("INSERT INTO sync_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '10 minutes')", [owner, hashToken(token)]);
    await performSyncUpload(pool, { kind: "legacy", token }, [legacy()]);
    assert.equal((await pool.query("SELECT id FROM synced_skills WHERE device_id IS NULL")).rows[0].id, legacyId);
    await assert.rejects(performSyncUpload(pool, { kind: "legacy", token }, []),
      (error) => error instanceof Response && error.status === 401);
    await performSyncUpload(pool, oldAuth, []);
    const emptyToken = createSyncToken();
    await pool.query("INSERT INTO sync_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '10 minutes')", [owner, hashToken(emptyToken)]);
    await performSyncUpload(pool, { kind: "legacy", token: emptyToken }, []);
    assert.deepEqual((await snapshot(pool, owner)).skills.filter((row) => row.device_id), deviceRows);
    assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE group_id=$1", [group])).rows, items);
    assert.equal((await readSyncInventory(pool, owner, 1)).skills.length, 0);
  });
});

test("legacy Set repair never selects identical device rows, but still repairs legacy replacements", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner);
    const old = { ...legacy(), stableKey: "Codex:/Users/person/.codex/skills/review" };
    await performSyncUpload(pool, { kind: "device", request: request(a.credential) }, [old]);
    const oldId = (await pool.query("SELECT id FROM synced_skills")).rows[0].id;
    const group = await setFixture(pool, owner, oldId);
    await upload(pool, a);
    await performSyncUpload(pool, { kind: "device", request: request(a.credential) }, []);
    assert.deepEqual(await transaction(pool, (client) => reconcileSyncedGroupReferences(client, owner)), []);
    assert.equal((await pool.query("SELECT synced_skill_id FROM skill_group_items WHERE group_id=$1", [group])).rows[0].synced_skill_id, oldId);
    await performSyncUpload(pool, { kind: "device", request: request(a.credential) }, [legacy()]);
    const replacement = (await pool.query("SELECT id FROM synced_skills WHERE device_id IS NULL AND is_current")).rows[0].id;
    assert.notEqual(replacement, oldId);
    assert.equal((await pool.query("SELECT synced_skill_id FROM skill_group_items WHERE group_id=$1", [group])).rows[0].synced_skill_id, replacement);
  });
});

test("invalid credentials cannot mutate inventory; revocation keeps history and account deletion cascades", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner), expired = await device(pool, owner);
    await upload(pool, a);
    await pool.query("UPDATE device_tokens SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1", [expired.id]);
    await revokeOwnedDevice(pool, owner, a.id);
    const before = await snapshot(pool, owner);
    for (const credential of [a.credential, expired.credential, createDeviceCredential()]) {
      await assert.rejects(upload(pool, { credential }), (error) => error instanceof DeviceAuthError);
    }
    assert.deepEqual(await snapshot(pool, owner), before);
    const inventory = await readSyncInventory(pool, owner, 2);
    assert.equal(before.skills.length, 1, "Revocation keeps the stored rows for a reconnect");
    assert.equal(inventory.skills.length, 0, "but the revoked Mac's skills are not listed");
    assert.equal(inventory.devices?.find((row) => row.id === a.id)?.status, "revoked");
    await assert.rejects(pool.query("DELETE FROM device_tokens WHERE id=$1", [a.id]), (error: unknown) => (error as { code: string }).code === "23503");
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    assert.deepEqual(await snapshot(pool, owner), { skills: [], runs: [], devices: [] });
  });
});

test("required scope is enforced without touching reports", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner);
    const before = await snapshot(pool, owner);
    await assert.rejects(transaction(pool, (client) => requireDeviceToken(request(a.credential), client, "content:read")),
      (error) => error instanceof DeviceAuthError);
    assert.deepEqual(await snapshot(pool, owner), before);
  });
});

test("mid-report database failure rolls back rows, runs, Set links and last-used state", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner);
    await upload(pool, a);
    const id = (await snapshot(pool, owner)).skills[0].id;
    await setFixture(pool, owner, id);
    const items = (await pool.query("SELECT * FROM skill_group_items")).rows;
    const before = await snapshot(pool, owner);
    await pool.query("ALTER TABLE synced_skills ADD CONSTRAINT test_injected_failure CHECK (name <> 'FAIL')");
    await assert.rejects(upload(pool, a, [presence("new"), { ...presence(), name: "FAIL" }], new Date(Date.now() + 2 * 86400_000)),
      (error: unknown) => (error as { code: string }).code === "23514");
    assert.deepEqual(await snapshot(pool, owner), before);
    assert.deepEqual((await pool.query("SELECT * FROM skill_group_items")).rows, items);
  });
});

test("v2 reads redact old paths/URL credentials and do not infer a Mac for legacy rows", async () => {
  await withSchema(async (pool) => {
    const owner = await user(pool), a = await device(pool, owner);
    const old = { ...legacy(), stableKey: "Codex:/Users/private-name/.codex/skills/review",
      githubUrl: "https://username:secret@github.com/owner/repo?token=secret#secret" };
    await performSyncUpload(pool, { kind: "device", request: request(a.credential) }, [old]);
    for (const version of [2, 3] as const) {
      const inventory = await readSyncInventory(pool, owner, version);
      assert.equal(inventory.inventoryVersion, version);
      assert.equal(inventory.skills[0].deviceId, null);
      assert.equal(inventory.skills[0].installationFolder, null);
      assert.equal(inventory.skills[0].githubUrl, "https://github.com/owner/repo");
      assert.equal(inventory.devices?.[0].lastReportedAt, null);
      if (version === 3) assert.equal(inventory.devices?.[0].scanCoverage, null);
      else assert.equal(Object.hasOwn(inventory.devices![0], "scanCoverage"), false);
      for (const secret of ["private-name", "stableKey", "token_hash", "secret", "credential", "lastUsedAt"]) {
        assert.equal(JSON.stringify(inventory).includes(secret), false);
      }
    }
    const oldRead = await readSyncInventory(pool, owner, 1);
    assert.ok(oldRead.skills[0].stableKey);
    assert.equal("deviceId" in oldRead.skills[0], false);
  });
});

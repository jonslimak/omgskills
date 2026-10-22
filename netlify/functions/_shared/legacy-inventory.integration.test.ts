import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg, { type Pool, type PoolClient } from "pg";
import { createDeviceCredential, createSyncToken, hashToken } from "./crypto.js";
import { performSyncUpload } from "./sync-upload.js";
import { parseSyncSkill, type SyncSkill } from "./sync-skill.js";
import { readLegacySyncInventory } from "./sync-inventory.js";
import { reconcileSyncedGroupReferences } from "./sync-group-reconciliation.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
const fixtureDirectory = process.env.SYNC_COMPAT_FIXTURE_DIRECTORY;
const dataDirectory = process.env.SYNC_COMPAT_DATA_DIRECTORY;
assert(connectionString && fixtureDirectory && dataDirectory, "Explicit owned local compatibility fixture is required");
const connection = new URL(connectionString);
assert.equal(connection.protocol, "postgresql:");
assert.equal(connection.hostname, "127.0.0.1");
assert.match(connection.pathname, /^\/bridge_test_[a-f0-9]{12}$/);
assert.equal(connection.username, connection.pathname.slice(1));
assert.equal(connection.search, "");
assert.equal(connection.hash, "");
const fixtureRoot = await realpath(fixtureDirectory);
assert.match(fixtureRoot, /^\/private\/tmp\/omgskills-db-bridge\.[A-Za-z0-9]+\/fixtures$/);
assert.match(relative(dirname(fixtureRoot), await realpath(dataDirectory)), /^postgres-[a-z0-9-]+\/data$/);

type Upload = (pool: Pool, authentication: { kind: "legacy"; token: string } | { kind: "device"; request: Request },
  skills: SyncSkill[], now?: Date, version?: 1 | 2 | 3) => Promise<{ syncRunId: string; syncedSkillCount: number }>;
const feature = await import(pathToFileURL(join(fixtureRoot, "feature.mjs")).href) as { performSyncUpload: Upload };
const old = await import(pathToFileURL(join(fixtureRoot, "old.mjs")).href) as { performSyncUpload: Upload };
const pending = ["20261016120000_add_device_inventory", "20261016130000_add_inventory_reconciliation",
  "20261016140000_add_inventory_check_time", "20261021170000_add_device_reconnect_key"];
const pendingSql = await Promise.all(pending.map(name => readFile(
  join(fixtureRoot, "feature/netlify/database/migrations", name, "migration.sql"), "utf8")));
const migrationSql = pendingSql.join("\n");

async function withFixture(run: (pool: Pool) => Promise<void>) {
  const schema = "bridge_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000 });
  let pool: Pool | undefined;
  try {
    const actual = (await admin.query("SELECT current_setting('data_directory') AS path")).rows[0].path;
    assert.equal(actual, dataDirectory);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 3000,
      options: `-c search_path=${schema},public -c statement_timeout=10000 -c lock_timeout=5000` });
    const migrations = new URL("../../database/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).sort()) {
      await pool.query(await readFile(new URL(name + "/migration.sql", migrations), "utf8"));
    }
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

async function user(pool: Pool) {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id,clerk_user_id,email) VALUES($1,$2,$3)", [id, "fixture-" + id, id + "@example.test"]);
  return id;
}

function skill(name = "example", source = "Codex"): SyncSkill {
  return parseSyncSkill({ stableKey: `location:v1:${source.toLowerCase()}:${name}`, installationPath: name,
    source, name, description: "Fixture A", skillMdSha: "a".repeat(64), identityStatus: "localOnly", isLocalOnly: true });
}

async function token(pool: Pool, owner: string) {
  const value = createSyncToken();
  await pool.query(`INSERT INTO sync_tokens(user_id,token_hash,purpose,expires_at)
    VALUES($1,$2,'legacy_upload',now()+interval '10 minutes')`, [owner, hashToken(value)]);
  return value;
}

async function upload(pool: Pool, owner: string, skills: SyncSkill[], writer: Upload = performSyncUpload) {
  return writer(pool, { kind: "legacy", token: await token(pool, owner) }, skills);
}

async function device(pool: Pool, owner: string) {
  const credential = createDeviceCredential();
  const id = (await pool.query(`INSERT INTO device_tokens(user_id,token_hash,device_name,expires_at)
    VALUES($1,$2,'Fixture Mac',now()+interval '1 year') RETURNING id`, [owner, hashToken(credential)])).rows[0].id;
  return { id, request: new Request("https://example.test/api/portal/sync-upload", {
    method: "POST", headers: { Authorization: `Bearer ${credential}` }
  }) };
}

async function setItem(pool: Pool, owner: string, rowId: string, groupId?: string) {
  const group = groupId ?? (await pool.query(`INSERT INTO skill_groups(owner_user_id,name,slug)
    VALUES($1,'Fixture Set',$2) RETURNING id`, [owner, randomUUID()])).rows[0].id;
  return (await pool.query(`INSERT INTO skill_group_items(group_id,kind,synced_skill_id,note,position)
    VALUES($1,'synced',$2,'Preserve fixture note',COALESCE((SELECT max(position)+1 FROM skill_group_items WHERE group_id=$1),0))
    RETURNING *`, [group, rowId])).rows[0];
}

async function blocked(pool: Pool, pid: number, by: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const row = (await pool.query("SELECT $2::integer = ANY(pg_blocking_pids($1)) AS waiting", [pid, by])).rows[0];
    if (row.waiting) return;
    await delay(10);
  }
  assert.fail("Expected transaction to be waiting on the migration/upload lock");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function intercept(pool: Pool, afterQuery: (sql: string, client: PoolClient) => Promise<void>): Pool {
  return { connect: async () => {
    const client = await pool.connect();
    return {
      query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        await afterQuery(sql, client);
        return result;
      }, release: () => client.release()
    };
  } } as unknown as Pool;
}

test("unchanged old server and bridge both work before migration", { timeout: 20000 }, async () => {
  await withFixture(async pool => {
    const owner = await user(pool);
    await upload(pool, owner, [skill()], old.performSyncUpload);
    const before = (await readLegacySyncInventory(pool, owner)).skills[0];
    const membership = await setItem(pool, owner, before.id);
    await upload(pool, owner, [{ ...skill(), description: "Fixture B" }]);
    const after = (await readLegacySyncInventory(pool, owner)).skills[0];
    assert.equal(after.id, before.id);
    assert.equal(after.description, "Fixture B");
    assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE id=$1", [membership.id])).rows[0], membership);
  });
});

test("bridge and feature writers preserve device/account isolation and Set row identities", { timeout: 20000 }, async () => {
  await withFixture(async pool => {
    const owner = await user(pool), other = await user(pool);
    await upload(pool, owner, [skill()]);
    const legacyId = (await readLegacySyncInventory(pool, owner)).skills[0].id;
    const legacyItem = await setItem(pool, owner, legacyId);
    await pool.query(migrationSql);
    const first = await device(pool, owner), second = await device(pool, owner);
    await feature.performSyncUpload(pool, { kind: "device", request: first.request }, [skill()], new Date(), 2);
    await feature.performSyncUpload(pool, { kind: "device", request: second.request }, [skill()], new Date(), 2);
    await upload(pool, other, [skill()]);
    const deviceRows = (await pool.query("SELECT * FROM synced_skills WHERE device_id IS NOT NULL ORDER BY id")).rows;
    assert.equal(deviceRows.length, 2);
    const deviceItem = await setItem(pool, owner, deviceRows[0].id, legacyItem.group_id);
    const otherRows = (await pool.query("SELECT * FROM synced_skills WHERE user_id=$1", [other])).rows;
    await upload(pool, owner, [{ ...skill(), description: "Legacy B" }]);
    assert.equal((await readLegacySyncInventory(pool, owner)).skills[0].id, legacyId);
    await upload(pool, owner, []);
    assert.deepEqual((await readLegacySyncInventory(pool, owner)).skills, []);
    assert.deepEqual((await pool.query("SELECT * FROM synced_skills WHERE device_id IS NOT NULL ORDER BY id")).rows, deviceRows);
    assert.deepEqual((await pool.query("SELECT * FROM synced_skills WHERE user_id=$1", [other])).rows, otherRows);
    await Promise.all([
      upload(pool, owner, [skill()]),
      feature.performSyncUpload(pool, { kind: "device", request: first.request }, [skill()], new Date(), 2)
    ]);
    assert.deepEqual((await pool.query("SELECT id FROM synced_skills WHERE user_id=$1 ORDER BY id", [owner])).rows.map(row => row.id),
      [legacyId, ...deviceRows.map(row => row.id)].sort());
    for (const item of [legacyItem, deviceItem]) {
      assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE id=$1", [item.id])).rows[0], item);
    }
  });
});

test("legacy Set reconciliation cannot adopt a device-only matching row", { timeout: 20000 }, async () => {
  await withFixture(async pool => {
    const owner = await user(pool);
    await upload(pool, owner, [{ ...skill(), stableKey: "Codex:/Users/fixture/.codex/skills/example" }]);
    const id = (await readLegacySyncInventory(pool, owner)).skills[0].id;
    const item = await setItem(pool, owner, id);
    await pool.query(migrationSql);
    const mac = await device(pool, owner);
    await feature.performSyncUpload(pool, { kind: "device", request: mac.request }, [skill()], new Date(), 2);
    await upload(pool, owner, []);
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      assert.deepEqual(await reconcileSyncedGroupReferences(client, owner, { dryRun: true }), []);
      await client.query("COMMIT");
    } finally { await client.query("ROLLBACK"); client.release(); }
    assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE id=$1", [item.id])).rows[0], item);
  });
});

test("bridge stays usable between individual migrations and after a later migration fails", { timeout: 20000 }, async () => {
  await withFixture(async pool => {
    const owner = await user(pool);
    await upload(pool, owner, [skill()]);
    const id = (await readLegacySyncInventory(pool, owner)).skills[0].id;
    const item = await setItem(pool, owner, id);
    for (const [index, sql] of pendingSql.entries()) {
      if (index === 1) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await assert.rejects(client.query("SELECT 1/0"), { code: "22012" });
        } finally { await client.query("ROLLBACK"); client.release(); }
        // The first migration is committed; the second has rolled back.
        await upload(pool, owner, [skill()]);
        assert.equal((await readLegacySyncInventory(pool, owner)).skills[0].id, id);
      }
      await pool.query(sql);
      await upload(pool, owner, [skill()]);
      assert.equal((await readLegacySyncInventory(pool, owner)).skills[0].id, id);
      assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE id=$1", [item.id])).rows[0], item);
    }
  });
});

test("migration waits for an in-flight bridge upload; next upload sees the new schema", { timeout: 20000 }, async () => {
  await withFixture(async pool => {
    const owner = await user(pool), paused = deferred(), resume = deferred();
    let uploadPid = 0;
    const instrumented = intercept(pool, async (sql, client) => {
      if (sql.includes("INSERT INTO sync_runs")) {
        uploadPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        paused.resolve();
        await resume.promise;
      }
    });
    const value = await token(pool, owner);
    const writing = performSyncUpload(instrumented, { kind: "legacy", token: value }, [skill()]);
    const migrator = await pool.connect();
    let migration: Promise<unknown> | undefined;
    try {
      await paused.promise;
      const migrationPid = (await migrator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      migration = migrator.query(migrationSql);
      await blocked(pool, migrationPid, uploadPid);
      resume.resolve();
      await writing;
      await migration;
      const id = (await readLegacySyncInventory(pool, owner)).skills[0].id;
      await upload(pool, owner, [skill()]);
      assert.equal((await readLegacySyncInventory(pool, owner)).skills[0].id, id);
      await assert.rejects(performSyncUpload(pool, { kind: "legacy", token: value }, [skill()]),
        error => error instanceof Response && error.status === 401);
    } finally {
      resume.resolve();
      await Promise.allSettled([writing, ...(migration ? [migration] : [])]);
      migrator.release();
    }
  });
});

for (const commit of [true, false]) {
  test(`upload waits for migration ${commit ? "commit" : "failure/rollback"} without consuming its token early`, { timeout: 20000 }, async () => {
    await withFixture(async pool => {
      const owner = await user(pool), value = await token(pool, owner);
      const migrator = await pool.connect();
      let writing: Promise<unknown> | undefined;
      try {
        const migrationPid = (await migrator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await migrator.query("BEGIN");
        await migrator.query(migrationSql);
        let uploadPid = 0;
        const connected = deferred();
        const instrumented = { connect: async () => {
          const client = await pool.connect();
          uploadPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          connected.resolve();
          return client;
        } } as unknown as Pool;
        writing = performSyncUpload(instrumented, { kind: "legacy", token: value }, [skill()]);
        await connected.promise;
        await blocked(pool, uploadPid, migrationPid);
        assert.equal((await pool.query("SELECT used_at FROM sync_tokens WHERE token_hash=$1", [hashToken(value)])).rows[0].used_at, null);
        // PostgreSQL releases transaction locks on error, before an explicit ROLLBACK.
        if (!commit) await assert.rejects(migrator.query("SELECT 1/0"), { code: "22012" });
        await migrator.query(commit ? "COMMIT" : "ROLLBACK");
        await writing;
        assert.equal((await readLegacySyncInventory(pool, owner)).skills.length, 1);
        assert.notEqual((await pool.query("SELECT used_at FROM sync_tokens WHERE token_hash=$1", [hashToken(value)])).rows[0].used_at, null);
        assert.equal((await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_attribute
          WHERE attrelid='synced_skills'::regclass AND attname='device_id' AND NOT attisdropped) AS found`)).rows[0].found, commit);
      } finally {
        await migrator.query("ROLLBACK");
        if (writing) await Promise.allSettled([writing]);
        migrator.release();
      }
    });
  });
}

for (const migrated of [false, true]) {
  test(`interrupted upload rolls back inventory, Set links and token with migrated=${migrated}`, { timeout: 20000 }, async () => {
    await withFixture(async pool => {
      const owner = await user(pool);
      await upload(pool, owner, [skill()]);
      const initial = (await pool.query("SELECT * FROM synced_skills WHERE user_id=$1", [owner])).rows;
      const item = await setItem(pool, owner, initial[0].id);
      if (migrated) await pool.query(migrationSql);
      const value = await token(pool, owner);
      const interrupted = intercept(pool, async sql => {
        if (sql.includes("ON CONFLICT")) throw Error("Injected upload interruption after row write");
      });
      await assert.rejects(performSyncUpload(interrupted, { kind: "legacy", token: value }, [{ ...skill(), description: "Must roll back" }]), /Injected upload interruption/);
      const after = (await pool.query("SELECT * FROM synced_skills WHERE user_id=$1", [owner])).rows;
      for (const row of after) {
        if (migrated) { delete row.device_id; delete row.git_relative_path; delete row.catalog_skill_id_hint; }
      }
      assert.deepEqual(after, initial);
      assert.deepEqual((await pool.query("SELECT * FROM skill_group_items WHERE id=$1", [item.id])).rows[0], item);
      assert.equal((await pool.query("SELECT used_at FROM sync_tokens WHERE token_hash=$1", [hashToken(value)])).rows[0].used_at, null);
      await performSyncUpload(pool, { kind: "legacy", token: value }, [skill()]);
    });
  });
}

test("negative control: pre-bridge server fails after migration but its failed token remains unused", { timeout: 20000 }, async () => {
  await withFixture(async pool => {
    const owner = await user(pool), value = await token(pool, owner);
    await pool.query(migrationSql);
    await assert.rejects(old.performSyncUpload(pool, { kind: "legacy", token: value }, [skill()]), { code: "42P10" });
    assert.equal((await pool.query("SELECT used_at FROM sync_tokens WHERE token_hash=$1", [hashToken(value)])).rows[0].used_at, null);
    await performSyncUpload(pool, { kind: "legacy", token: value }, [skill()]);
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { readSyncInventory } from "./sync-inventory-read.js";
import { writeSyncInventory } from "./sync-inventory.js";
import { parsePresenceSkill, parseSyncSkill, type SyncSkill } from "./sync-skill.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) throw new Error("AUTH_TEST_DATABASE_URL must name a disposable local test database");
const target = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.search || !/test/i.test(target.pathname)) {
  throw new Error("Set-origin tests only support a disposable local test database");
}
const migrations = new URL("../../database/migrations/", import.meta.url);
const originMigration = "20261030170000_add_inventory_set_origin";

for (const migrated of [false, true]) {
  test(`Set-origin uploads and reads work with migration ${migrated ? "present" : "absent"}`, async () => {
    const schema = `set_origin_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString });
    const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
    try {
      await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
      await admin.query(`CREATE SCHEMA "${schema}"`);
      for (const name of (await readdir(migrations)).filter(name => /^\d{14}_/.test(name)).sort()) {
        if (name === originMigration && !migrated) continue;
        await pool.query(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
      }
      if (migrated) {
        const column = await pool.query(`SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'synced_skills' AND column_name = 'installed_from_set'`, [schema]);
        assert.deepEqual(column.rows, [{ is_nullable: "YES", column_default: null }]);
      }
      const owner = randomUUID(), other = randomUUID();
      for (const id of [owner, other]) {
        await pool.query("INSERT INTO users(id,clerk_user_id,email) VALUES ($1,$2,$3)", [id, `test-${id}`, `${id}@example.test`]);
      }
      const device = randomUUID();
      await pool.query(`INSERT INTO device_tokens(id,user_id,token_hash,device_name,expires_at)
        VALUES ($1,$2,$3,'Test Mac',now()+interval '1 year')`, [device, owner, randomUUID()]);
      const legacy = (installedFromSet?: string | null) => parseSyncSkill({
        stableKey: "location:v1:codex:legacy", installationPath: "legacy", source: "Codex", name: "Legacy", installedFromSet });
      const presence = (installedFromSet?: string | null) => parsePresenceSkill({
        installationPath: "review", source: "codex", name: "Review", installedFromSet });
      async function upload(userId: string, skills: SyncSkill[], deviceId?: string) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await writeSyncInventory(client, userId, skills, { deviceId });
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      await upload(other, [legacy("Another account's private Set")]);
      for (const origin of ["Team Skills", null, undefined]) {
        await upload(owner, [legacy(origin)]);
        await upload(owner, [presence(origin)], device);
        for (const version of [1, 2, 3] as const) {
          const result = await readSyncInventory(pool, owner, version);
          assert.ok(result.skills.length > 0);
          assert.ok(result.skills.every(skill => skill.installedFromSet === (migrated ? origin ?? null : null)));
          assert.ok(!JSON.stringify(result).includes("Another account"));
        }
      }
      if (!migrated) {
        await pool.query(await readFile(new URL(`${originMigration}/migration.sql`, migrations), "utf8"));
        await upload(owner, [presence("After migration")], device);
        const result = await readSyncInventory(pool, owner, 3);
        assert.equal(result.skills.find(skill => skill.deviceId === device)?.installedFromSet, "After migration");
      }
      if (migrated) {
        await upload(owner, [presence("Original Set")], device);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await writeSyncInventory(client, owner, [presence("Uncommitted Set")], { deviceId: device });
          await client.query("ROLLBACK");
        } finally { client.release(); }
        const result = await readSyncInventory(pool, owner, 3);
        assert.equal(result.skills.find(skill => skill.deviceId === device)?.installedFromSet, "Original Set");
      }
    } finally {
      await pool.end();
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await admin.end(); }
    }
  });
}

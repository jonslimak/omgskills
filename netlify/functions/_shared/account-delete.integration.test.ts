import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg, { type Pool } from "pg";
import { AccountDeleteError, deleteAccount } from "./account-delete.js";
import { saveCloudVersion, storeCloudBlob, updateCloudSaveSettings } from "./cloud-save.js";
import { CloudStoreError, type CloudObjectStore } from "./cloud-store.js";
import { appendSkillRelease, createSkillSource } from "./group-storage.js";
import { gitObjectSha } from "./skill-package.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for account delete integration tests");
}

const migrationsDirectory = fileURLToPath(new URL("../../database/migrations", import.meta.url));

async function withMigratedSchema(run: (pool: Pool) => Promise<void>) {
  const schema = `account_delete_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString });
  const client = await admin.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    const entries = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of entries) {
      await client.query(await readFile(path.join(migrationsDirectory, name, "migration.sql"), "utf8"));
    }
  } finally {
    client.release();
  }
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public`, connectionTimeoutMillis: 2000 });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

class MemoryStore implements CloudObjectStore {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Uint8Array) {
    this.objects.set(key, Buffer.from(body));
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new CloudStoreError("not_found", "Saved file is missing");
    return object;
  }
  async deleteMany(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
    return [];
  }
}

const sha = (seed: string) => gitObjectSha("blob", Buffer.from(seed));

async function createUser(pool: Pool, name: string) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users (id, clerk_user_id, email, display_name, handle, profile_published) VALUES ($1, $2, $3, $4, $4, true)",
    [id, `clerk-${id}`, `${name}-${id}@example.com`, name]
  );
  return id;
}

async function createSet(pool: Pool, ownerUserId: string, slug: string, extra: { favorites?: boolean } = {}) {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO skill_groups (owner_user_id, name, slug, visibility, is_favorites) VALUES ($1, $2, $2, 'public', $3) RETURNING id",
    [ownerUserId, slug, extra.favorites ?? false]
  );
  return result.rows[0].id;
}

/** Someone with a bit of everything: Sets, a Mac, synced skills, agents, a saved skill, a private GitHub skill. */
async function fullAccount(pool: Pool, store: CloudObjectStore) {
  const userId = await createUser(pool, "ada");
  const device = await pool.query<{ id: string }>(
    `
      INSERT INTO device_tokens (user_id, token_hash, device_name, expires_at, granted_scopes)
      VALUES ($1, $2, 'Mac', now() + interval '1 day', ARRAY['sync:write', 'self:revoke', 'content:read', 'content:write'])
      RETURNING id
    `,
    [userId, `hash-${userId}`]
  );
  const deviceId = device.rows[0].id;
  await pool.query(
    "INSERT INTO sync_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    [userId, `sync-${userId}`]
  );
  const run = await pool.query<{ id: string }>(
    "INSERT INTO sync_runs (user_id, device_id, status) VALUES ($1, $2, 'completed') RETURNING id",
    [userId, deviceId]
  );
  const synced = await pool.query<{ id: string }>(
    `
      INSERT INTO synced_skills (user_id, device_id, sync_run_id, stable_key, name, source, identity_status, is_local_only)
      VALUES ($1, $2, $3, 'claude:notes', 'notes', 'claude', 'localOnly', true)
      RETURNING id
    `,
    [userId, deviceId, run.rows[0].id]
  );
  await pool.query(
    "INSERT INTO install_acks (user_id, device_id, catalog_id, agent) VALUES ($1, $2, 'a/b/c', 'claude')",
    [userId, deviceId]
  );
  await pool.query("INSERT INTO my_skill_additions (user_id, catalog_skill_id) VALUES ($1, 'a/b/c')", [userId]);
  await pool.query("INSERT INTO library_agent_connections (user_id, client_id) VALUES ($1, 'cursor')", [userId]);

  const setId = await createSet(pool, userId, "tools");
  await createSet(pool, userId, "favorites", { favorites: true });
  await pool.query("INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, 'friend@example.com')", [setId]);
  await pool.query(
    "INSERT INTO skill_group_items (group_id, kind, synced_skill_id, name) VALUES ($1, 'synced', $2, 'notes')",
    [setId, synced.rows[0].id]
  );
  await pool.query(
    "INSERT INTO analytics_events (event_name, group_id, profile_user_id, actor_user_id) VALUES ('view', $1, $2, $2)",
    [setId, userId]
  );

  // A private GitHub skill, in their own Set.
  await pool.query(
    `
      INSERT INTO github_broker_installations (owner_user_id, installation_id, account_id, account_login, account_type)
      VALUES ($1, '42', '7', 'ada', 'User')
    `,
    [userId]
  );
  const client = await pool.connect();
  let sourceId: string;
  let releaseId: string;
  try {
    sourceId = await createSkillSource(client, {
      kind: "private_github",
      normalizedRoot: "skills/secret",
      repositoryId: "99",
      repositorySlug: "ada/private",
      ownerUserId: userId,
      brokerInstallationId: "42"
    });
    releaseId = await appendSkillRelease(client, {
      sourceId,
      commitSha: sha("commit").slice(0, 40),
      treeSha: sha("tree").slice(0, 40),
      skillMdSha: sha("md").slice(0, 40),
      createdBy: userId
    });
  } finally {
    client.release();
  }
  await pool.query(
    "INSERT INTO skill_group_items (group_id, kind, github_url, name, source_id, release_id) VALUES ($1, 'github', 'https://github.com/ada/private', 'secret', $2, $3)",
    [setId, sourceId, releaseId]
  );

  // A saved skill with its file in storage.
  await updateCloudSaveSettings(pool, userId, { enabled: true });
  const text = "---\nname: notes\ndescription: Take notes.\n---\n# Notes\n";
  const data = Buffer.from(text);
  const blobSha = gitObjectSha("blob", data);
  await storeCloudBlob(pool, store, { userId, blobSha, data });
  const saved = await saveCloudVersion(pool, {
    userId, deviceId, skillKey: "notes",
    files: [{ path: "SKILL.md", mode: "100644", blobSha, byteSize: data.byteLength }]
  });
  assert.equal(saved.status, "saved");
  return { userId, deviceId, setId, sourceId, releaseId };
}

async function count(pool: Pool, table: string, column: string, value: string) {
  return (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [value])).rows[0].n;
}

test("deleting an account removes its data, empties its record, retires its private skills and signs it out", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const ada = await fullAccount(pool, store);
    assert.equal(store.objects.size, 1);

    // Someone else's Set holds a copy of Ada's private skill, and keeps an invite for Ada.
    const bob = await createUser(pool, "bob");
    const bobSet = await createSet(pool, bob, "borrowed");
    await pool.query(
      "INSERT INTO skill_group_items (group_id, kind, github_url, name, source_id, release_id) VALUES ($1, 'github', 'https://github.com/ada/private', 'secret', $2, $3)",
      [bobSet, ada.sourceId, ada.releaseId]
    );
    await pool.query(
      "INSERT INTO skill_group_items (group_id, kind, catalog_skill_id, name) VALUES ($1, 'catalog', 'a/b/c', 'public one')",
      [bobSet]
    );

    const signedOut: string[] = [];
    const result = await deleteAccount(pool, {
      store: () => store,
      deleteSignIn: async (id) => { signedOut.push(id); }
    }, { userId: ada.userId, clerkUserId: `clerk-${ada.userId}` });

    assert.deepEqual(result, { deletedSets: 2 });
    assert.deepEqual(signedOut, [`clerk-${ada.userId}`]);
    assert.equal(store.objects.size, 0);

    for (const [table, column] of [
      ["skill_groups", "owner_user_id"], ["device_tokens", "user_id"], ["sync_tokens", "user_id"],
      ["sync_runs", "user_id"], ["synced_skills", "user_id"], ["install_acks", "user_id"],
      ["my_skill_additions", "user_id"], ["library_agent_connections", "user_id"],
      ["cloud_save_settings", "user_id"], ["cloud_blobs", "user_id"], ["cloud_saved_skills", "user_id"],
      ["analytics_events", "actor_user_id"], ["analytics_events", "profile_user_id"]
    ]) {
      assert.equal(await count(pool, table, column, ada.userId), 0, `${table}.${column}`);
    }
    assert.equal((await pool.query("SELECT 1 FROM skill_sources WHERE kind = 'cloud' AND owner_user_id = $1", [ada.userId])).rowCount, 0);

    const record = (await pool.query("SELECT clerk_user_id, email, display_name, handle, profile_published FROM users WHERE id = $1", [ada.userId])).rows[0];
    assert.deepEqual(record, {
      clerk_user_id: `deleted:${ada.userId}`,
      email: `deleted+${ada.userId}@deleted.invalid`,
      display_name: null,
      handle: null,
      profile_published: false
    });

    const source = (await pool.query("SELECT tombstoned_at FROM skill_sources WHERE id = $1", [ada.sourceId])).rows[0];
    assert.ok(source.tombstoned_at);

    const bobItems = (await pool.query(
      "SELECT name, github_url, source_id, release_id, metadata_only_reason FROM skill_group_items WHERE group_id = $1 ORDER BY name DESC",
      [bobSet]
    )).rows;
    assert.deepEqual(bobItems, [
      { name: "secret", github_url: null, source_id: null, release_id: null, metadata_only_reason: "source_unavailable" },
      { name: "public one", github_url: null, source_id: null, release_id: null, metadata_only_reason: null }
    ]);
    const bobRevision = (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [bobSet])).rows[0].revision;
    assert.equal(bobRevision, 2);
    const bobRecord = (await pool.query("SELECT email, handle FROM users WHERE id = $1", [bob])).rows[0];
    assert.equal(bobRecord.handle, "bob");
  });
});

test("saved files without storage stop the delete before anything changes", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const ada = await fullAccount(pool, store);
    await assert.rejects(
      deleteAccount(pool, { store: () => null, deleteSignIn: async () => {} }, { userId: ada.userId, clerkUserId: `clerk-${ada.userId}` }),
      (error) => error instanceof AccountDeleteError && error.code === "storage_unavailable"
    );
    assert.equal(await count(pool, "skill_groups", "owner_user_id", ada.userId), 2);
    assert.equal(await count(pool, "cloud_saved_skills", "user_id", ada.userId), 1);
  });
});

test("if signing out fails the data is already gone, and trying again on the new empty record finishes", async () => {
  await withMigratedSchema(async (pool) => {
    const store = new MemoryStore();
    const ada = await fullAccount(pool, store);
    const clerkUserId = `clerk-${ada.userId}`;
    await assert.rejects(
      deleteAccount(pool, { store: () => store, deleteSignIn: async () => { throw new Error("down"); } }, { userId: ada.userId, clerkUserId }),
      (error) => error instanceof AccountDeleteError && error.code === "sign_in_delete_failed"
    );
    assert.equal(await count(pool, "skill_groups", "owner_user_id", ada.userId), 0);

    // Signing in again makes a fresh record for the same sign-in; deleting again removes both.
    const fresh = randomUUID();
    await pool.query("INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, 'ada@example.com')", [fresh, clerkUserId]);
    let signedOut = 0;
    await deleteAccount(pool, { store: () => null, deleteSignIn: async () => { signedOut += 1; } }, { userId: fresh, clerkUserId });
    assert.equal(signedOut, 1);
    assert.equal((await pool.query("SELECT 1 FROM users WHERE email = 'ada@example.com' OR clerk_user_id = $1", [clerkUserId])).rowCount, 0);
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pg, { type Pool } from "pg";
import { codeChallengeForVerifier, createDeviceCredential, createPairingCode, hashToken } from "./crypto.js";
import { BASE_DEVICE_SCOPES, requireDeviceActor, requireDeviceToken, revokePresentedDevice, type DeviceScope } from "./device-auth.js";
import { exchangePairingCode, issuePairingCode, MAX_ACTIVE_DEVICES } from "./device-pairing.js";
import { bindDeviceReconnectKey, hashReconnectKey } from "./device-reconnect.js";
import { addGroupItemWithClient } from "./group-items.js";
import { parsePresenceSkill, parseSyncSkill } from "./sync-skill.js";
import { performSyncUpload } from "./sync-upload.js";
import { readInventoryRevision } from "./inventory-reconciliation.js";
import { readSyncInventory } from "./sync-inventory-read.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) throw new Error("AUTH_TEST_DATABASE_URL must name a disposable local test database");
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol)
  || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || target.search || target.hash || !/^\/[a-z0-9_]*test[a-z0-9_]*$/i.test(target.pathname)) {
  throw new Error("Reconnect tests require an explicit loopback test database without connection overrides");
}
const migrationRoot = new URL("../../database/migrations/", import.meta.url);
const migrationName = "20261021170000_add_device_reconnect_key";
const key = "ab".repeat(32), otherKey = "cd".repeat(32);
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const status = (expected: number) => (error: unknown) => typeof error === "object" && error !== null
  && "status" in error && error.status === expected;
const request = (credential: string) => new Request("https://example.test/api/portal/test", {
  method: "POST", headers: { Authorization: `Bearer ${credential}` }
});

async function withSchema(run: (pool: Pool) => Promise<void>, beforeMigration?: (pool: Pool) => Promise<void>) {
  const schema = `reconnect_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 6, connectionTimeoutMillis: 3000 });
  let created = false;
  try {
    const actual = (await admin.query(`SELECT current_database() AS name, current_setting('data_directory') AS directory,
      current_setting('listen_addresses') AS listen, host(inet_server_addr()) AS address`)).rows[0];
    assert.equal(actual.name, target.pathname.slice(1));
    assert.ok(["127.0.0.1", "::1"].includes(actual.address));
    assert.ok(actual.listen.split(",").every((value: string) => ["127.0.0.1", "localhost", "::1"].includes(value.trim())));
    const directory = await realpath(actual.directory);
    const roots = await Promise.all(["/private/tmp", tmpdir()].map(root => realpath(root)));
    assert.ok(roots.some(root => directory.startsWith(root + path.sep)), "Cluster must be temporary");
    assert.equal((await stat(directory)).uid, process.getuid?.());
    await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const names = (await readdir(migrationRoot)).filter(name => /^\d{14}_/.test(name)).sort();
    assert.ok(names.includes(migrationName));
    for (const name of names.filter(name => name < migrationName)) {
      await pool.query(await readFile(new URL(`${name}/migration.sql`, migrationRoot), "utf8"));
    }
    if (beforeMigration) await beforeMigration(pool);
    for (const name of names.filter(name => name >= migrationName)) {
      await pool.query(await readFile(new URL(`${name}/migration.sql`, migrationRoot), "utf8"));
    }
    await run(pool);
  } finally {
    await pool.end();
    try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  }
}

async function user(pool: Pool) {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id,clerk_user_id,email) VALUES($1,$2,$3)",
    [id, `reconnect-${id}`, `${id}@example.test`]);
  return id;
}
async function pair(pool: Pool, owner: string, reconnectKey?: string, scopes: readonly DeviceScope[] = BASE_DEVICE_SCOPES) {
  const issued = await issuePairingCode(pool, owner, { codeChallenge: codeChallengeForVerifier(verifier), grantedScopes: scopes });
  return exchangePairingCode(pool, { pairingCode: issued.code, deviceName: "Synthetic Mac", codeVerifier: verifier,
    ...(reconnectKey === undefined ? {} : { reconnectKey }) });
}
async function rows(pool: Pool, table: string) {
  return (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
}
async function snapshot(pool: Pool) {
  return { devices: await rows(pool, "device_tokens"), codes: await rows(pool, "sync_tokens") };
}
const skill = parsePresenceSkill({ source: "codex", installationPath: "reconnect-fixture", name: "Reconnect fixture",
  skillMdSha: "a".repeat(40), githubUrl: "https://github.com/fixture/repository", gitRelativePath: "skills/reconnect-fixture" });
async function upload(pool: Pool, credential: string, baseRevision: string | null) {
  return performSyncUpload(pool, { kind: "device", request: request(credential) }, [skill], new Date(), 3,
    { baseRevision, roots: (["claude", "codex", "agents"] as const).map(source => ({ source, state: "complete" })) });
}

test("migration preserves old rows and enforces account-scoped hash uniqueness/format", async () => {
  let before: Awaited<ReturnType<typeof rows>>;
  await withSchema(async pool => {
    const devices = await rows(pool, "device_tokens");
    assert.deepEqual(devices.map(({ reconnect_key_hash, ...old }) => old), before);
    assert.ok(devices.every(device => device.reconnect_key_hash === null));
    const owner = devices[0].user_id;
    await pool.query("UPDATE device_tokens SET reconnect_key_hash=$2 WHERE id=$1", [devices[0].id, hashReconnectKey(key)]);
    await assert.rejects(pool.query("UPDATE device_tokens SET reconnect_key_hash=$2 WHERE id=$1", [devices[1].id, hashReconnectKey(key)]),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "23505");
    for (const value of ["short", "G".repeat(64), "a".repeat(64) + "\n"]) {
      await assert.rejects(pool.query("UPDATE device_tokens SET reconnect_key_hash=$2 WHERE id=$1", [devices[1].id, value]),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "23514");
    }
    const another = await user(pool);
    const separate = await pair(pool, another, key);
    assert.notEqual(separate.deviceId, devices[0].id);
    assert.notEqual(owner, another);
  }, async pool => {
    const owner = await user(pool);
    await pair(pool, owner);
    await pair(pool, owner);
    before = await rows(pool, "device_tokens");
  });
});

for (const bindExisting of [false, true]) {
  test(`${bindExisting ? "bound older" : "key-aware"} connection retains inventory, revision, history and Set identity across reconnect`, async () => {
    await withSchema(async pool => {
      const owner = await user(pool);
      const first = await pair(pool, owner, bindExisting ? undefined : key, [...BASE_DEVICE_SCOPES, "content:read"]);
      if (bindExisting) {
        const bound = await bindDeviceReconnectKey(pool, request(first.credential), key);
        assert.deepEqual(bound, { deviceId: first.deviceId, reconnectSupported: true });
        assert.deepEqual(await bindDeviceReconnectKey(pool, request(first.credential), key), bound);
      }
      await upload(pool, first.credential, null);
      const originalSkill = (await rows(pool, "synced_skills"))[0];
      const group = (await pool.query("INSERT INTO skill_groups(owner_user_id,name,slug) VALUES($1,'Reconnect Set',$2) RETURNING id",
        [owner, randomUUID()])).rows[0].id;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await addGroupItemWithClient(client, group, { kind: "synced", syncedSkillId: originalSkill.id, note: "Keep this note" }, {
          kind: "release", source: { kind: "catalog", normalizedRoot: "skills/reconnect-fixture", catalogSkillId: "fixture/repository:reconnect-fixture" },
          coordinates: { commitSha: "1".repeat(40), treeSha: "2".repeat(40), skillMdSha: "a".repeat(40) }, createdBy: "test"
        });
        await client.query("COMMIT");
      } finally { client.release(); }
      const setBefore = await rows(pool, "skill_group_items");
      const groupsBefore = await rows(pool, "skill_groups");
      const deviceBefore = (await rows(pool, "device_tokens"))[0];
      const historyBefore = await rows(pool, "sync_runs");
      await revokePresentedDevice(pool, request(first.credential));
      await assert.rejects(requireDeviceActor(pool, request(first.credential), "sync:write"), status(401));
      assert.deepEqual(await rows(pool, "synced_skills"), [originalSkill], "Disconnect keeps last-known rows");
      const second = await pair(pool, owner, key);
      assert.equal(second.reconnectSupported, true);
      assert.equal(second.deviceId, first.deviceId);
      assert.notEqual(second.credential, first.credential);
      const stored = (await rows(pool, "device_tokens"))[0];
      assert.equal((await rows(pool, "device_tokens")).length, 1);
      assert.equal(stored.created_at.toISOString(), deviceBefore.created_at.toISOString());
      assert.equal(stored.inventory_revision, deviceBefore.inventory_revision);
      assert.equal(stored.inventory_protocol, 3);
      assert.equal(stored.inventory_checked_at.toISOString(), deviceBefore.inventory_checked_at.toISOString());
      assert.equal(stored.reconnect_key_hash, hashReconnectKey(key));
      assert.equal(stored.token_hash, hashToken(second.credential));
      assert.equal(stored.revoked_at, null);
      assert.ok(stored.last_used_at);
      assert.deepEqual(second.grantedScopes, [...BASE_DEVICE_SCOPES]);
      await assert.rejects(requireDeviceActor(pool, request(second.credential), "content:read"), status(401));
      await assert.rejects(requireDeviceActor(pool, request(first.credential), "sync:write"), status(401));
      const revision = await readInventoryRevision(pool, request(second.credential));
      assert.equal(revision.revision, deviceBefore.inventory_revision);
      await upload(pool, second.credential, revision.revision);
      assert.deepEqual((await rows(pool, "synced_skills")).map(row => row.id), [originalSkill.id]);
      assert.deepEqual(await rows(pool, "skill_group_items"), setBefore);
      assert.deepEqual(await rows(pool, "skill_groups"), groupsBefore);
      assert.ok((await rows(pool, "sync_runs")).some(row => row.id === historyBefore[0].id));
    });
  });
}

test("key cannot replace pairing authentication, PKCE, expiry or single-use approval", async () => {
  await withSchema(async pool => {
    const owner = await user(pool);
    const first = await pair(pool, owner, key);
    const issued = await issuePairingCode(pool, owner, { codeChallenge: codeChallengeForVerifier(verifier) });
    const options = { pairingCode: issued.code, deviceName: "Renamed Mac", codeVerifier: verifier, reconnectKey: key };
    const before = await snapshot(pool);
    await assert.rejects(exchangePairingCode(pool, { ...options, pairingCode: createPairingCode() }), status(401));
    await assert.rejects(exchangePairingCode(pool, { ...options, codeVerifier: null }), status(401));
    await assert.rejects(exchangePairingCode(pool, { ...options, codeVerifier: verifier + "x" }), status(401));
    await assert.rejects(exchangePairingCode(pool, { ...options, now: new Date(issued.expiresAt.getTime() + 1) }), status(401));
    await assert.rejects(requireDeviceActor(pool, request(key), "sync:write"), status(401));
    await assert.rejects(bindDeviceReconnectKey(pool, request(key), key), status(401));
    assert.deepEqual(await snapshot(pool), before);
    const second = await exchangePairingCode(pool, options);
    assert.equal(second.deviceId, first.deviceId);
    assert.equal((await rows(pool, "device_tokens"))[0].device_name, "Renamed Mac");
    await assert.rejects(exchangePairingCode(pool, options), status(401));
    await assert.rejects(requireDeviceActor(pool, request(first.credential), "sync:write"), status(401));
  });
});

test("binding rejects key replacement, same-account collision, revoked/expired/inactive credentials and missing scope", async () => {
  await withSchema(async pool => {
    const owner = await user(pool);
    const bound = await pair(pool, owner, key), unbound = await pair(pool, owner);
    const before = await snapshot(pool);
    await assert.rejects(bindDeviceReconnectKey(pool, request(bound.credential), otherKey), status(409));
    await assert.rejects(bindDeviceReconnectKey(pool, request(unbound.credential), key), status(409));
    assert.deepEqual(await snapshot(pool), before);
    await assert.rejects(bindDeviceReconnectKey(pool, request(unbound.credential), otherKey, new Date(Date.now() + 370 * 86400_000)), status(401));
    await pool.query("UPDATE device_tokens SET created_at=now()-interval '7 months',last_used_at=NULL WHERE id=$1", [unbound.deviceId]);
    await assert.rejects(bindDeviceReconnectKey(pool, request(unbound.credential), otherKey), status(401));
    await assert.rejects(pool.query("UPDATE device_tokens SET granted_scopes=ARRAY['self:revoke']::text[] WHERE id=$1", [unbound.deviceId]),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "23514");
    await pool.query("UPDATE device_tokens SET last_used_at=now() WHERE id=$1", [unbound.deviceId]);
    await revokePresentedDevice(pool, request(unbound.credential));
    await assert.rejects(bindDeviceReconnectKey(pool, request(unbound.credential), otherKey), status(401));
    assert.equal((await rows(pool, "device_tokens")).find(row => row.id === unbound.deviceId).reconnect_key_hash, null);
  });
});

test("different accounts/keys, no-key clients, lost keys and legacy inventory stay distinct", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), another = await user(pool);
    const a = await pair(pool, owner, key), b = await pair(pool, another, key), c = await pair(pool, owner, otherKey);
    const legacy = await pair(pool, owner);
    assert.equal(Object.hasOwn(legacy, "reconnectSupported"), false);
    await performSyncUpload(pool, { kind: "device", request: request(legacy.credential) }, [parseSyncSkill({
      source: "Codex", installationPath: "old", stableKey: "location:v1:codex:old", name: "Old", identityStatus: "localOnly"
    })]);
    const legacyRows = await rows(pool, "synced_skills");
    await revokePresentedDevice(pool, request(legacy.credential));
    const d = await pair(pool, owner); // No guessing that this is the previous Mac.
    assert.equal(new Set([a.deviceId, b.deviceId, c.deviceId, legacy.deviceId, d.deviceId]).size, 5);
    await pair(pool, owner, key);
    assert.deepEqual(await rows(pool, "synced_skills"), legacyRows);
    assert.ok(legacyRows.every(row => row.device_id === null));
    // The same key back under the first account means the Mac moved back; the other account loses it.
    await assert.rejects(requireDeviceActor(pool, request(b.credential), "sync:write"), status(401));
    assert.equal((await requireDeviceActor(pool, request(c.credential), "sync:write")).userId, owner);
  });
});

test("a Mac moving to another account revokes the old connection and deletes only that Mac's old inventory", async () => {
  await withSchema(async pool => {
    const first = await user(pool), second = await user(pool);
    const moving = await pair(pool, first, key), staying = await pair(pool, first, otherKey);
    await upload(pool, moving.credential, null);
    await upload(pool, staying.credential, null);
    const movingRow = (await rows(pool, "synced_skills")).find(row => row.device_id === moving.deviceId);
    const group = (await pool.query("INSERT INTO skill_groups(owner_user_id,name,slug) VALUES($1,'Moved Set',$2) RETURNING id",
      [first, randomUUID()])).rows[0].id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await addGroupItemWithClient(client, group, { kind: "synced", syncedSkillId: movingRow.id, note: "Still here" }, {
        kind: "release", source: { kind: "catalog", normalizedRoot: "skills/reconnect-fixture", catalogSkillId: "fixture/repository:reconnect-fixture" },
        coordinates: { commitSha: "1".repeat(40), treeSha: "2".repeat(40), skillMdSha: "a".repeat(40) }, createdBy: "test"
      });
      await client.query("COMMIT");
    } finally { client.release(); }

    const moved = await pair(pool, second, key);
    assert.notEqual(moved.deviceId, moving.deviceId);
    await assert.rejects(requireDeviceActor(pool, request(moving.credential), "sync:write"), status(401));
    const old = (await rows(pool, "device_tokens")).find(row => row.id === moving.deviceId);
    assert.ok(old.revoked_at);
    assert.equal(old.reconnect_key_hash, null);
    assert.deepEqual((await rows(pool, "synced_skills")).map(row => row.device_id), [staying.deviceId]);
    const [item] = await rows(pool, "skill_group_items");
    assert.equal(item.synced_skill_id, null);
    assert.equal(item.note, "Still here");
    const firstView = await readSyncInventory(pool, first, 3);
    assert.deepEqual(firstView.skills.map(row => row.deviceId), [staying.deviceId]);
    assert.equal(firstView.devices?.find(device => device.id === moving.deviceId)?.status, "revoked");

    await upload(pool, moved.credential, null);
    assert.equal((await readSyncInventory(pool, second, 3)).skills.length, 1);
    const back = await pair(pool, first, key);
    assert.notEqual(back.deviceId, moving.deviceId);
    await assert.rejects(requireDeviceActor(pool, request(moved.credential), "sync:write"), status(401));
    assert.deepEqual((await readSyncInventory(pool, second, 3)).skills, []);
    assert.equal((await requireDeviceActor(pool, request(staying.credential), "sync:write")).userId, first);
  });
});

test("a disconnected Mac's inventory is hidden until the same account reconnects it", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), first = await pair(pool, owner, key);
    await upload(pool, first.credential, null);
    const [row] = await rows(pool, "synced_skills");
    for (const version of [2, 3] as const) assert.equal((await readSyncInventory(pool, owner, version)).skills.length, 1);
    await revokePresentedDevice(pool, request(first.credential));
    for (const version of [2, 3] as const) assert.deepEqual((await readSyncInventory(pool, owner, version)).skills, []);
    assert.deepEqual(await rows(pool, "synced_skills"), [row]);
    const second = await pair(pool, owner, key);
    assert.equal(second.deviceId, first.deviceId);
    assert.deepEqual((await readSyncInventory(pool, owner, 3)).skills.map(skill => skill.id), [row.id]);
  });
});

test("concurrent approvals reuse one logical Mac; concurrent replay still succeeds only once", async () => {
  await withSchema(async pool => {
    const owner = await user(pool);
    const codes = await Promise.all([issuePairingCode(pool, owner, { codeChallenge: null }), issuePairingCode(pool, owner, { codeChallenge: null })]);
    const devices = await Promise.all(codes.map(code => exchangePairingCode(pool, {
      pairingCode: code.code, deviceName: "Concurrent Mac", codeVerifier: null, reconnectKey: key
    })));
    assert.equal(devices[0].deviceId, devices[1].deviceId);
    assert.equal((await rows(pool, "device_tokens")).length, 1);
    const active = await Promise.allSettled(devices.map(device => requireDeviceActor(pool, request(device.credential), "sync:write")));
    assert.equal(active.filter(result => result.status === "fulfilled").length, 1);
    const replay = await issuePairingCode(pool, owner, { codeChallenge: null });
    const results = await Promise.allSettled([1, 2].map(() => exchangePairingCode(pool, {
      pairingCode: replay.code, deviceName: "Replay Mac", codeVerifier: null, reconnectKey: key
    })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await rows(pool, "device_tokens")).length, 1);
  });
});

test("credential checks racing a reconnect do not deadlock", { timeout: 10_000 }, async () => {
  await withSchema(async pool => {
    const owner = await user(pool), first = await pair(pool, owner, key);
    const code = await issuePairingCode(pool, owner, { codeChallenge: null });
    let exchangePid!: (value: number) => void;
    const pid = new Promise<number>(resolve => { exchangePid = resolve; });
    const observedPool = { connect: async () => {
      const client = await pool.connect();
      exchangePid((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      return client;
    } } as unknown as Pool;
    const authentication = await pool.connect();
    let exchange: Promise<Awaited<ReturnType<typeof exchangePairingCode>>> | undefined;
    let outcome: Promise<PromiseSettledResult<Awaited<ReturnType<typeof exchangePairingCode>>>[]> | undefined;
    try {
      await authentication.query("BEGIN");
      // Pause auth between its device and user row locks, then make the real
      // reconnect wait on that device before auth proceeds to its user lock.
      await authentication.query("SELECT id FROM device_tokens WHERE id=$1 FOR UPDATE", [first.deviceId]);
      exchange = exchangePairingCode(observedPool, { pairingCode: code.code, deviceName: "Racing Mac", codeVerifier: null, reconnectKey: key });
      outcome = Promise.allSettled([exchange]);
      const backend = await pid;
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [backend]);
        if (waiting.rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, "Reconnect must overlap the held device lock");
      const actor = await requireDeviceToken(request(first.credential), authentication, "sync:write");
      assert.equal(actor.deviceId, first.deviceId);
      await authentication.query("COMMIT");
      const [exchanged] = await outcome;
      assert.equal(exchanged.status, "fulfilled", exchanged.status === "rejected" ? String(exchanged.reason) : undefined);
      if (exchanged.status === "fulfilled") {
        assert.equal(exchanged.value.deviceId, first.deviceId);
        await assert.rejects(requireDeviceActor(pool, request(first.credential), "sync:write"), status(401));
      }
    } finally {
      await authentication.query("ROLLBACK");
      authentication.release();
      if (outcome) await outcome;
    }
  });
});

test("concurrent first bindings serialize ownership without replacing either key", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), a = await pair(pool, owner), b = await pair(pool, owner);
    const results = await Promise.allSettled([
      bindDeviceReconnectKey(pool, request(a.credential), key),
      bindDeviceReconnectKey(pool, request(b.credential), key)
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && status(409)(rejected.reason));
    const devices = await rows(pool, "device_tokens");
    assert.equal(devices.filter(device => device.reconnect_key_hash === hashReconnectKey(key)).length, 1);
    assert.equal(devices.filter(device => device.reconnect_key_hash === null).length, 1);
  });
});

test("reconnecting an active Mac does not consume another slot; a revoked Mac cannot bypass the active limit", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), first = await pair(pool, owner, key);
    for (let i = 1; i < MAX_ACTIVE_DEVICES; i++) {
      await pool.query("INSERT INTO device_tokens(user_id,token_hash,device_name,expires_at) VALUES($1,$2,'Other Mac',now()+interval '1 year')",
        [owner, hashToken(createDeviceCredential())]);
    }
    const second = await pair(pool, owner, key);
    assert.equal(second.deviceId, first.deviceId);
    const before = await rows(pool, "device_tokens");
    await assert.rejects(pair(pool, owner, otherKey), status(409));
    assert.deepEqual(await rows(pool, "device_tokens"), before);
    await revokePresentedDevice(pool, request(second.credential));
    await pool.query("INSERT INTO device_tokens(user_id,token_hash,device_name,expires_at) VALUES($1,$2,'New Mac',now()+interval '1 year')",
      [owner, hashToken(createDeviceCredential())]);
    await assert.rejects(pair(pool, owner, key), status(409));
    assert.ok((await rows(pool, "device_tokens")).find(row => row.id === first.deviceId).revoked_at);
  });
});

test("exchange rollback preserves the old credential/key and unconsumed approval; binding rollback leaves no key", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), first = await pair(pool, owner, key), unbound = await pair(pool, owner);
    const code = await issuePairingCode(pool, owner, { codeChallenge: null });
    const before = await snapshot(pool);
    await pool.query(`CREATE FUNCTION reject_exchange() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic exchange failure'; END $$;
      CREATE TRIGGER reject_exchange BEFORE UPDATE ON sync_tokens FOR EACH ROW EXECUTE FUNCTION reject_exchange()`);
    const options = { pairingCode: code.code, deviceName: "Failed rename", codeVerifier: null, reconnectKey: key };
    await assert.rejects(exchangePairingCode(pool, options), /Synthetic exchange failure/);
    assert.deepEqual(await snapshot(pool), before);
    assert.equal((await requireDeviceActor(pool, request(first.credential), "sync:write")).deviceId, first.deviceId);
    await pool.query("DROP TRIGGER reject_exchange ON sync_tokens");
    assert.equal((await exchangePairingCode(pool, options)).deviceId, first.deviceId);
    const bindBefore = await snapshot(pool);
    await pool.query(`CREATE FUNCTION reject_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic binding failure'; END $$;
      CREATE TRIGGER reject_binding AFTER UPDATE OF reconnect_key_hash ON device_tokens FOR EACH ROW EXECUTE FUNCTION reject_binding()`);
    await assert.rejects(bindDeviceReconnectKey(pool, request(unbound.credential), otherKey), /Synthetic binding failure/);
    assert.deepEqual(await snapshot(pool), bindBefore);
    await pool.query("DROP TRIGGER reject_binding ON device_tokens");
    await bindDeviceReconnectKey(pool, request(unbound.credential), otherKey);
  });
});

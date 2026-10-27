import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pg, { type Pool, type PoolClient } from "pg";
import type { RootCoverage } from "./inventory-reconciliation.js";
import type { SyncSkill } from "./sync-skill.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) throw new Error("AUTH_TEST_DATABASE_URL is required; no inherited database fallback is allowed");
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol)
  || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || target.search || target.hash || !/^\/[a-z0-9_]*test[a-z0-9_]*$/i.test(target.pathname)
  || ["/omgskills_a2_test", "/omgskills_unified_test"].includes(target.pathname)) {
  throw new Error("Use a disposable loopback TCP test database, not A3, without connection overrides");
}

// Load storage code only after the explicit local target guard; never call a configured production pool.
const { createDeviceCredential, createSyncToken, hashToken } = await import("./crypto.js");
const { parsePresenceSkill, parseSyncSkill } = await import("./sync-skill.js");
const { performSyncUpload } = await import("./sync-upload.js");
const { performInventoryCheck, readInventoryRevision } = await import("./inventory-reconciliation.js");
const { addGroupItemWithClient } = await import("./group-items.js");
const { readSyncInventory } = await import("./sync-inventory-read.js");
const migrationRoot = new URL("../../database/migrations/", import.meta.url);
const reconciliationMigration = "20261016130000_add_inventory_reconciliation";
const checkMigration = "20261016140000_add_inventory_check_time";
const now = new Date("2026-10-16T12:00:00Z");
const later = (days: number) => new Date(now.getTime() + days * 86400_000);
type Device = { id: string; credential: string };
type Source = RootCoverage["source"];

async function verifyLocalDatabase(pool: Pool) {
  const { rows: [actual] } = await pool.query(
    `SELECT current_database() AS name, current_setting('data_directory') AS directory,
       current_setting('listen_addresses') AS listen, host(inet_server_addr()) AS address`
  );
  assert.equal(actual.name, target.pathname.slice(1), "Unexpected test database name");
  assert.ok(["127.0.0.1", "::1"].includes(actual.address), "Database connection must be loopback");
  assert.ok(actual.listen.split(",").every((value: string) => ["localhost", "127.0.0.1", "::1"].includes(value.trim())),
    "Database must not listen on external interfaces");
  const directory = await realpath(actual.directory);
  const temporaryRoots = await Promise.all(["/private/tmp", tmpdir()].map(folder => realpath(folder)));
  assert.ok(temporaryRoots.some(folder => directory.startsWith(folder + path.sep)), "Database cluster must be disposable temporary storage");
  const getuid = process.getuid;
  assert.ok(getuid, "Unix ownership checks are required for integration tests");
  assert.equal((await stat(directory)).uid, getuid(), "Test cluster must belong to this user");
}

async function withSchema(run: (pool: Pool) => Promise<void>, beforeMigration?: (pool: Pool) => Promise<void>,
  migrationBoundary = reconciliationMigration) {
  const schema = `inventory_reconciliation_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  // Exclude public so CREATE TABLE IF NOT EXISTS cannot silently reuse an older suite's tables.
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis: 3000 });
  let created = false;
  try {
    await verifyLocalDatabase(admin);
    await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const names = (await readdir(migrationRoot)).filter(name => /^\d{14}_/.test(name)).sort();
    assert.ok(names.includes(reconciliationMigration), "Reconciliation migration is required");
    assert.ok(names.includes(checkMigration), "Inventory check migration is required");
    async function migrate(predicate: (name: string) => boolean) {
      const client = await pool.connect();
      try {
        assert.equal((await client.query("SELECT current_schema() AS name")).rows[0].name, schema);
        for (const name of names.filter(predicate)) {
          await client.query(await readFile(new URL(`${name}/migration.sql`, migrationRoot), "utf8"));
        }
      } finally { client.release(); }
    }
    await migrate(name => name < migrationBoundary);
    if (beforeMigration) await beforeMigration(pool);
    await migrate(name => name >= migrationBoundary);
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
    [id, `reconciliation-${id}`, `${id}@example.test`]);
  return id;
}
async function device(pool: Pool, owner: string): Promise<Device> {
  const id = randomUUID(), credential = createDeviceCredential();
  await pool.query(`INSERT INTO device_tokens(id,user_id,token_hash,device_name,created_at,expires_at)
    VALUES($1,$2,$3,'Reconciliation test Mac',$4,$5)`, [id, owner, hashToken(credential), later(-1), later(365)]);
  return { id, credential };
}
function request(reporter: Pick<Device, "credential">, method = "POST") {
  return new Request(`https://example.test/api/portal/sync-upload${method === "GET" ? "?reportVersion=3" : ""}`,
    { method, headers: { Authorization: `Bearer ${reporter.credential}` } });
}
function presence(folder: string, source: Source = "codex") {
  return parsePresenceSkill({ source, installationPath: folder, name: folder, description: `Observed ${folder}`,
    skillMdSha: "a".repeat(40), githubUrl: "https://github.com/fixture/repository", gitRelativePath: `skills/${folder}` });
}
function legacy(folder: string) {
  return parseSyncSkill({ source: "Codex", installationPath: folder, stableKey: `location:v1:codex:${folder}`,
    name: folder, description: "Legacy fixture", skillMdSha: "a".repeat(40), identityStatus: "localOnly" });
}
function coverage(overrides: Partial<Record<Source, Omit<RootCoverage, "source">>> = {}): RootCoverage[] {
  return (["claude", "codex", "agents"] as const).map(source => ({ source, state: "complete", ...overrides[source] }));
}
async function revision(pool: Pool, reporter: Device, at = now) {
  const result = await readInventoryRevision(pool, request(reporter, "GET"), at);
  assert.equal(result.reportVersion, 3);
  assert.deepEqual(Object.keys(result).sort(), ["reportVersion", "revision"]);
  return result.revision;
}
function upload2(pool: Pool, reporter: Device, skills: SyncSkill[], at = now) {
  return performSyncUpload(pool, { kind: "device", request: request(reporter) }, skills, at, 2);
}
async function upload3(pool: Pool, reporter: Pick<Device, "credential">, baseRevision: string | null,
  skills: SyncSkill[], roots = coverage(), at = now) {
  const result = await performSyncUpload(pool, { kind: "device", request: request(reporter) }, skills, at, 3, { baseRevision, roots });
  assert.ok("reportVersion" in result && result.reportVersion === 3);
  return result;
}
const status = (expected: number) => (error: unknown) => typeof error === "object" && error !== null
  && "status" in error && error.status === expected;
const tables = ["users", "device_tokens", "sync_tokens", "sync_runs", "synced_skills", "skill_groups",
  "skill_group_items", "skill_sources", "skill_releases"] as const;
async function snapshot(pool: Pool) {
  const result = {} as Record<typeof tables[number], pg.QueryResultRow[]>;
  for (const table of tables) result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return result;
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
async function pinnedSet(pool: Pool, owner: string, skillId: string) {
  const groupId = randomUUID();
  await pool.query("INSERT INTO skill_groups(id,owner_user_id,name,slug) VALUES($1,$2,'Keep this Set',$3)", [groupId, owner, randomUUID()]);
  await transaction(pool, client => addGroupItemWithClient(client, groupId,
    { kind: "synced", syncedSkillId: skillId, name: "Pinned snapshot name", description: "Pinned snapshot description", note: "Keep this note" },
    { kind: "release", source: { kind: "catalog", normalizedRoot: "skills/review", catalogSkillId: "fixture/repository:review" },
      coordinates: { commitSha: "1".repeat(40), treeSha: "2".repeat(40), skillMdSha: "a".repeat(40) }, createdBy: "integration-test" }));
}
function assertSetPreserved(actual: Awaited<ReturnType<typeof snapshot>>, expected: Awaited<ReturnType<typeof snapshot>>) {
  for (const table of ["skill_groups", "skill_group_items", "skill_sources", "skill_releases"] as const) {
    assert.deepEqual(actual[table], expected[table], `${table} must remain unchanged`);
  }
}
async function legacyUpload(pool: Pool, owner: string, skills: SyncSkill[], at = now) {
  const token = createSyncToken();
  await pool.query("INSERT INTO sync_tokens(user_id,token_hash,expires_at) VALUES($1,$2,$3)", [owner, hashToken(token), later(30)]);
  return performSyncUpload(pool, { kind: "legacy", token }, skills, at);
}

test("additive reconciliation migration preserves old device/legacy rows and Set snapshots/pins", async () => {
  let before: Awaited<ReturnType<typeof snapshot>>;
  await withSchema(async pool => {
    const after = await snapshot(pool);
    const oldShape = { ...after,
      device_tokens: after.device_tokens.map(({ inventory_revision, inventory_protocol, inventory_checked_at, reconnect_key_hash, ...old }) => old),
      sync_runs: after.sync_runs.map(({ scan_coverage, ...old }) => old) };
    assert.deepEqual(oldShape, before);
    assert.ok(after.device_tokens.every(row => row.inventory_revision === null && row.inventory_protocol === 1));
    assert.ok(after.device_tokens.every(row => row.inventory_checked_at === null));
    assert.ok(after.device_tokens.every(row => row.reconnect_key_hash === null));
    assert.ok(after.sync_runs.every(row => row.scan_coverage === null));
    assert.equal(after.synced_skills.length, 2);
    assert.equal(after.synced_skills.filter(row => row.device_id === null).length, 1);
    await assert.rejects(pool.query("UPDATE device_tokens SET inventory_protocol=4"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514");
  }, async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    for (const deviceId of [null, reporter.id]) {
      const runId = randomUUID(), skillId = randomUUID();
      // Historical fixtures must be written before the new columns exist, not through the new writer.
      await pool.query("INSERT INTO sync_runs(id,user_id,device_id,status,completed_at) VALUES($1,$2,$3,'completed',$4)", [runId, owner, deviceId, now]);
      await pool.query(`INSERT INTO synced_skills(id,user_id,sync_run_id,device_id,stable_key,name,source,identity_status,is_local_only,last_seen_at)
        VALUES($1,$2,$3,$4,'location:v1:codex:review','Review','Codex','localOnly',true,$5)`, [skillId, owner, runId, deviceId, now]);
      await pinnedSet(pool, owner, skillId);
    }
    before = await snapshot(pool);
  });
});

test("complete scans mark missing once, preserve last-seen and Sets, and restore the same location IDs", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    await upload2(pool, reporter, [presence("keep"), presence("removed")]);
    const initial = await snapshot(pool);
    const removed = initial.synced_skills.find(row => row.name === "removed")!;
    await pinnedSet(pool, owner, removed.id);
    const pinned = await snapshot(pool);
    const roots = coverage();
    const first = await upload3(pool, reporter, await revision(pool, reporter), [presence("keep")], roots, later(1));
    assert.deepEqual(first, { syncRunId: first.syncRunId, revision: first.syncRunId, syncedSkillCount: 1,
      missingSkillCount: 1, reportVersion: 3, mode: "reconciled", deviceId: reporter.id,
      completedAt: later(1).toISOString(), roots, complete: true });
    let state = await snapshot(pool);
    assert.equal(state.synced_skills.length, 2);
    assert.deepEqual(state.synced_skills.find(row => row.id === removed.id), { ...removed, is_current: false });
    assert.equal(state.device_tokens[0].inventory_revision, first.syncRunId);
    assert.equal(state.device_tokens[0].inventory_protocol, 3);
    assert.deepEqual(state.sync_runs.find(row => row.id === first.syncRunId)?.scan_coverage, roots);
    assertSetPreserved(state, pinned);
    const retained = await readSyncInventory(pool, owner, 3, later(1));
    assert.equal(retained.inventoryVersion, 3);
    assert.equal(retained.skills.find(row => row.id === removed.id)?.isCurrent, false);
    assert.deepEqual(retained.devices?.[0].scanCoverage, roots);
    const oldRead = await readSyncInventory(pool, owner, 1, later(1));
    const v2 = await readSyncInventory(pool, owner, 2, later(1));
    assert.deepEqual(Object.keys(oldRead), ["skills"]);
    assert.deepEqual(oldRead.skills, []);
    assert.equal(v2.inventoryVersion, 2);
    assert.deepEqual(v2.skills.map(row => row.name), ["keep"]);
    assert.deepEqual(Object.keys(v2.devices![0]).sort(), ["deviceName", "id", "lastReportedAt", "status"]);
    assert.deepEqual(await snapshot(pool), state);
    const empty = await upload3(pool, reporter, await revision(pool, reporter, later(2)), [], roots, later(2));
    assert.equal(empty.missingSkillCount, 1);
    assert.equal((await upload3(pool, reporter, await revision(pool, reporter, later(3)), [], roots, later(3))).missingSkillCount, 0);
    state = await snapshot(pool);
    assert.deepEqual(state.synced_skills.find(row => row.id === removed.id), { ...removed, is_current: false });
    await upload3(pool, reporter, await revision(pool, reporter, later(4)), [presence("keep"), presence("removed")], roots, later(4));
    state = await snapshot(pool);
    assert.deepEqual(state.synced_skills.map(row => row.id).sort(), initial.synced_skills.map(row => row.id).sort());
    assert.ok(state.synced_skills.every(row => row.is_current && row.last_seen_at.toISOString() === later(4).toISOString()));
    assertSetPreserved(state, pinned);
    const restored = await readSyncInventory(pool, owner, 3, later(4));
    assert.equal(restored.skills.find(row => row.id === removed.id)?.isCurrent, true);
    assert.equal(restored.skills.find(row => row.id === removed.id)?.lastSeenAt.toISOString(), later(4).toISOString());
  });
});

test("each partial/unavailable root retains unseen rows while another complete source reconciles", async t => {
  const partials: Omit<RootCoverage, "source">[] = [
    ...(["changed", "invalid-entry", "invalid-metadata"] as const).map(reason => ({ state: "incomplete" as const, reason })),
    ...(["missing", "unreadable", "redirected"] as const).map(reason => ({ state: "unavailable" as const, reason }))
  ];
  for (const partial of partials) await t.test(partial.reason!, async () => {
    await withSchema(async pool => {
      const owner = await user(pool), reporter = await device(pool, owner);
      await upload2(pool, reporter, [presence("retained", "claude"), presence("gone", "codex"), presence("agent", "agents")]);
      const before = await snapshot(pool);
      const roots = coverage({ claude: partial, agents: { state: "unavailable", reason: "missing" } });
      const observed = partial.state === "incomplete" ? [presence("new-valid", "claude")] : [];
      const result = await upload3(pool, reporter, await revision(pool, reporter), observed, roots, later(1));
      assert.equal(result.complete, false);
      assert.equal(result.missingSkillCount, 1);
      assert.equal(result.syncedSkillCount, observed.length);
      const after = await snapshot(pool);
      for (const old of before.synced_skills) {
        assert.deepEqual(after.synced_skills.find(row => row.id === old.id), old.source === "codex" ? { ...old, is_current: false } : old);
      }
      assert.equal(after.synced_skills.length, 3 + observed.length);
      assert.deepEqual(after.sync_runs.find(row => row.id === result.syncRunId)?.scan_coverage, roots);
      const read = await readSyncInventory(pool, owner, 3, later(1));
      assert.deepEqual(read.devices?.find(row => row.id === reporter.id)?.scanCoverage, roots);
      assert.equal(read.skills.find(row => row.name === "gone")?.isCurrent, false);
      assert.equal(read.skills.find(row => row.name === "retained")?.isCurrent, true);
    });
  });
});

test("v3 inventory uses one latest completed report per device, including null legacy coverage, scoped to its account", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), other = await user(pool);
    const a = await device(pool, owner), b = await device(pool, owner), empty = await device(pool, owner);
    const expired = await device(pool, owner), foreign = await device(pool, other);
    const initialSkills = [presence("same", "codex"), presence("same", "claude")];
    await upload2(pool, a, initialSkills);
    await upload3(pool, a, await revision(pool, a), initialSkills, coverage(), later(1));
    const latestRoots = coverage({ claude: { state: "unavailable", reason: "missing" },
      agents: { state: "incomplete", reason: "changed" } });
    await upload3(pool, a, await revision(pool, a, later(2)), [], latestRoots, later(2));
    await upload2(pool, b, [presence("same")]);
    // A newer old-style report has no coverage: never reuse coverage from an older row.
    await pool.query(`INSERT INTO sync_runs(user_id,device_id,status,completed_at,scan_coverage)
      VALUES($1,$2,'completed',$3,$4::jsonb)`, [owner, b.id, later(1), JSON.stringify(coverage())]);
    await upload2(pool, b, [], later(3));
    await pool.query("UPDATE device_tokens SET revoked_at=$2 WHERE id=$1", [b.id, later(4)]);
    await pool.query("UPDATE device_tokens SET created_at=$2,expires_at=$3 WHERE id=$1", [expired.id, later(-3), later(-1)]);
    await upload2(pool, foreign, [presence("foreign", "agents")]);
    await legacyUpload(pool, owner, [legacy("unknown-mac")]);
    await legacyUpload(pool, owner, [], later(1));
    // Later failed/unfinished reports, and another account's row referencing this device, must not win.
    for (const state of ["failed", "started"]) {
      await pool.query(`INSERT INTO sync_runs(user_id,device_id,status,completed_at,scan_coverage)
        VALUES($1,$2,$3,$4,$5::jsonb)`, [owner, a.id, state, later(10), JSON.stringify(coverage())]);
    }
    await pool.query(`INSERT INTO sync_runs(user_id,device_id,status,completed_at,scan_coverage)
      VALUES($1,$2,'completed',$3,$4::jsonb)`, [other, a.id, later(20), JSON.stringify(coverage())]);
    const before = await snapshot(pool);
    const read = await readSyncInventory(pool, owner, 3, later(4));
    assert.equal(read.inventoryVersion, 3);
    assert.equal(read.skills.length, 3);
    assert.ok(read.skills.every(row => row.deviceId !== b.id), "A revoked Mac's rows are hidden");
    assert.ok(read.skills.every(row => row.id !== before.synced_skills.find(skill => skill.user_id === other)?.id));
    assert.equal(read.devices?.length, 4);
    assert.ok(!read.devices?.some(row => row.id === foreign.id));
    const macA = read.devices?.find(row => row.id === a.id)!;
    assert.deepEqual(macA.scanCoverage, latestRoots);
    assert.equal(macA.lastReportedAt?.toISOString(), later(2).toISOString());
    const macB = read.devices?.find(row => row.id === b.id)!;
    assert.equal(macB.status, "revoked");
    assert.equal(macB.scanCoverage, null);
    assert.equal(macB.lastReportedAt?.toISOString(), later(3).toISOString());
    for (const reporter of [empty, expired]) {
      assert.equal(read.devices?.find(row => row.id === reporter.id)?.scanCoverage, null);
      assert.equal(read.devices?.find(row => row.id === reporter.id)?.lastReportedAt, null);
    }
    assert.equal(read.devices?.find(row => row.id === expired.id)?.status, "expired");
    const codex = read.skills.find(row => row.deviceId === a.id && row.source === "codex")!;
    const claude = read.skills.find(row => row.deviceId === a.id && row.source === "claude")!;
    assert.equal(codex.isCurrent, false);
    assert.equal(claude.isCurrent, true);
    assert.equal(codex.installationFolder, "same");
    assert.equal(claude.installationFolder, "same");
    const unknown = read.skills.find(row => row.deviceId === null)!;
    assert.equal(unknown.installationFolder, "unknown-mac");
    assert.equal(unknown.isCurrent, false);
    assert.deepEqual((await readSyncInventory(pool, owner, 1, later(4))).skills, []);
    const v2 = await readSyncInventory(pool, owner, 2, later(4));
    assert.equal(v2.inventoryVersion, 2);
    assert.equal(v2.skills.length, 1);
    assert.ok(v2.skills.every(row => row.isCurrent));
    assert.ok(v2.devices?.every(row => !Object.hasOwn(row, "scanCoverage")));
    const otherRead = await readSyncInventory(pool, other, 3, later(4));
    assert.deepEqual(otherRead.devices?.map(row => row.id), [foreign.id]);
    assert.deepEqual(otherRead.skills.map(row => row.name), ["foreign"]);
    assert.deepEqual(await snapshot(pool), before);
  });
});

test("v3 inventory distinguishes an empty account and a connected device without any report", async () => {
  await withSchema(async pool => {
    const owner = await user(pool);
    assert.deepEqual(await readSyncInventory(pool, owner, 3), { inventoryVersion: 3, skills: [], devices: [] });
    const reporter = await device(pool, owner);
    const read = await readSyncInventory(pool, owner, 3, now);
    assert.deepEqual(read.skills, []);
    assert.deepEqual(read.devices, [{ id: reporter.id, deviceName: "Reconciliation test Mac", status: "active",
      lastReportedAt: null, scanCoverage: null, lastCheckedAt: null }]);
  });
});

test("reconciliation is account/device/source scoped and legacy one-time uploads remain separate", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), other = await user(pool);
    const a = await device(pool, owner), b = await device(pool, owner), c = await device(pool, other);
    await upload2(pool, a, [presence("same"), presence("same", "claude")]);
    await upload2(pool, b, [presence("same")]);
    await upload2(pool, c, [presence("same")]);
    await legacyUpload(pool, owner, [legacy("same")]);
    const before = await snapshot(pool);
    await upload3(pool, a, await revision(pool, a), [], coverage({ claude: { state: "incomplete", reason: "changed" } }), later(1));
    const after = await snapshot(pool);
    for (const row of before.synced_skills) {
      assert.deepEqual(after.synced_skills.find(candidate => candidate.id === row.id),
        row.device_id === a.id && row.source === "codex" ? { ...row, is_current: false } : row);
    }
    for (const reporter of [b, c]) {
      assert.deepEqual(after.device_tokens.find(row => row.id === reporter.id), before.device_tokens.find(row => row.id === reporter.id));
    }
    await legacyUpload(pool, owner, [], later(2));
    const afterLegacy = await snapshot(pool);
    assert.deepEqual(afterLegacy.synced_skills.filter(row => row.device_id), after.synced_skills.filter(row => row.device_id));
    assert.deepEqual(afterLegacy.device_tokens, after.device_tokens);
    assert.ok(afterLegacy.synced_skills.filter(row => row.device_id === null).every(row => !row.is_current));
    assert.ok(afterLegacy.sync_tokens.every(row => row.used_at !== null));
  });
});

test("revision reads do not write; device v1/v2 advance revision without absence; v3 fences only that credential", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), a = await device(pool, owner), b = await device(pool, owner);
    const initial = await snapshot(pool);
    assert.equal(await revision(pool, a), null);
    assert.deepEqual(await snapshot(pool), initial);
    const v1 = await performSyncUpload(pool, { kind: "device", request: request(a) }, [legacy("legacy")], now, 1);
    assert.equal(await revision(pool, a), v1.syncRunId);
    const v2 = await upload2(pool, a, [presence("one"), presence("two")]);
    assert.equal(await revision(pool, a), v2.syncRunId);
    const subset = await upload2(pool, a, [presence("one")], later(1));
    assert.equal(await revision(pool, a, later(1)), subset.syncRunId);
    const empty = await upload2(pool, a, [], later(2));
    assert.equal(await revision(pool, a, later(2)), empty.syncRunId);
    assert.equal((await snapshot(pool)).synced_skills.filter(row => row.device_id === a.id && row.is_current).length, 2);
    await upload3(pool, a, await revision(pool, a, later(3)), [], coverage(), later(3));
    const fenced = await snapshot(pool);
    for (const version of [1, 2] as const) {
      await assert.rejects(performSyncUpload(pool, { kind: "device", request: request(a) }, [legacy("forbidden")], later(4), version), status(409));
      assert.deepEqual(await snapshot(pool), fenced);
    }
    const other = await upload2(pool, b, [presence("old-client")], later(4));
    assert.equal(await revision(pool, b, later(4)), other.syncRunId);
    const state = await snapshot(pool);
    assert.deepEqual(state.synced_skills.filter(row => row.device_id === a.id), fenced.synced_skills.filter(row => row.device_id === a.id));
    assert.deepEqual(state.device_tokens.find(row => row.id === a.id), fenced.device_tokens.find(row => row.id === a.id));
  });
});

test("lost response leaves the committed revision authoritative; exact replay and stale base are write-free 409s", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    const base = await revision(pool, reporter);
    const observed = [presence("committed")];
    // Discard the acknowledgement as a client whose response was lost would.
    await upload3(pool, reporter, base, observed);
    const committed = await snapshot(pool);
    const storedRevision = committed.device_tokens[0].inventory_revision;
    assert.ok(storedRevision);
    assert.equal(await revision(pool, reporter), storedRevision);
    assert.equal(committed.sync_runs[0].id, storedRevision);
    assert.equal(committed.sync_runs[0].status, "completed");
    for (const stale of [base, randomUUID()]) {
      await assert.rejects(upload3(pool, reporter, stale, observed, coverage(), later(1)), status(409));
      assert.deepEqual(await snapshot(pool), committed);
    }
  });
});

test("two competing same-base reports accept exactly one and never retain loser rows or a loser run", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    await upload2(pool, reporter, [presence("original")]);
    const before = await snapshot(pool);
    const [firstBase, secondBase] = await Promise.all([revision(pool, reporter), revision(pool, reporter)]);
    assert.equal(firstBase, secondBase);
    const results = await Promise.allSettled([
      upload3(pool, reporter, firstBase, [presence("first")], coverage(), later(1)),
      upload3(pool, reporter, secondBase, [presence("second")], coverage(), later(1))
    ]);
    const accepted = results.filter(result => result.status === "fulfilled");
    const rejected = results.filter(result => result.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(status(409)(rejected[0].reason));
    const state = await snapshot(pool);
    assert.equal(state.sync_runs.length, before.sync_runs.length + 1);
    assert.equal(state.synced_skills.length, 2);
    assert.deepEqual(state.synced_skills.filter(row => row.is_current).map(row => row.name),
      [results[0].status === "fulfilled" ? "first" : "second"]);
    assert.equal(state.device_tokens[0].inventory_revision, accepted[0].value.syncRunId);
    const original = before.synced_skills[0];
    assert.deepEqual(state.synced_skills.find(row => row.id === original.id), { ...original, is_current: false });
  });
});

test("deferred revision-trigger failure rolls back inventory, missing marks, coverage, protocol, Sets and last-use", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    await upload2(pool, reporter, [presence("removed")]);
    const original = (await snapshot(pool)).synced_skills[0];
    await pinnedSet(pool, owner, original.id);
    const base = await revision(pool, reporter);
    const before = await snapshot(pool);
    // A deferred trigger fails at commit, after both the upsert and the missing mark really ran.
    await pool.query(`CREATE FUNCTION fail_inventory_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.inventory_revision IS DISTINCT FROM OLD.inventory_revision THEN
          IF NOT EXISTS (SELECT 1 FROM synced_skills WHERE device_id=NEW.id AND name='rollback-new' AND is_current)
            OR NOT EXISTS (SELECT 1 FROM synced_skills WHERE device_id=NEW.id AND name='removed' AND NOT is_current)
            OR NOT EXISTS (SELECT 1 FROM sync_runs WHERE id=NEW.inventory_revision AND status='completed' AND scan_coverage IS NOT NULL) THEN
            RAISE EXCEPTION 'expected writer state before rollback' USING ERRCODE='P0002';
          END IF;
          RAISE EXCEPTION 'injected revision commit failure' USING ERRCODE='P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE CONSTRAINT TRIGGER fail_inventory_revision AFTER UPDATE ON device_tokens
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_inventory_revision()`);
    await assert.rejects(upload3(pool, reporter, base, [presence("rollback-new")], coverage(), later(2)),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P0001");
    assert.deepEqual(await snapshot(pool), before);
    assert.equal(await revision(pool, reporter, later(2)), base);
    await pool.query("DROP TRIGGER fail_inventory_revision ON device_tokens");
    const retry = await upload3(pool, reporter, base, [presence("rollback-new")], coverage(), later(2));
    assert.equal(retry.missingSkillCount, 1);
    assertSetPreserved(await snapshot(pool), before);
  });
});

test("revision reads and writes reject revoked, expired, forged and missing-sync-scope credentials without writes", async () => {
  await withSchema(async pool => {
    const owner = await user(pool);
    const revoked = await device(pool, owner), expired = await device(pool, owner), noScope = await device(pool, owner);
    await pool.query("UPDATE device_tokens SET revoked_at=$2 WHERE id=$1", [revoked.id, now]);
    await pool.query("UPDATE device_tokens SET created_at=$2,expires_at=$3 WHERE id=$1", [expired.id, later(-3), later(-1)]);
    // Simulate a corrupted/older stored credential; production auth, not a mock, must reject it.
    await pool.query("ALTER TABLE device_tokens DROP CONSTRAINT device_tokens_granted_scopes_check");
    await pool.query("UPDATE device_tokens SET granted_scopes=ARRAY['self:revoke']::text[] WHERE id=$1", [noScope.id]);
    const before = await snapshot(pool);
    for (const reporter of [revoked, expired, noScope, { credential: createDeviceCredential() }, { credential: "invalid" }]) {
      await assert.rejects(readInventoryRevision(pool, request(reporter, "GET"), now), status(401));
      await assert.rejects(upload3(pool, reporter, null, []), status(401));
      assert.deepEqual(await snapshot(pool), before);
    }
  });
});

function check(pool: Pool, reporter: Pick<Device, "credential">, baseRevision: string, at = now) {
  return performInventoryCheck(pool, request(reporter), { reportVersion: 3, mode: "check", baseRevision }, at);
}

test("check-time migration is additive, preserves prior inventory/Sets and does not invent check timestamps", async () => {
  let before: Awaited<ReturnType<typeof snapshot>>;
  await withSchema(async pool => {
    const after = await snapshot(pool);
    assert.deepEqual({ ...after, device_tokens: after.device_tokens.map(({ inventory_checked_at, reconnect_key_hash, ...old }) => old) }, before);
    assert.ok(after.device_tokens.every(row => row.inventory_checked_at === null));
    assert.ok(after.device_tokens.every(row => row.reconnect_key_hash === null));
    assertSetPreserved(after, before);
  }, async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    for (const deviceId of [null, reporter.id]) {
      const run = randomUUID(), skill = randomUUID();
      await pool.query(`INSERT INTO sync_runs(id,user_id,device_id,status,completed_at,scan_coverage)
        VALUES($1,$2,$3,'completed',$4,$5::jsonb)`, [run, owner, deviceId, now, deviceId ? JSON.stringify(coverage()) : null]);
      await pool.query(`INSERT INTO synced_skills(id,user_id,sync_run_id,device_id,stable_key,name,source,identity_status,is_local_only,last_seen_at)
        VALUES($1,$2,$3,$4,'location:v1:codex:review','Review','Codex','localOnly',true,$5)`, [skill, owner, run, deviceId, now]);
      if (deviceId) await pool.query('UPDATE device_tokens SET inventory_protocol=3,inventory_revision=$2 WHERE id=$1', [deviceId, run]);
      await pinnedSet(pool, owner, skill);
    }
    before = await snapshot(pool);
  }, checkMigration);
});

test("unchanged checks update only check/use time, retain missing rows and Sets, and separate v3 freshness from reports", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), other = await user(pool);
    const a = await device(pool, owner), b = await device(pool, owner), foreign = await device(pool, other);
    const first = await upload3(pool, a, null, [presence("keep"), presence("missing")]);
    const missing = (await snapshot(pool)).synced_skills.find(row => row.name === "missing")!;
    await pinnedSet(pool, owner, missing.id);
    const reportedAt = new Date(now.getTime() + 3600_000);
    const latest = await upload3(pool, a, first.revision, [presence("keep")], coverage(), reportedAt);
    await upload2(pool, b, [presence("other-mac")]);
    await upload3(pool, foreign, null, [presence("foreign")]);
    await legacyUpload(pool, owner, [legacy("older-upload")]);
    const before = await snapshot(pool);
    const oldRead = await readSyncInventory(pool, owner, 1, reportedAt);
    const v2Read = await readSyncInventory(pool, owner, 2, reportedAt);
    const checked = await check(pool, a, latest.revision.toUpperCase(), later(1));
    assert.deepEqual(checked, { reportVersion: 3, mode: "checked", deviceId: a.id,
      revision: latest.revision, checkedAt: later(1).toISOString() });
    const after = await snapshot(pool);
    assert.deepEqual(after, { ...before, device_tokens: before.device_tokens.map(row => row.id === a.id
      ? { ...row, inventory_checked_at: later(1), last_used_at: later(1) } : row) });
    assertSetPreserved(after, before);
    const repeatedAt = new Date(later(1).getTime() + 60_000);
    const repeated = await check(pool, a, latest.revision, repeatedAt);
    assert.equal(repeated.checkedAt, repeatedAt.toISOString());
    const repeatedState = await snapshot(pool);
    assert.deepEqual(repeatedState, { ...after, device_tokens: after.device_tokens.map(row => row.id === a.id
      ? { ...row, inventory_checked_at: repeatedAt } : row) });
    const read = await readSyncInventory(pool, owner, 3, repeatedAt);
    const mac = read.devices!.find(row => row.id === a.id)!;
    assert.equal(mac.lastCheckedAt?.toISOString(), repeatedAt.toISOString());
    assert.equal(mac.lastReportedAt?.toISOString(), reportedAt.toISOString());
    assert.deepEqual(mac.scanCoverage, coverage());
    assert.equal(read.skills.find(row => row.id === missing.id)?.isCurrent, false);
    assert.equal(read.skills.find(row => row.id === missing.id)?.lastSeenAt.toISOString(), now.toISOString());
    // The v3 reader may add freshness; legacy shapes and shared device lists do not change.
    assert.deepEqual(await readSyncInventory(pool, owner, 1, reportedAt), oldRead);
    assert.deepEqual(await readSyncInventory(pool, owner, 2, reportedAt), v2Read);
    assert.ok(read.devices!.every(row => row.id !== foreign.id));
    assert.equal(read.devices!.find(row => row.id === b.id)?.lastCheckedAt, null);
    // A clock step backward must not regress the accepted check time.
    assert.equal((await check(pool, a, latest.revision, later(1))).checkedAt, repeatedAt.toISOString());
  });
});

test("partial coverage and invalid stored baselines cannot acknowledge an unchanged complete scan", async t => {
  const cases = ["no-report", "v2", "stale", "other-device", "other-account", "failed", "unfinished",
    "no-completion-time", "null-coverage", "duplicate-roots", "extra-coverage-field", "partial", "unavailable"];
  for (const scenario of cases) await t.test(scenario, async () => {
    await withSchema(async pool => {
      const owner = await user(pool), reporter = await device(pool, owner);
      let base: string = randomUUID();
      if (scenario === "v2") base = (await upload2(pool, reporter, [presence("old")])).syncRunId;
      else if (scenario !== "no-report") {
        const roots = scenario === "partial" ? coverage({ codex: { state: "incomplete", reason: "changed" } })
          : scenario === "unavailable" ? coverage({ codex: { state: "unavailable", reason: "missing" } }) : coverage();
        base = (await upload3(pool, reporter, null, [presence("keep", "claude")], roots)).revision;
      }
      if (scenario === "stale") await upload3(pool, reporter, base, [presence("new")], coverage(), later(1));
      if (scenario === "other-device" || scenario === "other-account") {
        const otherOwner = scenario === "other-account" ? await user(pool) : owner;
        const other = await device(pool, otherOwner);
        base = (await upload3(pool, other, null, [])).revision;
        // Even a corrupted device revision cannot authorize another device/account's report.
        await pool.query("UPDATE device_tokens SET inventory_revision=$2 WHERE id=$1", [reporter.id, base]);
      }
      if (["failed", "unfinished", "no-completion-time"].includes(scenario)) {
        await pool.query("UPDATE sync_runs SET status=$2,completed_at=$3 WHERE id=$1", [base,
          scenario === "failed" ? "failed" : scenario === "unfinished" ? "started" : "completed",
          scenario === "no-completion-time" ? null : now]);
      }
      if (["null-coverage", "duplicate-roots", "extra-coverage-field"].includes(scenario)) {
        const bad = scenario === "null-coverage" ? null : scenario === "duplicate-roots"
          ? [coverage()[0], coverage()[0], coverage()[2]] : [{ ...coverage()[0], unexpected: true }, ...coverage().slice(1)];
        await pool.query("UPDATE sync_runs SET scan_coverage=$2::jsonb WHERE id=$1", [base, JSON.stringify(bad)]);
      }
      const before = await snapshot(pool);
      await assert.rejects(check(pool, reporter, base, later(2)), status(409));
      assert.deepEqual(await snapshot(pool), before);
      if (scenario === "partial" || scenario === "unavailable") {
        const read = await readSyncInventory(pool, owner, 3, later(2));
        assert.ok(read.devices![0].scanCoverage!.some(root => root.state !== "complete"));
        assert.equal(read.devices![0].lastCheckedAt?.toISOString(), now.toISOString());
      }
    });
  });
});

test("checks require current scoped credentials and never write on authentication or body failure", async () => {
  await withSchema(async pool => {
    const owner = await user(pool);
    const revoked = await device(pool, owner), expired = await device(pool, owner), noScope = await device(pool, owner);
    const active = await device(pool, owner), inactive = await device(pool, owner);
    const base = (await upload3(pool, active, null, [])).revision;
    await pool.query("UPDATE device_tokens SET revoked_at=$2 WHERE id=$1", [revoked.id, now]);
    await pool.query("UPDATE device_tokens SET created_at=$2,expires_at=$3 WHERE id=$1", [expired.id, later(-3), later(-1)]);
    await pool.query("UPDATE device_tokens SET created_at=$2,last_used_at=NULL WHERE id=$1", [inactive.id, later(-200)]);
    await pool.query("ALTER TABLE device_tokens DROP CONSTRAINT device_tokens_granted_scopes_check");
    await pool.query("UPDATE device_tokens SET granted_scopes=ARRAY['self:revoke']::text[] WHERE id=$1", [noScope.id]);
    const before = await snapshot(pool);
    for (const reporter of [revoked, expired, noScope, inactive, { credential: createDeviceCredential() }, { credential: "bad" }]) {
      await assert.rejects(check(pool, reporter, base), status(401));
      assert.deepEqual(await snapshot(pool), before);
    }
    for (const body of [{ reportVersion: 3, mode: "check", baseRevision: base, deviceId: active.id },
      { reportVersion: 3, mode: "check", baseRevision: base, token: "old" }]) {
      await assert.rejects(performInventoryCheck(pool, request(active), body), status(400));
      assert.deepEqual(await snapshot(pool), before);
    }
  });
});

test("deferred check failure rolls back freshness and last-use without touching inventory or Set links", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    const report = await upload3(pool, reporter, null, [presence("keep")]);
    await pinnedSet(pool, owner, (await snapshot(pool)).synced_skills[0].id);
    const before = await snapshot(pool);
    await pool.query(`CREATE FUNCTION fail_inventory_check() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.inventory_checked_at IS DISTINCT FROM OLD.inventory_checked_at THEN
          IF NOT EXISTS (SELECT 1 FROM device_tokens WHERE id=NEW.id AND last_used_at > OLD.last_used_at) THEN
            RAISE EXCEPTION 'expected last-use update before rollback' USING ERRCODE='P0002';
          END IF;
          RAISE EXCEPTION 'injected check commit failure' USING ERRCODE='P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE CONSTRAINT TRIGGER fail_inventory_check AFTER UPDATE ON device_tokens
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_inventory_check()`);
    await assert.rejects(check(pool, reporter, report.revision, later(2)),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P0001");
    assert.deepEqual(await snapshot(pool), before);
    await pool.query("DROP TRIGGER fail_inventory_check ON device_tokens");
    assert.equal((await check(pool, reporter, report.revision, later(2))).revision, report.revision);
    assertSetPreserved(await snapshot(pool), before);
  });
});

test("a check and a full report serialize on the same revision without stale freshness or lost inventory", async () => {
  await withSchema(async pool => {
    const owner = await user(pool), reporter = await device(pool, owner);
    const original = await upload3(pool, reporter, null, [presence("original")]);
    const before = await snapshot(pool);
    const [checked, uploaded] = await Promise.allSettled([
      check(pool, reporter, original.revision, later(1)),
      upload3(pool, reporter, original.revision, [presence("replacement")], coverage(), later(1))
    ]);
    assert.equal(uploaded.status, "fulfilled");
    if (uploaded.status !== "fulfilled") return;
    if (checked.status === "fulfilled") assert.equal(checked.value.revision, original.revision);
    else assert.ok(status(409)(checked.reason));
    const after = await snapshot(pool);
    assert.equal(after.sync_runs.length, before.sync_runs.length + 1);
    assert.equal(after.device_tokens[0].inventory_revision, uploaded.value.revision);
    assert.equal(after.device_tokens[0].inventory_checked_at.toISOString(), later(1).toISOString());
    assert.deepEqual(after.synced_skills.filter(row => row.is_current).map(row => row.name), ["replacement"]);
    await assert.rejects(check(pool, reporter, original.revision, later(2)), status(409));
    assert.deepEqual(await snapshot(pool), after);
    await check(pool, reporter, uploaded.value.revision, later(2));
    const final = await snapshot(pool);
    assert.deepEqual(final.synced_skills, after.synced_skills);
    assert.deepEqual(final.sync_runs, after.sync_runs);
    assert.equal(final.device_tokens[0].inventory_revision, uploaded.value.revision);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import type { Context } from "@netlify/functions";
import { lockLegacyInventorySchema, requireLegacyInventoryRead, requireLegacyInventoryReport } from "./legacy-inventory-schema.js";
import { readLegacySyncInventory } from "./sync-inventory.js";
import { portalSyncUpload } from "../portal-sync-upload.mjs";
import { portalSyncedSkills } from "../portal-synced-skills.mjs";
import { createSyncToken } from "./crypto.js";

test("schema inspection holds migration locks and never caches across transactions", async () => {
  const queries: string[] = [];
  let deviceScoped = false;
  const client = { query: async (sql: string) => {
    queries.push(sql);
    return { rows: [{ device_scoped: deviceScoped }] };
  } } as unknown as PoolClient;
  assert.equal(await lockLegacyInventorySchema(client), false);
  deviceScoped = true;
  assert.equal(await lockLegacyInventorySchema(client, true), true);
  assert.match(queries[0], /^LOCK TABLE sync_runs, synced_skills IN ROW EXCLUSIVE MODE$/);
  assert.match(queries[1], /attrelid = 'synced_skills'::regclass/);
  assert.match(queries[2], /^LOCK TABLE sync_runs, synced_skills IN ACCESS SHARE MODE$/);
});

for (const deviceScoped of [false, true]) {
  test(`legacy reader preserves its contract with device column ${deviceScoped}`, async () => {
    const queries: string[] = [];
    let released = false;
    const rows = [{ id: "kept-row", name: "Example" }];
    const pool = { connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("pg_attribute")) return { rows: [{ device_scoped: deviceScoped }] };
        if (sql.includes("FROM synced_skills")) {
          assert.deepEqual(values, ["owner"]);
          assert.equal(sql.includes("AND device_id IS NULL"), deviceScoped);
          return { rows };
        }
        return { rows: [] };
      },
      release: () => { released = true; }
    }) } as unknown as Pool;
    assert.deepEqual(await readLegacySyncInventory(pool, "owner"), { skills: rows });
    assert.equal(queries[0], "BEGIN READ ONLY");
    assert.equal(queries.at(-1), "COMMIT");
    assert.equal(released, true);
  });
}

test("failed legacy read rolls back and releases its connection", async () => {
  const queries: string[] = [];
  let released = false;
  const failure = new Error("fixture read failure");
  const pool = { connect: async () => ({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_attribute")) throw failure;
      return { rows: [] };
    }, release: () => { released = true; }
  }) } as unknown as Pool;
  await assert.rejects(readLegacySyncInventory(pool, "owner"), error => error === failure);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(released, true);
});

test("the bridge accepts only the legacy report/read protocol", () => {
  for (const report of [{}, { reportVersion: 1 }]) assert.doesNotThrow(() => requireLegacyInventoryReport(report));
  for (const reportVersion of [2, 3]) {
    assert.throws(() => requireLegacyInventoryReport({ reportVersion }), e => e instanceof Response && e.status === 503);
  }
  for (const reportVersion of [null, "1", 4, 0]) {
    assert.throws(() => requireLegacyInventoryReport({ reportVersion }), e => e instanceof Response && e.status === 400);
  }
  for (const suffix of ["", "?version=1"]) {
    assert.doesNotThrow(() => requireLegacyInventoryRead(new Request("https://example.test/api/portal/synced-skills" + suffix)));
  }
  for (const suffix of ["?version=2", "?version=3"]) {
    assert.throws(() => requireLegacyInventoryRead(new Request("https://example.test/api/portal/synced-skills" + suffix)),
      e => e instanceof Response && e.status === 503);
  }
  for (const suffix of ["?version=2&version=1", "?version=4", "?version="]) {
    assert.throws(() => requireLegacyInventoryRead(new Request("https://example.test/api/portal/synced-skills" + suffix)),
      e => e instanceof Response && e.status === 400);
  }
});

test("new report versions are rejected before pool access or credential consumption", async () => {
  for (const reportVersion of [2, 3]) {
    const response = await portalSyncUpload(new Request("https://example.test/api/portal/sync-upload", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportVersion, token: createSyncToken(), skills: [] })
    }), {} as Context, {
      requireSkillGroupsWebFeature: () => {},
      getPgPool: () => { throw Error("must not access pool"); },
      performSyncUpload: async () => { throw Error("must not consume token"); }
    });
    assert.equal(response.status, 503);
  }
});

test("legacy upload still authenticates and returns its existing shape", async () => {
  const token = createSyncToken();
  const pool = {} as Pool;
  const response = await portalSyncUpload(new Request("https://example.test/api/portal/sync-upload", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, skills: [] })
  }), {} as Context, {
    requireSkillGroupsWebFeature: () => {}, getPgPool: () => pool,
    performSyncUpload: async (receivedPool, authentication, skills) => {
      assert.equal(receivedPool, pool);
      assert.deepEqual(authentication, { kind: "legacy", token });
      assert.deepEqual(skills, []);
      return { syncRunId: "existing-shape", syncedSkillCount: 0 };
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { syncRunId: "existing-shape", syncedSkillCount: 0 });
});

test("legacy read remains account-authorized and newer reads never fall back", async () => {
  let authorized = false;
  let read = false;
  const dependencies = {
    requirePortalUser: async () => {
      authorized = true;
      return { id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: "Owner" };
    },
    getPgPool: () => { assert.equal(authorized, true); return {} as Pool; },
    readLegacySyncInventory: async (_pool: Pool, owner: string) => {
      read = true;
      assert.equal(owner, "owner");
      return { skills: [] };
    }
  };
  const rejected = await portalSyncedSkills(new Request("https://example.test/api/portal/synced-skills?version=2"), {} as Context, dependencies);
  assert.equal(rejected.status, 503);
  assert.equal(authorized, false);
  assert.equal(read, false);
  const accepted = await portalSyncedSkills(new Request("https://example.test/api/portal/synced-skills"), {} as Context, dependencies);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { skills: [] });
  assert.equal(read, true);
});

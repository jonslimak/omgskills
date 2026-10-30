import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { portalSyncUpload } from "../portal-sync-upload.mjs";
import { portalSyncedSkills } from "../portal-synced-skills.mjs";
import { createDeviceCredential } from "./crypto.js";
import { DeviceAuthError } from "./device-auth.js";
import { inventoryReadVersion } from "./sync-inventory-read.js";
import type { RootCoverage } from "./inventory-reconciliation.js";

const context = {} as Context;
const pool = {} as Pool;
const credential = createDeviceCredential();
const presence = { source: "codex", installationPath: "review", name: "Review" };
function request(body: unknown, authorization: string | null = `Bearer ${credential}`) {
  return new Request("https://example.test/api/portal/sync-upload", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }
  });
}
const noDatabase = () => { assert.fail("invalid request must not access the database"); };

test("upload dispatches explicit presence mode and leaves unversioned clients in legacy mode", async () => {
  for (const reportVersion of [undefined, 2]) {
    let called = false;
    const response = await portalSyncUpload(request({ reportVersion, skills: reportVersion ? [presence] : [] }), context, {
      requireSkillGroupsWebFeature() {}, getPgPool: () => pool,
      requireReconciliation() {},
      async performSyncUpload(actualPool, authentication, skills, now, version) {
        called = true;
        assert.equal(actualPool, pool);
        assert.equal(authentication.kind, "device");
        assert.equal(version, reportVersion ?? 1);
        assert.ok(now instanceof Date);
        if (version === 2) assert.equal(skills[0].stableKey, "location:v1:codex:review");
        return { syncRunId: "run", syncedSkillCount: skills.length };
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(called, true);
  }
});

test("invalid upload contracts and missing/malformed bearer auth cannot reach storage", async () => {
  const deps = { requireSkillGroupsWebFeature() {}, getPgPool: noDatabase,
    requireReconciliation() {},
    performSyncUpload: noDatabase };
  for (const body of [
    { reportVersion: "2", skills: [] }, { reportVersion: null, skills: [] },
    { reportVersion: 2, userId: "other", skills: [] },
    { reportVersion: 2, deviceId: "other", skills: [] },
    { reportVersion: 2, token: "old", skills: [] },
    { reportVersion: 2, skills: [presence, presence] },
    { reportVersion: 2, skills: [{ ...presence, installationPath: "/Users/secret/skill" }] }
  ]) {
    assert.equal((await portalSyncUpload(request(body), context, deps)).status, 400);
  }
  assert.equal((await portalSyncUpload(request({ reportVersion: 2, skills: [] }, null), context, deps)).status, 401);
  assert.equal((await portalSyncUpload(request({ reportVersion: 2, skills: [] }, "Bearer bad"), context, deps)).status, 401);
  assert.equal((await portalSyncUpload(request({ reportVersion: 2, skills: [] }), context, {
    ...deps, getPgPool: () => pool, async performSyncUpload() { throw new DeviceAuthError(); }
  })).status, 401);
});

test("uploads reject absent or malformed credentials before report validation", async () => {
  const deps = { requireSkillGroupsWebFeature() {}, getPgPool: noDatabase,
    requireReconciliation: noDatabase, performSyncUpload: noDatabase };
  for (const body of ["{", "null", "[]", "{}", '{"skills":"bad"}',
    '{"reportVersion":3,"mode":"bad"}', '{"token":null}', '{"token":"  "}']) {
    for (const authorization of [undefined, "Bearer bad", "Basic invalid"]) {
      const req = new Request("https://example.test/api/portal/sync-upload", {
        method: "POST", body,
        headers: authorization ? { Authorization: authorization } : {}
      });
      assert.equal((await portalSyncUpload(req, context, deps)).status, 401, body);
    }
  }
});

test("credential-bearing uploads retain payload errors and legacy token compatibility", async () => {
  const deps = { requireSkillGroupsWebFeature() {}, getPgPool: noDatabase,
    requireReconciliation() {}, performSyncUpload: noDatabase };
  for (const body of ["{", "null", "[]", '{"skills":"bad"}']) {
    const req = new Request("https://example.test/api/portal/sync-upload", {
      method: "POST", body, headers: { Authorization: `Bearer ${credential}` }
    });
    assert.equal((await portalSyncUpload(req, context, deps)).status, 400);
  }
  assert.equal((await portalSyncUpload(request({ token: "legacy", skills: "bad" }, null), context, deps)).status, 400);
  const response = await portalSyncUpload(request({ token: "legacy", skills: [] }, null), context, {
    ...deps, getPgPool: () => pool,
    async performSyncUpload(_pool, authentication) {
      assert.deepEqual(authentication, { kind: "legacy", token: "legacy" });
      return { syncRunId: "legacy-run", syncedSkillCount: 0 };
    }
  });
  assert.equal(response.status, 200);
});

test("inventory endpoint authenticates before data access and uses only the authenticated owner", async () => {
  const user = { id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: null };
  let authenticated = false;
  const response = await portalSyncedSkills(new Request("https://example.test/api/portal/synced-skills?version=2&userId=other"), context, {
    requireReconciliation() {},
    async requirePortalUser() { authenticated = true; return user; },
    getPgPool() { assert.equal(authenticated, true); return pool; },
    async readSyncInventory(actualPool, userId, version) {
      assert.equal(actualPool, pool);
      assert.equal(userId, "owner");
      assert.equal(version, 2);
      return { inventoryVersion: 2, skills: [], devices: [] };
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { inventoryVersion: 2, skills: [], devices: [] });
  const unauthenticated = await portalSyncedSkills(new Request("https://example.test/api/portal/synced-skills?version=2"), context, {
    requireReconciliation() {},
    requirePortalUser: async () => { throw new Response("Unauthorized", { status: 401 }); },
    getPgPool: noDatabase, readSyncInventory: noDatabase
  });
  assert.equal(unauthenticated.status, 401);
});

test("inventory endpoint refuses unknown or duplicate version before reading", async () => {
  for (const query of ["version=4", "version=2&version=1", "version=3&version=3", "version=3&userId=other", "%76ersion=3"]) {
    const response = await portalSyncedSkills(new Request(`https://example.test/api/portal/synced-skills?${query}`), context, {
      requirePortalUser: noDatabase, getPgPool: noDatabase, readSyncInventory: noDatabase
    });
    assert.equal(response.status, 400);
  }
});

const reconciliationEnv = {
  OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "1", OMGSKILLS_CONNECTED_INVENTORY_TEST: "1",
  PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", CONTEXT: "dev", NODE_ENV: "test",
  PORTAL_TEST_API_ORIGIN: "http://127.0.0.1:8888"
};

test("version 3 read parsing is exact and stays opt-in without changing legacy/v2 queries", () => {
  const read = (query = "") => new Request(`http://127.0.0.1:8888/api/portal/synced-skills${query}`);
  assert.equal(inventoryReadVersion(read()), 1);
  assert.equal(inventoryReadVersion(read("?version=2&userId=ignored")), 2);
  assert.throws(() => inventoryReadVersion(read("?version=3")), error => error instanceof Response && error.status === 400);
  assert.equal(inventoryReadVersion(read("?version=3"), true), 3);
  for (const query of ["?version=3&userId=other", "?version=3&version=3", "?%76ersion=3", "?version=03", "?version=4"]) {
    assert.throws(() => inventoryReadVersion(read(query), true), error => error instanceof Response && error.status === 400);
  }
});

test("v3 inventory reads preserve retained facts, authenticate the account and require the local gate", async () => {
  const read = (origin = "http://127.0.0.1:8888") => new Request(`${origin}/api/portal/synced-skills?version=3`);
  const roots: RootCoverage[] = [{ source: "claude", state: "unavailable", reason: "missing" },
    { source: "codex", state: "complete" }, { source: "agents", state: "complete" }];
  const body = { inventoryVersion: 3 as const, skills: [{ id: "retained", deviceId: "mac", isCurrent: false }],
    devices: [{ id: "mac", deviceName: "Test Mac", status: "active", lastReportedAt: new Date("2026-10-16T12:00:00Z"), scanCoverage: roots }] };
  let authenticated = false;
  const deps = {
    getEnvironment: () => reconciliationEnv,
    async requirePortalUser() { authenticated = true; return { id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: null }; },
    getPgPool() { assert.equal(authenticated, true); return pool; },
    async readSyncInventory(actualPool: Pool, userId: string, version: number) {
      assert.equal(actualPool, pool); assert.equal(userId, "owner"); assert.equal(version, 3); return body;
    }
  };
  const response = await portalSyncedSkills(read(), context, deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(body)));
  const blocked = { ...deps, requirePortalUser: noDatabase, getPgPool: noDatabase, readSyncInventory: noDatabase };
  assert.equal((await portalSyncedSkills(read(), context, { ...blocked, getEnvironment: () => ({}) })).status, 503);
  assert.equal((await portalSyncedSkills(read("https://example.test"), context, blocked)).status, 503);
  assert.equal((await portalSyncedSkills(read(), { deploy: { context: "production" } } as Context, blocked)).status, 503);
  const denied = await portalSyncedSkills(read(), context, { ...blocked,
    requirePortalUser: async () => { throw new Response("Unauthorized", { status: 401 }); } });
  assert.equal(denied.status, 401);
});

test("default and explicitly enabled v2 account reads retain their response shapes", async () => {
  for (const [query, version] of [["", 1], ["?version=2", 2]] as const) {
    const body = version === 1 ? { skills: [] } : { inventoryVersion: 2 as const, skills: [], devices: [] };
    const response = await portalSyncedSkills(new Request(`https://example.test/api/portal/synced-skills${query}`), context, {
      getEnvironment: () => ({}), getPgPool: () => pool,
      requireReconciliation() {},
      requirePortalUser: async () => ({ id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: null }),
      async readSyncInventory(_pool, owner, actualVersion) { assert.equal(owner, "owner"); assert.equal(actualVersion, version); return body; }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body);
  }
});
const completeRoots = ["claude", "codex", "agents"].map(source => ({ source, state: "complete" }));
const reconciliationReport = { reportVersion: 3, baseRevision: null, roots: completeRoots, skills: [presence] };
function localRequest(body?: unknown, query = "", authorization: string | null = `Bearer ${credential}`) {
  return new Request(`http://127.0.0.1:8888/api/portal/sync-upload${query}`, {
    method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }
  });
}

test("revision endpoint is exact, device-authenticated, no-store and unavailable by default", async () => {
  const deps = { requireSkillGroupsWebFeature() {}, getPgPool: () => pool, performSyncUpload: noDatabase,
    getEnvironment: () => reconciliationEnv,
    async readInventoryRevision(actualPool: Pool, req: Request) {
      assert.equal(actualPool, pool); assert.equal(req.headers.get("authorization"), `Bearer ${credential}`);
      return { reportVersion: 3 as const, revision: null };
    } };
  const response = await portalSyncUpload(localRequest(undefined, "?reportVersion=3"), context, deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { reportVersion: 3, revision: null });
  for (const query of ["?reportVersion=2", "?reportVersion=3&deviceId=other", "?reportVersion=3&reportVersion=3"])
    assert.equal((await portalSyncUpload(localRequest(undefined, query), context, { ...deps, getPgPool: noDatabase })).status, 400);
  assert.equal((await portalSyncUpload(localRequest(), context, { ...deps, getPgPool: noDatabase })).status, 405);
  assert.equal((await portalSyncUpload(localRequest(undefined, "?reportVersion=3", null), context, { ...deps, getPgPool: noDatabase })).status, 401);
  assert.equal((await portalSyncUpload(localRequest(undefined, "?reportVersion=3"), context,
    { ...deps, getEnvironment: () => ({}), getPgPool: noDatabase })).status, 503);
});

test("version-3 upload requires the local opt-in and dispatches only parsed reconciliation facts", async () => {
  let calls = 0;
  const deps = { requireSkillGroupsWebFeature() {}, getPgPool: () => pool, getEnvironment: () => reconciliationEnv,
    async performSyncUpload(actualPool: Pool, auth: Parameters<typeof import("./sync-upload.js").performSyncUpload>[1],
      skills: Parameters<typeof import("./sync-upload.js").performSyncUpload>[2], now: Date | undefined,
      version: number | undefined, reconciliation: Parameters<typeof import("./sync-upload.js").performSyncUpload>[5]) {
      calls++; assert.equal(actualPool, pool); assert.equal(auth.kind, "device"); assert.equal(version, 3);
      assert.ok(now instanceof Date); assert.equal(skills.length, 1);
      assert.deepEqual(reconciliation, { baseRevision: null, roots: completeRoots });
      return { syncRunId: "run", syncedSkillCount: 1 };
    } };
  assert.equal((await portalSyncUpload(localRequest(reconciliationReport), context, deps)).status, 200);
  assert.equal(calls, 1);
  for (const req of [localRequest(reconciliationReport, "?reportVersion=3"),
    localRequest({ ...reconciliationReport, userId: "other" }),
    localRequest({ ...reconciliationReport, baseRevision: "bad" })]) {
    assert.equal((await portalSyncUpload(req, context, { ...deps, getPgPool: noDatabase })).status, 400);
  }
  assert.equal((await portalSyncUpload(localRequest(reconciliationReport), context,
    { ...deps, getEnvironment: () => ({}), getPgPool: noDatabase })).status, 503);
  assert.equal((await portalSyncUpload(localRequest(reconciliationReport), { deploy: { context: "production" } } as Context,
    { ...deps, getPgPool: noDatabase })).status, 503);
  assert.equal((await portalSyncUpload(localRequest(reconciliationReport), context,
    { ...deps, performSyncUpload: async () => { throw new Response("Stale", { status: 409 }); } })).status, 409);
});

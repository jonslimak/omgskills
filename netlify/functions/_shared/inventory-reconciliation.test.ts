import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { parseInventoryCheck, parseReconciliationFields, requireLocalInventoryReconciliation } from "./inventory-reconciliation.js";
import { portalSyncUpload } from "../portal-sync-upload.mjs";
import { createDeviceCredential } from "./crypto.js";
import { DeviceAuthError } from "./device-auth.js";

const roots = ["claude", "codex", "agents"].map(source => ({ source, state: "complete" }));
const env = {
  OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "1", OMGSKILLS_CONNECTED_INVENTORY_TEST: "1",
  PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", CONTEXT: "dev", NODE_ENV: "test",
  PORTAL_TEST_API_ORIGIN: "http://127.0.0.1:8888"
};
const request = new Request("http://127.0.0.1:8888/api/portal/sync-upload?reportVersion=3");
function rejects(run: () => unknown, status: number) {
  assert.throws(run, (error: unknown) => error instanceof Response && error.status === status);
}

test("reconciliation coverage is closed, complete and preserves explicit revision semantics", () => {
  assert.deepEqual(parseReconciliationFields({ baseRevision: null, roots }), { baseRevision: null, roots });
  const revision = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
  assert.equal(parseReconciliationFields({ baseRevision: revision, roots }).baseRevision, revision.toLowerCase());
  for (const [state, reasons] of Object.entries({ incomplete: ["changed", "invalid-entry", "invalid-metadata"],
    unavailable: ["missing", "unreadable", "redirected"] })) {
    for (const reason of reasons) assert.equal(parseReconciliationFields({ baseRevision: null,
      roots: [{ source: "claude", state, reason }, ...roots.slice(1)] }).roots[0].reason, reason);
  }
  for (const bad of [
    {}, { baseRevision: undefined, roots }, { baseRevision: "bad", roots }, { baseRevision: 1, roots },
    { baseRevision: null, roots: [] }, { baseRevision: null, roots: [...roots, roots[0]] },
    { baseRevision: null, roots: [roots[0], roots[0], roots[2]] },
    ...[{ source: "other", state: "complete" }, { source: "Claude", state: "complete" },
      { source: "claude", state: "complete", reason: null },
      { source: "claude", state: "complete", reason: "missing" },
      { source: "claude", state: "incomplete", reason: "missing" },
      { source: "claude", state: "unavailable", reason: "changed" },
      { source: "claude", state: "unknown" }, { source: "claude", state: "incomplete" },
      { source: "claude", state: "complete", path: "/Users/private" }, null, []]
      .map(root => ({ baseRevision: null, roots: [root, ...roots.slice(1)] }))
  ]) rejects(() => parseReconciliationFields(bad), 400);
});

test("reconciliation remains dormant except for exact verified development loopback configuration", () => {
  requireLocalInventoryReconciliation(request, env, "dev");
  for (const key of Object.keys(env)) rejects(() => requireLocalInventoryReconciliation(request, { ...env, [key]: undefined }), 503);
  for (const change of [
    { OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "true" }, { CONTEXT: "production" }, { CONTEXT: "deploy-preview" },
    { NODE_ENV: "production" }, { PORTAL_TEST_ENVIRONMENT_VERIFIED: "0" },
    ...["https://example.com", "http://127.0.0.1", "http://user:secret@127.0.0.1:8888", "http://127.0.0.1:8888/path",
      "http://127.0.0.1:8888/?query=1", "http://127.0.0.1:8888/#fragment", "http://127.0.0.1:9999"]
      .map(PORTAL_TEST_API_ORIGIN => ({ PORTAL_TEST_API_ORIGIN }))
  ]) rejects(() => requireLocalInventoryReconciliation(request, { ...env, ...change }), 503);
  for (const context of ["production", "deploy-preview"]) rejects(() => requireLocalInventoryReconciliation(request, env, context), 503);
  for (const url of ["https://example.com/api/portal/sync-upload", "http://127.0.0.1:8888/api/other"])
    rejects(() => requireLocalInventoryReconciliation(new Request(url), env), 503);
});

test("the local gate requires an explicit allowlisted endpoint and never broadens the upload default", () => {
  const read = new Request("http://127.0.0.1:8888/api/portal/synced-skills?version=3");
  rejects(() => requireLocalInventoryReconciliation(read, env, "dev"), 503);
  requireLocalInventoryReconciliation(read, env, "dev", "/api/portal/synced-skills");
  rejects(() => requireLocalInventoryReconciliation(request, env, "dev", "/api/portal/synced-skills"), 503);
  rejects(() => requireLocalInventoryReconciliation(read, env, "dev", "/api/portal/profile" as never), 503);
  for (const key of Object.keys(env)) {
    rejects(() => requireLocalInventoryReconciliation(read, { ...env, [key]: undefined }, "dev", "/api/portal/synced-skills"), 503);
  }
  for (const context of ["production", "deploy-preview"]) {
    rejects(() => requireLocalInventoryReconciliation(read, env, context, "/api/portal/synced-skills"), 503);
  }
  for (const url of ["https://example.test/api/portal/synced-skills?version=3",
    "http://127.0.0.1:9999/api/portal/synced-skills?version=3",
    "http://127.0.0.1:8888/api/portal/shared?version=3"]) {
    rejects(() => requireLocalInventoryReconciliation(new Request(url), env, "dev", "/api/portal/synced-skills"), 503);
  }
});

const baseRevision = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const checkBody = { reportVersion: 3, mode: "check", baseRevision };
const credential = createDeviceCredential();
const context = {} as Context;
function checkRequest(body: unknown = checkBody, query = "", authorization: string | null = `Bearer ${credential}`) {
  return new Request(`http://127.0.0.1:8888/api/portal/sync-upload${query}`, {
    method: "POST", body: JSON.stringify(body), headers: {
      "Content-Type": "application/json", ...(authorization === null ? {} : { Authorization: authorization })
    }
  });
}
const noDatabase = () => { assert.fail("Rejected request must not access storage"); };

test("check parser accepts only its three exact fields and normalizes the non-null revision", () => {
  assert.deepEqual(parseInventoryCheck(checkBody), { baseRevision });
  assert.deepEqual(parseInventoryCheck({ ...checkBody, baseRevision: baseRevision.toUpperCase() }), { baseRevision });
  for (const body of [{}, { mode: "check", baseRevision }, { reportVersion: 3, baseRevision },
    { reportVersion: 3, mode: "check" }, { ...checkBody, reportVersion: "3" }, { ...checkBody, reportVersion: 2 },
    { ...checkBody, mode: "checked" }, { ...checkBody, mode: null },
    ...[null, "", "bad", 4, undefined].map(baseRevision => ({ ...checkBody, baseRevision })),
    ...["skills", "roots", "deviceId", "userId", "token", "checkedAt", "unexpected"]
      .map(key => ({ ...checkBody, [key]: "forbidden" }))]) {
    rejects(() => parseInventoryCheck(body), 400);
  }
});

test("check endpoint dispatches no skill payload, has no-store response and keeps existing upload path separate", async () => {
  const pool = {} as Pool;
  let calls = 0;
  const result = { reportVersion: 3 as const, mode: "checked" as const, deviceId: "test-mac",
    revision: baseRevision, checkedAt: "2026-10-16T12:00:00.000Z" };
  const response = await portalSyncUpload(checkRequest(), context, {
    requireSkillGroupsWebFeature() {}, getEnvironment: () => env, getPgPool: () => pool,
    performSyncUpload: noDatabase,
    async performInventoryCheck(actual, req, body) {
      calls++;
      assert.equal(actual, pool);
      assert.equal(req.headers.get("Authorization"), `Bearer ${credential}`);
      assert.deepEqual(body, checkBody);
      return result;
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), result);
  assert.equal(calls, 1);
});

test("check endpoint rejects query, invalid body and bearer before pool access", async () => {
  const deps = { requireSkillGroupsWebFeature() {}, getEnvironment: () => env, getPgPool: noDatabase,
    performSyncUpload: noDatabase, performInventoryCheck: noDatabase };
  for (const body of [{ ...checkBody, skills: [] }, { ...checkBody, roots },
    { ...checkBody, userId: "other" }, { ...checkBody, deviceId: "other" }, { ...checkBody, token: "legacy" },
    { ...checkBody, baseRevision: null }, { ...checkBody, mode: "unknown" }, { ...checkBody, mode: false }]) {
    assert.equal((await portalSyncUpload(checkRequest(body), context, deps)).status, 400);
  }
  for (const query of ["?mode=check", "?reportVersion=3", "?deviceId=other"]) {
    assert.equal((await portalSyncUpload(checkRequest(checkBody, query), context, deps)).status, 400);
  }
  for (const auth of [null, "Bearer bad", "Basic abc"]) {
    assert.equal((await portalSyncUpload(checkRequest(checkBody, "", auth), context, deps)).status, 401);
  }
  const malformed = new Request("http://127.0.0.1:8888/api/portal/sync-upload", {
    method: "POST", body: "{", headers: { "Content-Type": "application/json" }
  });
  assert.equal((await portalSyncUpload(malformed, context, deps)).status, 401);
  const authenticatedMalformed = new Request("http://127.0.0.1:8888/api/portal/sync-upload", {
    method: "POST", body: "{", headers: { Authorization: `Bearer ${credential}` }
  });
  assert.equal((await portalSyncUpload(authenticatedMalformed, context, deps)).status, 400);
});

test("check endpoint retains local deployment gate and existing feature/auth/error boundaries", async () => {
  const deps = { requireSkillGroupsWebFeature() {}, getEnvironment: () => env, getPgPool: noDatabase,
    performSyncUpload: noDatabase, performInventoryCheck: noDatabase };
  for (const key of Object.keys(env)) {
    assert.equal((await portalSyncUpload(checkRequest(), context, {
      ...deps, getEnvironment: () => ({ ...env, [key]: undefined })
    })).status, 503);
  }
  for (const deployContext of ["production", "deploy-preview"]) {
    assert.equal((await portalSyncUpload(checkRequest(), { deploy: { context: deployContext } } as Context, deps)).status, 503);
  }
  const hosted = new Request("https://example.test/api/portal/sync-upload", {
    method: "POST", body: JSON.stringify(checkBody), headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` }
  });
  assert.equal((await portalSyncUpload(hosted, context, deps)).status, 503);
  assert.equal((await portalSyncUpload(checkRequest(), context, {
    ...deps, requireSkillGroupsWebFeature() { throw new Response("Disabled", { status: 503 }); }
  })).status, 503);
  assert.equal((await portalSyncUpload(checkRequest(), context, { ...deps,
    getPgPool() { throw new Error("unavailable"); }
  })).status, 503);
  for (const [failure, status] of [[new DeviceAuthError(), 401], [new Response("Stale", { status: 409 }), 409],
    [new Error("private database details"), 500]] as const) {
    const response = await portalSyncUpload(checkRequest(), context, { ...deps, getPgPool: () => ({} as Pool),
      async performInventoryCheck() { throw failure; } });
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes("private database details"));
  }
});

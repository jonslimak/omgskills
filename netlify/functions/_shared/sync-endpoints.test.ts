import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { portalSyncUpload } from "../portal-sync-upload.mjs";
import { portalSyncedSkills } from "../portal-synced-skills.mjs";
import { createDeviceCredential } from "./crypto.js";
import { DeviceAuthError } from "./device-auth.js";

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
  assert.equal((await portalSyncUpload(request({ reportVersion: 2, skills: [] }, null), context, deps)).status, 400);
  assert.equal((await portalSyncUpload(request({ reportVersion: 2, skills: [] }, "Bearer bad"), context, deps)).status, 401);
  assert.equal((await portalSyncUpload(request({ reportVersion: 2, skills: [] }), context, {
    ...deps, getPgPool: () => pool, async performSyncUpload() { throw new DeviceAuthError(); }
  })).status, 401);
});

test("inventory endpoint authenticates before data access and uses only the authenticated owner", async () => {
  const user = { id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: null };
  let authenticated = false;
  const response = await portalSyncedSkills(new Request("https://example.test/api/portal/synced-skills?version=2&userId=other"), context, {
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
    requirePortalUser: async () => { throw new Response("Unauthorized", { status: 401 }); },
    getPgPool: noDatabase, readSyncInventory: noDatabase
  });
  assert.equal(unauthenticated.status, 401);
});

test("inventory endpoint refuses unknown or duplicate version before reading", async () => {
  for (const query of ["version=3", "version=2&version=1"]) {
    const response = await portalSyncedSkills(new Request(`https://example.test/api/portal/synced-skills?${query}`), context, {
      requirePortalUser: noDatabase, getPgPool: noDatabase, readSyncInventory: noDatabase
    });
    assert.equal(response.status, 400);
  }
});

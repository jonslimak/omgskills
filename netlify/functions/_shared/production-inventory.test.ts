import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { requireProductionInventory } from "./production-inventory.js";
import { portalSyncUpload } from "../portal-sync-upload.mjs";
import { portalSyncedSkills } from "../portal-synced-skills.mjs";
import { portalSyncPairingCode } from "../portal-sync-pairing-code.mjs";
import { createDeviceCredential, createPairingCode } from "./crypto.js";

const features = { skillGroupsWebEnabled: true, portalUnifiedEnabled: true,
  connectedInventoryReadEnabled: true, connectedInventorySyncEnabled: true };
const paused = { ...features, connectedInventorySyncEnabled: false };
const disabled = { ...paused, connectedInventoryReadEnabled: false };
const env = { CONTEXT: "production", CLERK_SECRET_KEY: "sk_live_fixture" };
const context = { site: { id: "dfdb618d-b748-4c4f-a535-646dc5db449f" }, deploy: { context: "production" } } as Context;
const pool = {} as Pool;
const user = { id: "owner", clerkUserId: "clerk-owner", email: "owner@example.test", displayName: null };
const noStorage = () => { throw new Error("Must not reach storage"); };
const request = (path: string, body?: unknown, token = createDeviceCredential()) => new Request(`https://omgskills.com${path}`, {
  method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body),
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
});
const guard = (operation: "read" | "sync", policy = features) => (req: Request) => requireProductionInventory(
  req, env, "production", context.site.id, operation, policy);

test("production policy is opt-in, site/account-environment bound, and reads survive paused sync", () => {
  const req = request("/api/portal/synced-skills?version=3");
  requireProductionInventory(req, env, "production", context.site.id, "read");
  requireProductionInventory(req, env, "production", context.site.id, "sync");
  assert.throws(() => guard("read", disabled)(req));
  assert.throws(() => guard("sync", disabled)(req));
  guard("read", paused)(req);
  assert.throws(() => guard("sync", paused)(req));
  guard("sync")(req);
  for (const change of [{ CONTEXT: "dev" }, { CLERK_SECRET_KEY: "sk_test_fixture" },
    { OMGSKILLS_CONNECTED_INVENTORY_TEST: "1" }, { OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "1" },
    { OMGSKILLS_CONNECTED_CANDIDATE: "1" }]) {
    assert.throws(() => requireProductionInventory(req, { ...env, ...change }, "production", context.site.id, "read", features));
  }
  for (const [origin, deploy, site] of [["https://omgskills-setup-test-f3b.netlify.app", "production", context.site.id],
    ["https://omgskills.com", "deploy-preview", context.site.id], ["https://omgskills.com", "production", "other-site"]] as const) {
    assert.throws(() => requireProductionInventory(new Request(origin), env, deploy, site, "read", features));
  }
});

test("production runtime without build-only CONTEXT reaches authentication, not storage", async () => {
  const runtimeEnv = { CLERK_SECRET_KEY: env.CLERK_SECRET_KEY };
  const unauthorized = async () => { throw new Response("Unauthorized", { status: 401 }); };
  const read = new Request("https://omgskills.com/api/portal/synced-skills?version=3");
  assert.equal((await portalSyncedSkills(read, context, {
    getEnvironment: () => runtimeEnv, getPgPool: noStorage, requirePortalUser: unauthorized,
  })).status, 401);
  const revision = new Request("https://omgskills.com/api/portal/sync-upload?reportVersion=3");
  assert.equal((await portalSyncUpload(revision, context, {
    getEnvironment: () => runtimeEnv, getPgPool: noStorage,
    requireSkillGroupsWebFeature() {}, performSyncUpload: noStorage,
  })).status, 401);
  const body = { state: "a".repeat(43), codeChallenge: "b".repeat(43), codeChallengeMethod: "S256",
    scopes: ["sync:write", "self:revoke"] };
  assert.equal((await portalSyncPairingCode(request("/api/portal/sync-pairing-code?inventory=3", body), context, {
    getEnvironment: () => runtimeEnv, getPgPool: noStorage,
    requirePortalUser: unauthorized, issuePairingCode: noStorage,
  })).status, 401);
  for (const deploy of ["deploy-preview", undefined]) {
    for (const operation of ["read", "sync"] as const) {
      assert.throws(() => requireProductionInventory(read, runtimeEnv, deploy, context.site.id, operation, features));
    }
  }
});

test("normal production endpoints retain disabled-policy and authenticated inventory/report contracts", async () => {
  const read = request("/api/portal/synced-skills?version=3");
  const report = { reportVersion: 3, baseRevision: null,
    roots: ["claude", "codex", "agents"].map(source => ({ source, state: "complete" })),
    skills: [{ name: "Installed skill", source: "codex", installationPath: "skill" }] };
  assert.equal((await portalSyncedSkills(read, context, { getEnvironment: () => env,
    requireReconciliation: guard("read", disabled),
    getPgPool: noStorage, requirePortalUser: noStorage })).status, 503);
  assert.equal((await portalSyncUpload(request("/api/portal/sync-upload", report), context, {
    requireReconciliation: guard("sync", disabled),
    getEnvironment: () => env, getPgPool: noStorage, requireSkillGroupsWebFeature() {}, performSyncUpload: noStorage })).status, 503);
  const retained = { inventoryVersion: 3 as const, skills: [{ id: "stable-row", deviceId: "same-mac", isCurrent: false }], devices: [] };
  const deps = { getPgPool: () => pool, requireReconciliation: guard("read", paused),
    requirePortalUser: async () => user,
    async readSyncInventory(actual: Pool, owner: string, version: number) {
      assert.equal(actual, pool); assert.equal(owner, user.id); assert.equal(version, 3); return retained;
    } };
  assert.deepEqual(await (await portalSyncedSkills(read, context, deps)).json(), retained);
  assert.equal((await portalSyncedSkills(read, context, { ...deps, getPgPool: noStorage,
    requirePortalUser: async () => { throw new Response("Unauthorized", { status: 401 }); } })).status, 401);
  const uploaded = await portalSyncUpload(request("/api/portal/sync-upload", report), context, {
    getPgPool: () => pool, requireSkillGroupsWebFeature() {}, requireReconciliation: guard("sync"),
    async performSyncUpload(actual, auth, skills, _now, version, reconciliation) {
      assert.equal(actual, pool); assert.equal(auth.kind, "device"); assert.equal(version, 3);
      assert.equal(skills[0].stableKey, "location:v1:codex:skill"); assert.equal(reconciliation?.baseRevision, null);
      return { syncRunId: "revision", syncedSkillCount: 1 };
    } });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.headers.get("cache-control"), "no-store");
});

test("new production browser pairing is gated and may grant Set downloads; legacy pairing stays unchanged", async () => {
  const body = { state: "a".repeat(43), codeChallenge: "b".repeat(43), codeChallengeMethod: "S256",
    scopes: ["sync:write", "self:revoke"] };
  const path = "/api/portal/sync-pairing-code?inventory=3";
  const deps = { getEnvironment: () => env, getPgPool: () => pool, requirePortalUser: async () => user,
    async issuePairingCode(_pool: Pool, owner: string, input: Parameters<typeof import("./device-pairing.js").issuePairingCode>[2]) {
      assert.equal(owner, user.id); assert.deepEqual(input?.grantedScopes, body.scopes);
      return { code: createPairingCode(), expiresAt: new Date(Date.now() + 60_000) };
    } };
  assert.equal((await portalSyncPairingCode(request(path, body), context, { ...deps,
    requireConnectedSync: guard("sync", disabled), getPgPool: noStorage })).status, 503);
  const approved = await portalSyncPairingCode(request(path, body), context, { ...deps, requireConnectedSync: guard("sync") });
  assert.equal(approved.status, 200);
  assert.match((await approved.json()).callbackUrl, /^omgskills:\/\/pair\?/);
  const withSets = { ...body, scopes: [...body.scopes, "content:read"] };
  assert.equal((await portalSyncPairingCode(request(path, withSets), context, { ...deps, requireConnectedSync: guard("sync"),
    async issuePairingCode(_pool: Pool, _owner: string, input: Parameters<typeof import("./device-pairing.js").issuePairingCode>[2]) {
      assert.deepEqual(input?.grantedScopes, withSets.scopes);
      return { code: createPairingCode(), expiresAt: new Date(Date.now() + 60_000) };
    } })).status, 200);
  const { state: _state, codeChallenge: _challenge, codeChallengeMethod: _method, ...withoutBrowser } = withSets;
  assert.equal((await portalSyncPairingCode(request(path, withoutBrowser), context,
    { ...deps, requireConnectedSync: guard("sync"), getPgPool: noStorage })).status, 400);
  assert.equal((await portalSyncPairingCode(request("/api/portal/sync-pairing-code", body), context, deps)).status, 200);
});

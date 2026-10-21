import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { createPairingCode, hashToken } from "./crypto.js";
import { DeviceAuthError } from "./device-auth.js";
import { DeviceReconnectError, hashReconnectKey, requireReconnectKey } from "./device-reconnect.js";
import { portalDeviceReconnectKey } from "../portal-device-reconnect-key.mjs";
import { portalSyncExchange } from "../portal-sync-exchange.mjs";

const key = "ab".repeat(32);
const context = {} as Context;
const pool = {} as Pool;
const noDatabase = () => { throw new Error("Unexpected database access"); };
const enabled = () => {};
function request(body: unknown, method = "POST") {
  return new Request("https://example.test/api/portal/test", {
    method, headers: { "Content-Type": "application/json", Origin: "https://untrusted.test" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {})
  });
}

test("keys have an exact non-trimmed format and a domain-separated hash", () => {
  assert.equal(requireReconnectKey(key), key);
  assert.equal(hashReconnectKey(key), hashToken(`device-reconnect:${key}`));
  assert.notEqual(hashReconnectKey(key), key);
  assert.notEqual(hashReconnectKey(key), hashToken(key));
  for (const invalid of [undefined, null, 64, [], {}, "", key.toUpperCase(), key + "\n", " " + key, key.slice(1), "g".repeat(64)]) {
    assert.throws(() => requireReconnectKey(invalid), DeviceReconnectError);
  }
});

test("binding rejects missing/invalid keys and every extra ownership field before DB access", async () => {
  for (const body of [{}, { reconnectKey: null }, { reconnectKey: key + "\n" },
    { reconnectKey: key, deviceId: "other" }, { reconnectKey: key, userId: "other" },
    { reconnectKey: key, unknown: true }, [], null]) {
    const response = await portalDeviceReconnectKey(request(body), context, {
      getPgPool: noDatabase, requireSkillGroupsWebFeature: enabled,
      bindDeviceReconnectKey: async () => { throw new Error("Unexpected binding"); }
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.ok(!(await response.text()).includes(key));
  }
});

test("binding is POST-only, gated, and returns no credential/key/hash", async () => {
  const dependencies = {
    getPgPool: () => pool, requireSkillGroupsWebFeature: enabled,
    bindDeviceReconnectKey: async (actualPool: Pool, req: Request, actualKey: unknown) => {
      assert.equal(actualPool, pool);
      assert.equal(req.method, "POST");
      assert.equal(actualKey, key);
      return { deviceId: "stable-id", reconnectSupported: true as const };
    }
  };
  const response = await portalDeviceReconnectKey(request({ reconnectKey: key }), context, dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { deviceId: "stable-id", reconnectSupported: true });
  assert.equal((await portalDeviceReconnectKey(request(null, "GET"), context, dependencies)).status, 405);
  assert.equal((await portalDeviceReconnectKey(request(null, "OPTIONS"), context, dependencies)).status, 204);
  const gated = await portalDeviceReconnectKey(request({ reconnectKey: key }), context, {
    ...dependencies, getPgPool: noDatabase,
    requireSkillGroupsWebFeature: () => { throw new Response("Unavailable", { status: 503 }); }
  });
  assert.equal(gated.status, 503);
});

test("binding maps auth/conflict failures and redacts unexpected errors", async () => {
  for (const [error, status] of [[new DeviceAuthError(), 401],
    [new DeviceReconnectError(409, "Already bound"), 409], [new Error(key), 500]] as const) {
    const response = await portalDeviceReconnectKey(request({ reconnectKey: key }), context, {
      getPgPool: () => pool, requireSkillGroupsWebFeature: enabled,
      bindDeviceReconnectKey: async () => { throw error; }
    });
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(key));
  }
});

test("exchange adds explicit support only for key-aware clients, preserving older shape", async () => {
  for (const keyed of [false, true]) {
    const body = { pairingCode: createPairingCode(), deviceName: "Test Mac", ...(keyed ? { reconnectKey: key } : {}) };
    const response = await portalSyncExchange(request(body), context, {
      getPgPool: () => pool, requireSkillGroupsWebFeature: enabled,
      exchangePairingCode: async (_pool, options) => {
        assert.deepEqual(options, { ...body, codeVerifier: null });
        return { credential: "new-credential", deviceId: "stable-id", expiresAt: new Date(0),
          accountLabel: "Synthetic", grantedScopes: ["sync:write", "self:revoke"],
          ...(keyed ? { reconnectSupported: true as const } : {}) };
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { credential: "new-credential", deviceId: "stable-id",
      expiresAt: new Date(0).toISOString(), accountLabel: "Synthetic", grantedScopes: ["sync:write", "self:revoke"],
      ...(keyed ? { reconnectSupported: true } : {}) });
  }
});

test("exchange rejects invalid optional keys before database access and never echoes them", async () => {
  for (const reconnectKey of [null, 1, key + "\n", key.toUpperCase()]) {
    const response = await portalSyncExchange(request({ pairingCode: createPairingCode(), deviceName: "Mac", reconnectKey }), context, {
      getPgPool: noDatabase, requireSkillGroupsWebFeature: enabled,
      exchangePairingCode: async () => { throw new Error("Unexpected exchange"); }
    });
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes(key));
  }
});

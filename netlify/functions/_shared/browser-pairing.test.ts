import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { portalSyncPairingCode } from "../portal-sync-pairing-code.mjs";
import { browserPairingCallbackTarget, browserPairingCallbackUrl, isBrowserPairingState } from "./browser-pairing.js";
import type { issuePairingCode } from "./device-pairing.js";

const state = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const pairingCode = `pair_${"a".repeat(43)}`;

test("browser pairing state requires 32 base64url bytes", () => {
  assert.equal(isBrowserPairingState(state), true);
  assert.equal(isBrowserPairingState(`${state}x`), false);
  assert.equal(isBrowserPairingState("not valid"), false);
});

test("browser pairing callback uses the fixed app target", () => {
  const callback = new URL(browserPairingCallbackUrl(pairingCode, state));
  assert.equal(callback.protocol, "omgskills:");
  assert.equal(callback.host, "pair");
  assert.equal(callback.searchParams.get("code"), pairingCode);
  assert.equal(callback.searchParams.get("state"), state);
});

test("browser pairing callback rejects malformed input", () => {
  assert.throws(() => browserPairingCallbackUrl("bad", state));
  assert.throws(() => browserPairingCallbackUrl(pairingCode, "bad"));
  assert.throws(() => browserPairingCallbackUrl(pairingCode, state, "https://evil.test" as never));
});

const localApi = "http://127.0.0.1:8888";
const localBrowser = "http://127.0.0.1:5201";
const testEnvironment = {
  OMGSKILLS_CONNECTED_INVENTORY_TEST: "1",
  CONTEXT: "dev",
  NODE_ENV: "development",
  PORTAL_TEST_ENVIRONMENT_VERIFIED: "1",
  PORTAL_TEST_API_ORIGIN: localApi
};
const challenge = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";
const approval = { state, codeChallenge: challenge, codeChallengeMethod: "S256" };
const context = {} as Context;

function request(body: unknown = approval, origin: string | null = localBrowser, api = localApi) {
  return new Request(`${api}/api/portal/sync-pairing-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }) },
    body: JSON.stringify(body)
  });
}

test("production callback remains the default regardless of local browser flags", () => {
  const req = request();
  for (const env of [
    {},
    { CONTEXT: "production" },
    { ...testEnvironment, OMGSKILLS_CONNECTED_INVENTORY_TEST: "0", CONTEXT: "production" },
    { VITE_NEWMAC_CONNECTED_INVENTORY_TEST: "1" }
  ]) {
    assert.equal(browserPairingCallbackTarget(req, env), "omgskills://pair");
  }
});

test("verified local mode selects only the fixed F1 callback and preserves state/code", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const api = `http://${host}:8888`;
    const env = { ...testEnvironment, PORTAL_TEST_API_ORIGIN: api };
    const target = browserPairingCallbackTarget(request(approval, `http://${host}:5201`, api), env, "dev");
    assert.equal(target, "omgskills-f1://pair");
    const callback = new URL(browserPairingCallbackUrl(pairingCode, state, target));
    assert.equal(callback.protocol, "omgskills-f1:");
    assert.equal(callback.host, "pair");
    assert.deepEqual([...callback.searchParams], [["code", pairingCode], ["state", state]]);
    assert.throws(() => browserPairingCallbackUrl("bad", state, target));
    assert.throws(() => browserPairingCallbackUrl(pairingCode, "bad", target));
  }
});

const invalidEnvironments: Record<string, Record<string, string | undefined>> = {
  "malformed flag": { ...testEnvironment, OMGSKILLS_CONNECTED_INVENTORY_TEST: "true" },
  "empty flag": { ...testEnvironment, OMGSKILLS_CONNECTED_INVENTORY_TEST: "" },
  "missing context": { ...testEnvironment, CONTEXT: undefined },
  "production context": { ...testEnvironment, CONTEXT: "production" },
  "preview context": { ...testEnvironment, CONTEXT: "deploy-preview" },
  "branch context": { ...testEnvironment, CONTEXT: "branch-deploy" },
  "production runtime": { ...testEnvironment, NODE_ENV: "production" },
  "missing verification": { ...testEnvironment, PORTAL_TEST_ENVIRONMENT_VERIFIED: undefined },
  "missing API origin": { ...testEnvironment, PORTAL_TEST_API_ORIGIN: undefined }
};

for (const origin of [
  "not a URL", "https://127.0.0.1:8888", "http://127.0.0.1",
  "http://0.0.0.0:8888", "http://192.168.1.10:8888", "https://omgskills.com",
  "http://127.0.0.1.evil.test:8888", "http://user:password@127.0.0.1:8888",
  `${localApi}/app`, `${localApi}?callback=evil`, `${localApi}#evil`, "null"
]) {
  invalidEnvironments[`invalid API origin ${origin}`] = { ...testEnvironment, PORTAL_TEST_API_ORIGIN: origin };
}

function dependencies(env: Record<string, string | undefined> = testEnvironment) {
  const calls: string[] = [];
  const issued: Parameters<typeof issuePairingCode>[2][] = [];
  const pool = {} as Pool;
  return {
    calls, issued,
    getEnvironment: () => env,
    getPgPool: () => { calls.push("pool"); return pool; },
    requirePortalUser: async () => {
      calls.push("auth");
      return { id: "owner", clerkUserId: "test-owner", email: "owner@example.test", displayName: "Owner" };
    },
    issuePairingCode: async (actualPool: Pool, userId: string, options: Parameters<typeof issuePairingCode>[2]) => {
      calls.push("issue");
      assert.equal(actualPool, pool);
      assert.equal(userId, "owner");
      issued.push(options);
      return { code: pairingCode, expiresAt: new Date("2026-10-16T12:10:00Z") };
    }
  };
}

for (const [label, env] of Object.entries(invalidEnvironments)) {
  test(`connected-test ${label} fails before auth or pairing-code issuance`, async () => {
    const deps = dependencies(env);
    const response = await portalSyncPairingCode(request(), context, deps);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Invalid connected inventory test configuration" });
    assert.deepEqual(deps.calls, []);
  });
}

test("connected-test requests must match the configured loopback backend", async () => {
  for (const api of ["https://omgskills.com", "http://192.168.1.10:8888", "http://localhost:8888", "http://127.0.0.1:9999"]) {
    const deps = dependencies();
    assert.equal((await portalSyncPairingCode(request(approval, localBrowser, api), context, deps)).status, 503);
    assert.deepEqual(deps.calls, []);
  }
  for (const origin of ["https://omgskills.com", "null", "http://127.0.0.1.evil.test:5201", "http://localhost:5201/app"]) {
    const deps = dependencies();
    assert.equal((await portalSyncPairingCode(request(approval, origin), context, deps)).status, 503);
    assert.deepEqual(deps.calls, []);
  }
});

test("optional Origin permits the loopback frontend on 5201 independently of backend port 8888", async () => {
  for (const origin of [null, localBrowser, "http://localhost:5201", "http://[::1]:5201", "http://127.0.0.1:5202"]) {
    const deps = dependencies();
    const req = request(approval, origin);
    assert.equal(req.headers.has("origin"), origin !== null);
    const response = await portalSyncPairingCode(req, context, deps);
    assert.equal(response.status, 200);
    assert.equal(new URL((await response.json()).callbackUrl).protocol, "omgskills-f1:");
    assert.deepEqual(deps.calls, ["auth", "pool", "issue"]);
  }
});

test("present Origin must be a bare loopback HTTP origin with an explicit port", async () => {
  for (const origin of [
    "", "null", "https://127.0.0.1:5201", "http://127.0.0.1", "http://0.0.0.0:5201",
    "http://192.168.1.10:5201", "http://127.0.0.1.evil.test:5201",
    "http://user:password@127.0.0.1:5201", `${localBrowser}/app`,
    `${localBrowser}?callback=evil`, `${localBrowser}#evil`, `${localBrowser} http://localhost:5201`
  ]) {
    const deps = dependencies();
    assert.equal((await portalSyncPairingCode(request(approval, origin), context, deps)).status, 503);
    assert.deepEqual(deps.calls, []);
  }
});

test("forwarded loopback headers cannot override a remote request URL", async () => {
  const req = request(approval, localBrowser, "https://omgskills.com");
  req.headers.set("Host", "127.0.0.1:8888");
  req.headers.set("X-Forwarded-Host", "127.0.0.1:8888");
  req.headers.set("X-Forwarded-Proto", "http");
  const deps = dependencies();
  assert.equal((await portalSyncPairingCode(req, context, deps)).status, 503);
  assert.deepEqual(deps.calls, []);
});

test("actual deployment context cannot be overridden by dev environment values", async () => {
  for (const deployContext of ["production", "deploy-preview", "branch-deploy"]) {
    const deps = dependencies();
    const deployed = { deploy: { context: deployContext } } as Context;
    assert.equal((await portalSyncPairingCode(request(), deployed, deps)).status, 503);
    assert.deepEqual(deps.calls, []);
  }
});

test("pairing endpoint returns the selected callback without changing PKCE/scopes or secret headers", async () => {
  for (const [env, target] of [[{}, "omgskills://pair"], [testEnvironment, "omgskills-f1://pair"]] as const) {
    const deps = dependencies(env);
    const response = await portalSyncPairingCode(request({ ...approval, scopes: ["sync:write", "self:revoke", "content:read"] }), context, deps);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.deepEqual(await response.json(), {
      callbackUrl: `${target}?code=${pairingCode}&state=${state}`,
      expiresAt: "2026-10-16T12:10:00.000Z"
    });
    assert.deepEqual(deps.calls, ["auth", "pool", "issue"]);
    assert.deepEqual(deps.issued, [{ codeChallenge: challenge, grantedScopes: ["sync:write", "self:revoke", "content:read"] }]);
  }
});

test("request body cannot choose any callback, even a fixed allowed scheme", async () => {
  for (const env of [{}, testEnvironment]) {
    for (const key of ["callbackUrl", "callback", "callbackScheme", "redirectUri"]) {
      for (const value of ["https://evil.test", "omgskills://pair", "omgskills-f1://pair"]) {
        const deps = dependencies(env);
        const response = await portalSyncPairingCode(request({ ...approval, [key]: value }), context, deps);
        assert.equal(response.status, 400);
        assert.deepEqual(deps.calls, []);
      }
    }
  }
});

test("both callback modes retain state and S256 validation before issuance", async () => {
  for (const env of [{}, testEnvironment]) {
    for (const body of [
      { ...approval, state: "bad" }, { ...approval, codeChallenge: "bad" },
      { ...approval, codeChallengeMethod: "plain" }, { state },
      { codeChallenge: challenge, codeChallengeMethod: "S256" },
      { ...approval, scopes: ["content:read"] }, { ...approval, scopes: ["sync:write", "self:revoke", "arbitrary"] }
    ]) {
      const deps = dependencies(env);
      assert.equal((await portalSyncPairingCode(request(body), context, deps)).status, 400);
      assert.deepEqual(deps.calls, []);
    }
  }
});

test("manual pairing remains code-only with base scopes in either valid mode", async () => {
  for (const env of [{}, testEnvironment]) {
    const deps = dependencies(env);
    const response = await portalSyncPairingCode(request({}), context, deps);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { pairingCode, expiresAt: "2026-10-16T12:10:00.000Z" });
    assert.deepEqual(deps.issued, [{ codeChallenge: null, grantedScopes: ["sync:write", "self:revoke"] }]);
  }
});

test("authentication rejection cannot issue a pairing code", async () => {
  const deps = dependencies();
  deps.requirePortalUser = async () => { throw new Response("Unauthorized", { status: 401 }); };
  assert.equal((await portalSyncPairingCode(request(), context, deps)).status, 401);
  assert.deepEqual(deps.calls, []);
});

test("preflight and unsupported methods never authenticate or issue codes", async () => {
  for (const [method, status] of [["OPTIONS", 204], ["GET", 405]] as const) {
    const deps = dependencies();
    assert.equal((await portalSyncPairingCode(new Request(`${localApi}/api/portal/sync-pairing-code`, { method }), context, deps)).status, status);
    assert.deepEqual(deps.calls, []);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { createConnectedCandidateApi, config } from "./connected-candidate-api.mjs";
import { candidateDatabase, connectedCandidateOrigin as origin, connectedCandidatePaths,
  connectedCandidateSiteId } from "../netlify/functions/_shared/connected-candidate.js";
import { codeChallengeForVerifier } from "../netlify/functions/_shared/crypto.js";
import { DeviceAuthError } from "../netlify/functions/_shared/device-auth.js";
import { PairingError } from "../netlify/functions/_shared/device-pairing.js";

const environment = {
  OMGSKILLS_CONNECTED_CANDIDATE: "1", OMGSKILLS_CONNECTED_CANDIDATE_PROFILE: "connected",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL: "postgresql://candidate_test:unit_only@candidate-db.invalid/candidate_test?sslmode=require",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST: "candidate-db.invalid",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME: "candidate_test",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER: "candidate_test",
  CLERK_SECRET_KEY: "sk_test_CC2AUnitFixtureNotARealKey",
};
const context = { site: { id: connectedCandidateSiteId }, deploy: { context: "production" } } as Context;
const bearer = "Bearer header.payload.signature";
const credential = `device_${"b".repeat(43)}`;
const pairingCode = `pair_${"a".repeat(43)}`;
const verifier = "v".repeat(43);
const revision = "ee703c1d-f17a-456c-a9bd-02457f27b314";
const pair = { state: "s".repeat(43), codeChallenge: codeChallengeForVerifier(verifier), codeChallengeMethod: "S256",
  scopes: ["sync:write", "self:revoke"] };
const exchange = { pairingCode, codeVerifier: verifier, deviceName: "Candidate unit Mac" };
const roots = ["claude", "codex", "agents"].map(source => ({ source, state: "complete" }));
const full = { reportVersion: 3, baseRevision: null, roots, skills: [{ source: "codex", installationPath: "unit-skill", name: "Unit skill" }] };
const check = { reportVersion: 3, mode: "check", baseRevision: revision };

function request(path: string, body?: unknown, authorization = bearer) {
  return new Request(origin + "/api/portal/" + path, { method: body === undefined ? "GET" : "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag")!, /noindex/);
  assert.equal([...response.headers.keys()].some(key => key.startsWith("access-control-")), false);
}

function fixture() {
  const calls: string[] = [];
  const owner = { id: "internal-owner", clerkUserId: "clerk-owner", email: "candidate@example.test", displayName: "Candidate User" };
  const pool = { async query(text: string, values?: unknown[]) {
    if (text.startsWith("SELECT current_database")) {
      calls.push("identity"); return { rows: [{ database: "candidate_test", username: "candidate_test" }] };
    }
    assert.match(text, /UPDATE users/); assert.equal(values?.[0], owner.clerkUserId);
    calls.push("user"); return { rows: [owner] };
  } } as unknown as Pool;
  const samePool = (actual: Pool, operation: string) => { assert.equal(actual, pool); calls.push(operation); };
  const device = (req: Request) => {
    if (req.headers.get("authorization") !== `Bearer ${credential}`) throw new DeviceAuthError();
  };
  const services: NonNullable<Parameters<typeof createConnectedCandidateApi>[0]>["services"] = {
    async issuePairingCode(actual, userId, options) {
      samePool(actual, "pair"); assert.equal(userId, owner.id);
      assert.equal(options.codeChallenge, pair.codeChallenge); assert.deepEqual(options.grantedScopes, pair.scopes);
      return { code: pairingCode, expiresAt: new Date("2026-10-19T12:10:00Z") };
    },
    async exchangePairingCode(actual, options) {
      samePool(actual, "exchange");
      if (options.codeVerifier !== verifier) throw new PairingError(401, "Pairing code is invalid or expired");
      assert.equal(options.pairingCode, pairingCode); assert.equal(options.deviceName, exchange.deviceName);
      return { credential, deviceId: "unit-mac", accountLabel: owner.email,
        expiresAt: new Date("2027-10-19T12:00:00Z"), grantedScopes: ["sync:write", "self:revoke"] };
    },
    async readInventoryRevision(actual, req) { samePool(actual, "revision"); device(req); return { reportVersion: 3, revision: null }; },
    async performSyncUpload(actual, auth, skills, now, version, reconciliation) {
      samePool(actual, "upload"); assert.equal(auth.kind, "device");
      assert.ok(auth.kind === "device"); device(auth.request);
      assert.equal(version, 3); assert.equal(skills[0].stableKey, "location:v1:codex:unit-skill");
      assert.deepEqual(reconciliation, { baseRevision: null, roots }); assert.ok(now instanceof Date);
      return { syncRunId: revision, revision, syncedSkillCount: 1, missingSkillCount: 0,
        reportVersion: 3, mode: "reconciled", deviceId: "unit-mac", completedAt: now!.toISOString(), roots: reconciliation!.roots, complete: true };
    },
    async performInventoryCheck(actual, req, body) {
      samePool(actual, "check"); device(req); assert.deepEqual(body, check);
      return { reportVersion: 3, mode: "checked", deviceId: "unit-mac", revision, checkedAt: "2026-10-19T12:00:00Z" };
    },
    async readSyncInventory(actual, userId, version) {
      samePool(actual, "read"); assert.equal(userId, owner.id); assert.equal(version, 3);
      return { inventoryVersion: 3, skills: [], devices: [] };
    },
    async revokePresentedDevice(actual, req) { samePool(actual, "revoke"); device(req); return "unit-mac"; },
  };
  const deps = {
    getEnvironment: () => environment,
    getPool: candidateDatabase(connection => {
      calls.push("pool"); assert.equal(connection, environment.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL); return pool;
    }),
    user: {
      async requireAuth(req: Request) {
        calls.push("auth"); assert.equal(req.headers.get("authorization"), bearer); return { clerkUserId: owner.clerkUserId };
      },
      async loadClerkUser(id: string, key: string) {
        calls.push("clerk"); assert.equal(id, owner.clerkUserId); assert.equal(key, environment.CLERK_SECRET_KEY);
        return { primaryEmailAddressId: "email", firstName: "Candidate", lastName: "User",
          emailAddresses: [{ id: "email", emailAddress: owner.email, verification: { status: "verified" } }] };
      },
    }, services,
  };
  return { calls, deps };
}

async function chain(factory = createConnectedCandidateApi) {
  const { calls, deps } = fixture();
  const api = factory(deps);
  const approval = await api(request("sync-pairing-code", pair), context);
  assert.equal(approval.status, 200); privateHeaders(approval);
  const callback = new URL((await approval.json()).callbackUrl);
  assert.equal(callback.protocol + "//" + callback.host, "omgskills://pair");
  assert.equal(callback.searchParams.get("code"), pairingCode);
  assert.equal(callback.searchParams.get("state"), pair.state); assert.equal(callback.hash, "");
  for (const req of [request("sync-exchange", exchange), request("sync-upload?reportVersion=3", undefined, `Bearer ${credential}`),
    request("sync-upload", full, `Bearer ${credential}`), request("sync-upload", check, `Bearer ${credential}`),
    request("synced-skills?version=3"), request("device-revoke", {}, `Bearer ${credential}`)]) {
    const response = await api(req, context); assert.equal(response.status, 200, await response.clone().text()); privateHeaders(response);
  }
  assert.deepEqual(calls, ["auth", "clerk", "pool", "identity", "user", "pair", "exchange", "revision", "upload", "check",
    "auth", "clerk", "user", "read", "revoke"]);
}

test("candidate dispatches pairing, exchange, revision, full/check upload, owner read and self-revoke through one private pool", async () => {
  await chain(); assert.deepEqual(config.path, [...connectedCandidatePaths]);
});

test("candidate rejects malformed contracts and wrong credentials before auth or pool access", async () => {
  const { calls, deps } = fixture(); const api = createConnectedCandidateApi(deps);
  const cases: [Request, number][] = [
    [request("devices"), 404], [request("synced-skills?version=2"), 400], [request("synced-skills?version=3&userId=other"), 400],
    [request("sync-upload?reportVersion=3&deviceId=other"), 400],
    [request("sync-pairing-code", { ...pair, scopes: [...pair.scopes, "content:read"] }), 400],
    [request("sync-pairing-code", { ...pair, scopes: ["sync:write", "sync:write"] }), 400],
    [request("sync-pairing-code", { ...pair, state: "bad" }), 400],
    [request("sync-pairing-code", { ...pair, codeChallengeMethod: "plain" }), 400],
    [request("sync-pairing-code", { ...pair, userId: "other" }), 400],
    [request("sync-exchange", { pairingCode, deviceName: "Mac" }), 400],
    [request("sync-exchange", { ...exchange, codeVerifier: "bad" }), 400],
    [request("sync-exchange", { ...exchange, deviceId: "other" }), 400],
    [request("sync-upload", { ...full, reportVersion: 2 }), 400], [request("sync-upload", { ...full, reportVersion: 1 }), 400],
    [request("sync-upload", { ...full, roots: [] }), 400], [request("sync-upload", { ...check, baseRevision: "bad" }), 400],
    [request("device-revoke", { deviceId: "other" }), 400], [request("sync-pairing-code", pair, `Bearer ${credential}`), 401],
    [request("sync-upload", full, bearer), 401], [request("synced-skills?version=3", undefined, ""), 401],
    [new Request(origin + "/api/portal/synced-skills?version=3", { headers: { Cookie: "__session=header.payload.signature" } }), 401],
    [new Request(origin + "/api/portal/sync-upload", { method: "DELETE" }), 405],
    [new Request(origin + "/api/portal/sync-upload", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } }), 400],
    [new Request(origin + "/api/portal/sync-upload", { method: "POST", body: JSON.stringify(full) }), 400],
    [new Request(origin + "/api/portal/synced-skills?version=3", { headers: { Origin: "https://omgskills.com" } }), 403],
  ];
  for (const [req, expected] of cases) {
    const response = await api(req, context); assert.equal(response.status, expected, req.url); privateHeaders(response);
  }
  assert.deepEqual(calls, []);
  const preflight = await api(new Request(origin + "/api/portal/synced-skills?version=3", {
    method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } }), context);
  assert.equal(preflight.status, 204); privateHeaders(preflight); assert.deepEqual(calls, []);
  assert.equal((await api(request("synced-skills?version=3"), { ...context, site: { id: "public" } } as Context)).status, 404);
  assert.equal((await createConnectedCandidateApi({ ...deps, getEnvironment: () => ({ ...environment, CLERK_SECRET_KEY: "sk_live_NotAllowed" }) })
    (request("synced-skills?version=3"), context)).status, 503);
  assert.deepEqual(calls, []);
});

test("candidate preserves shared auth failures without falling back to cookies or the managed pool", async () => {
  const { calls, deps } = fixture();
  const denied = createConnectedCandidateApi({ ...deps, user: { ...deps.user,
    requireAuth: async () => { throw new Response("Invalid Clerk session token", { status: 401 }); } } });
  const response = await denied(request("synced-skills?version=3"), context);
  assert.equal(response.status, 401); privateHeaders(response); assert.deepEqual(calls, []);
  const api = createConnectedCandidateApi(deps);
  assert.equal((await api(request("sync-exchange", { ...exchange, codeVerifier: "x".repeat(43) }), context)).status, 401);
  assert.equal((await api(request("sync-upload?reportVersion=3", undefined, `Bearer device_${"x".repeat(43)}`), context)).status, 401);
  assert.equal((await api(request("device-revoke", {}, `Bearer device_${"x".repeat(43)}`), context)).status, 401);
  const unavailable = createConnectedCandidateApi({ ...deps, getPool: async () => { throw Error("private DSN diagnostic"); } });
  const failure = await unavailable(request("sync-exchange", exchange), context);
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /DSN|diagnostic/); privateHeaders(failure);
});

test("bundled candidate never calls the ordinary managed/default database loaders", async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dir = await mkdtemp(join(root, ".cc2a-unit-"));
  try {
    const output = await build({ entryPoints: [join(root, "scripts/connected-candidate-api.mts")],
      bundle: true, platform: "node", format: "esm", packages: "external", write: false,
      plugins: [{ name: "forbid-managed-db", setup(plugin) {
        plugin.onResolve({ filter: /\/db\.js$/ }, args => args.importer.includes("/netlify/functions/")
          ? { path: args.path, namespace: "forbidden-db" } : undefined);
        plugin.onLoad({ filter: /.*/, namespace: "forbidden-db" }, () => ({ contents:
          ["getPgPool", "getSqlDatabase", "getDrizzleDatabase"].map(name =>
            `export function ${name}(){throw Error("MANAGED_LOADER_WAS_USED");}`).join("\n"), loader: "js" }));
      } }] });
    const entry = join(dir, "candidate.mjs"); await writeFile(entry, output.outputFiles[0].text);
    const candidate = await import(pathToFileURL(entry).href);
    await chain(candidate.createConnectedCandidateApi);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

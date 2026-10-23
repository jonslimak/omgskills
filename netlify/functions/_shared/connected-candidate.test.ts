import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { candidateDatabase, candidateRoute, connectedCandidateOrigin, connectedCandidatePaths,
  connectedCandidateSiteId, requireConnectedCandidate } from "./connected-candidate.js";

const env = {
  OMGSKILLS_CONNECTED_CANDIDATE: "1", OMGSKILLS_CONNECTED_CANDIDATE_PROFILE: "connected",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL: "postgresql://candidate_test:unit_only@candidate-db.invalid/candidate_test?sslmode=require",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST: "candidate-db.invalid",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME: "candidate_test",
  OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER: "candidate_test",
  CLERK_SECRET_KEY: "sk_test_CC2AUnitFixtureNotARealKey",
};
const context = { site: { id: connectedCandidateSiteId }, deploy: { context: "production" } } as Context;
const req = () => new Request(connectedCandidateOrigin + "/api/portal/sync-upload");
const status = (code: number) => (error: unknown) => error instanceof Response && error.status === code;

test("candidate requires the fixed site, published origin and complete explicit test configuration", () => {
  const config = requireConnectedCandidate(req(), context, env);
  assert.ok(Object.isFrozen(config));
  assert.equal(config.database, "candidate_test");
  for (const key of Object.keys(env)) {
    const value: Record<string, string | undefined> = { ...env }; delete value[key];
    assert.throws(() => requireConnectedCandidate(req(), context, value), status(503), key);
  }
  for (const origin of ["https://omgskills.com", "http://127.0.0.1:5203", "https://draft--omgskills-setup-test-f3b.netlify.app"]) {
    assert.throws(() => requireConnectedCandidate(new Request(origin + "/api/portal/sync-upload"), context, env), status(404));
  }
  assert.throws(() => requireConnectedCandidate(req(), { ...context, site: { id: "public-site" } } as Context, env), status(404));
  for (const value of ["dev", "deploy-preview", undefined]) {
    assert.throws(() => requireConnectedCandidate(req(), { ...context, deploy: { context: value } } as Context, env), status(503));
  }
});

test("candidate cannot enable F1 gates, a live Clerk key or implicit/redirected database routing", () => {
  for (const change of [
    { OMGSKILLS_CONNECTED_CANDIDATE: "true" }, { OMGSKILLS_CONNECTED_CANDIDATE_PROFILE: "other" },
    { CLERK_SECRET_KEY: "sk_live_NotAllowed" }, { OMGSKILLS_CONNECTED_INVENTORY_TEST: "1" },
    { OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "1" },
    { SKILLGROUPS_DATABASE_URL: env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL },
    { NETLIFY_DB_URL: env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL },
    { OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST: "another-db.invalid" },
    { OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME: "another_database" },
    { OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER: "another_user" },
  ]) assert.throws(() => requireConnectedCandidate(req(), context, { ...env, ...change }), status(503));
  for (const value of ["invalid", "postgresql://candidate_test@candidate-db.invalid/candidate_test?sslmode=require",
    env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL.replace("sslmode=require", "sslmode=disable"),
    env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL + "&host=another-db.invalid",
    env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL + "&sslmode=require",
    env.OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL + "#fragment"]) {
    assert.throws(() => requireConnectedCandidate(req(), context, { ...env, OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL: value }), status(503));
  }
});

test("route allowlist has exact queries, narrow methods and no cross-origin expansion", () => {
  const routes = [
    ["POST", "/api/portal/sync-pairing-code", "pair"], ["POST", "/api/portal/sync-exchange", "exchange"],
    ["POST", "/api/portal/sync-upload", "upload"], ["GET", "/api/portal/sync-upload?reportVersion=3", "revision"],
    ["GET", "/api/portal/synced-skills?version=3", "read"], ["POST", "/api/portal/device-revoke", "revoke"],
    ["POST", "/api/portal/device-reconnect-key", "reconnect-key"],
    ["GET", "/api/portal/devices", "devices"], ["GET", "/api/portal/profile", "profile"],
    ["GET", "/api/portal/groups", "groups"], ["GET", "/api/portal/shared", "shared"],
    ["GET", "/api/portal/groups/11111111-1111-4111-8111-111111111111", "group-detail"],
  ];
  for (const [method, path, route] of routes) {
    assert.equal(candidateRoute(new Request(connectedCandidateOrigin + path, { method })), route);
    assert.equal(candidateRoute(new Request(connectedCandidateOrigin + path, { method: "OPTIONS",
      headers: { Origin: connectedCandidateOrigin, "Access-Control-Request-Method": method } })), route);
  }
  assert.equal(connectedCandidatePaths.length, 11);
  for (const path of ["/api/portal/groups/:groupId", "/api/portal/groups/bad", "/api/portal/groups/11111111111141118111111111111111",
    "/api/portal/groups/11111111-1111-4111-8111-111111111111/items", "/api/portal/groups/%311111111-1111-4111-8111-111111111111",
    "/api/portal/devices/11111111-1111-4111-8111-111111111111", "/api/portal/sync-token", "/api/portal/private-sources"]) {
    assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + path)), status(404));
  }
  for (const path of ["/api/portal/synced-skills", "/api/portal/synced-skills?version=2",
    "/api/portal/synced-skills?%76ersion=3", "/api/portal/synced-skills?version=3&userId=other",
    "/api/portal/sync-upload?reportVersion=3&deviceId=other", "/api/portal/device-reconnect-key?deviceId=other"]) {
    assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + path)), status(400));
  }
  assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + "/api/portal/sync-upload", { method: "DELETE" })), status(405));
  assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + "/api/portal/sync-upload", {
    method: "POST", headers: { Origin: "https://omgskills.com" } })), status(403));
  for (const [, path] of routes.filter(([method, path]) => method === "GET" && !path.includes("?"))) {
    assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + path + "?userId=other")), status(400));
    for (const method of ["POST", "PATCH", "DELETE", "HEAD"]) {
      assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + path, { method })), status(405));
      assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + path, { method: "OPTIONS",
        headers: { "Access-Control-Request-Method": method } })), status(405));
    }
  }
  assert.throws(() => candidateRoute(new Request(connectedCandidateOrigin + "/api/portal/device-reconnect-key")), status(405));
});

test("explicit pool is verified once and never constructed from an unavailable profile", async () => {
  const config = requireConnectedCandidate(req(), context, env);
  let factories = 0, queries = 0;
  const pool = { async query(text: string) {
    queries++; assert.match(text, /^SELECT current_database/);
    return { rows: [{ database: config.database, username: config.user }] };
  } } as unknown as Pool;
  const load = candidateDatabase(connection => { factories++; assert.equal(connection, config.connectionString); return pool; });
  const first = load(config);
  assert.equal(first, load(config));
  assert.equal(await first, pool);
  assert.equal(await load(config), pool);
  assert.equal(factories, 1); assert.equal(queries, 1);
  await assert.rejects(load({ ...config, database: "different" }), status(503));
  assert.equal(factories, 1);
});

test("a VERIFIED flag cannot replace database identity checks; failures close the candidate pool", async () => {
  const config = requireConnectedCandidate(req(), context, { ...env, VERIFIED: "1" });
  for (const identity of [{ database: "production", username: config.user }, { database: config.database, username: "wrong" }]) {
    let ended = 0;
    const pool = { async query() { return { rows: [identity] }; }, async end() { ended++; } } as unknown as Pool;
    await assert.rejects(candidateDatabase(() => pool)(config), status(503));
    assert.equal(ended, 1);
  }
  let ended = 0;
  const pool = { async query() { throw Error("private connection diagnostic"); }, async end() { ended++; } } as unknown as Pool;
  try { await candidateDatabase(() => pool)(config); assert.fail("Expected unavailable database"); }
  catch (error) { assert.ok(status(503)(error)); assert.doesNotMatch(await (error as Response).text(), /private connection/); }
  assert.equal(ended, 1);
});

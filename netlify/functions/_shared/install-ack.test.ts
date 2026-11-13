import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { config as pollConfig, portalInstallAck } from "../portal-install-ack.mjs";
import { config as recordConfig } from "../portal-install-ack-record.mjs";
import { createDeviceCredential } from "./crypto.js";
import { INSTALL_ACK_LOOKBACK_MS, parseInstallAckBody, parseInstallAckQuery, parseInstallAckTarget } from "./install-ack.js";

const context = {} as Context;
const pool = {} as Pool;
const credential = createDeviceCredential();
const url = "https://example.test/api/portal/install-ack";
const noDatabase = (): never => { assert.fail("invalid request must not access the database"); };

function rejects400(run: () => unknown) {
  assert.throws(run, (error) => error instanceof Response && error.status === 400);
}

test("catalog IDs follow the Mac's check: non-empty, at most 500 bytes, no control or format characters", () => {
  assert.deepEqual(parseInstallAckTarget("anthropics/skills/pdf", "claude"), { catalogId: "anthropics/skills/pdf", agent: "claude" });
  assert.deepEqual(parseInstallAckTarget("é".repeat(250), "codex"), { catalogId: "é".repeat(250), agent: "codex" });
  for (const id of ["", "   ", "é".repeat(251), "a".repeat(501), "a\nb", "a\u0000b", "a​b", "a‮b", 7, null, undefined]) {
    rejects400(() => parseInstallAckTarget(id, "claude"));
  }
  for (const agent of ["Claude", "cursor", "", null, undefined, 1]) {
    rejects400(() => parseInstallAckTarget("anthropics/skills/pdf", agent));
  }
  assert.deepEqual(parseInstallAckBody({ catalogId: "x", agent: "codex", later: true }), { catalogId: "x", agent: "codex" });
});

test("the poll query needs one catalogId and agent, at most one since, and clamps since to the last 3 minutes", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const query = (search: string) => parseInstallAckQuery(new URL(`${url}?${search}`), now);
  const recent = query("catalogId=a%2Fb&agent=claude&since=2026-11-12T11:59:00.000Z");
  assert.deepEqual(recent, { catalogId: "a/b", agent: "claude", since: new Date("2026-11-12T11:59:00.000Z") });
  assert.equal(INSTALL_ACK_LOOKBACK_MS, 3 * 60 * 1000);
  assert.equal(query("catalogId=a&agent=codex&since=2026-11-12T11:50:00Z").since?.getTime(), now.getTime() - INSTALL_ACK_LOOKBACK_MS);
  assert.deepEqual(query("catalogId=a&agent=claude"), { catalogId: "a", agent: "claude", since: null });
  for (const search of ["agent=claude&since=2026-11-12T11:59:00Z", "catalogId=a&since=2026-11-12T11:59:00Z",
    "catalogId=a&agent=claude&since=2026-11-12T11:59:00Z&since=2026-11-12T11:59:30Z",
    "catalogId=a&agent=claude&since=soon", "catalogId=a&catalogId=b&agent=claude&since=2026-11-12T11:59:00Z",
    "catalogId=a&agent=claude&since=2026-11-12T11:59:00Z&extra=1", "catalogId=a&agent=gpt&since=2026-11-12T11:59:00Z"]) {
    rejects400(() => query(search));
  }
});

test("POST records a device ack and answers 204; bad bearer or body never reaches the database", async () => {
  let recorded: unknown = null;
  const deps = {
    getPgPool: () => pool, requireAuth: noDatabase, requireSkillGroupsWebFeature() {},
    async recordInstallAck(actualPool: Pool, _req: Request, target: unknown) { assert.equal(actualPool, pool); recorded = target; },
    readInstallAck: noDatabase
  };
  const post = (body: unknown, authorization: string | null = `Bearer ${credential}`, path = url) => portalInstallAck(new Request(path, {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }
  }), context, deps);

  const ok = await post({ catalogId: "anthropics/skills/pdf", agent: "codex" });
  assert.equal(ok.status, 204);
  assert.equal(await ok.text(), "");
  assert.deepEqual(recorded, { catalogId: "anthropics/skills/pdf", agent: "codex" });

  const failing = { ...deps, recordInstallAck: noDatabase, getPgPool: noDatabase };
  const send = (body: unknown, authorization: string | null = `Bearer ${credential}`, path = url) => portalInstallAck(new Request(path, {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }
  }), context, failing);
  assert.equal((await send({ catalogId: "a", agent: "claude" }, null)).status, 401);
  assert.equal((await send({ catalogId: "a", agent: "claude" }, "Bearer clerk-session-token")).status, 401);
  assert.equal((await send({ catalogId: "", agent: "claude" })).status, 400);
  assert.equal((await send({ catalogId: "a", agent: "other" })).status, 400);
  assert.equal((await send("[]")).status, 400);
  assert.equal((await send("{")).status, 400);
  assert.equal((await send({ catalogId: "a", agent: "claude" }, undefined, `${url}?catalogId=a`)).status, 400);
});

test("GET answers the signed-in person's ack state with no caching; bad queries skip auth and the database", async () => {
  let asked: { clerkUserId: string; query: unknown } | null = null;
  const deps = {
    getPgPool: () => pool, recordInstallAck: noDatabase, requireSkillGroupsWebFeature() {},
    async requireAuth() { return { clerkUserId: "user_clerk" }; },
    async readInstallAck(_pool: Pool, clerkUserId: string, query: unknown) { asked = { clerkUserId, query }; return true; }
  };
  const since = new Date(Date.now() - 1000).toISOString();
  const before = Date.now();
  const response = await portalInstallAck(new Request(`${url}?catalogId=a%2Fb&agent=claude&since=${since}`), context, deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as { acked: boolean; now: string };
  assert.equal(body.acked, true);
  assert.ok(Date.parse(body.now) >= before && Date.parse(body.now) <= Date.now());
  assert.deepEqual(asked, { clerkUserId: "user_clerk", query: { catalogId: "a/b", agent: "claude", since: new Date(since) } });

  // Without since, the call only gives the server's time: never acked, no database.
  const first = { ...deps, readInstallAck: noDatabase };
  const timeOnly = await portalInstallAck(new Request(`${url}?catalogId=a&agent=claude`), context, first);
  assert.equal(timeOnly.status, 200);
  const timeBody = await timeOnly.json() as { acked: boolean; now: string };
  assert.equal(timeBody.acked, false);
  assert.ok(Number.isFinite(Date.parse(timeBody.now)));

  const signedOut = { ...deps, readInstallAck: noDatabase,
    async requireAuth(): Promise<never> { throw new Response("Missing Clerk session token", { status: 401 }); } };
  assert.equal((await portalInstallAck(new Request(`${url}?catalogId=a&agent=claude&since=${since}`), context, signedOut)).status, 401);
  const noCall = { ...deps, requireAuth: noDatabase, readInstallAck: noDatabase };
  assert.equal((await portalInstallAck(new Request(`${url}?agent=claude&since=${since}`), context, noCall)).status, 400);
  assert.equal((await portalInstallAck(new Request(url, { method: "DELETE" }), context, noCall)).status, 405);
});

test("the Mac's POST has its own function and rate limit, apart from the pop-over's polls", () => {
  assert.equal(pollConfig.path, "/api/portal/install-ack");
  assert.equal(recordConfig.path, pollConfig.path);
  assert.deepEqual(pollConfig.method, ["GET", "OPTIONS"]);
  assert.equal(recordConfig.method, "POST");
  // 30 polls a minute per pop-over: room for several tabs behind one address.
  assert.ok(pollConfig.rateLimit.windowLimit / pollConfig.rateLimit.windowSize * 60 >= 8 * 30);
  assert.ok(recordConfig.rateLimit.windowLimit >= 30);
});

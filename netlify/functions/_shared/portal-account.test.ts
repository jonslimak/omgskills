import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { portalAccount, type PortalAccountDependencies } from "../portal-account.mjs";

const context = {} as Context;

function dependencies(calls: string[]): PortalAccountDependencies {
  const query = async (text: string) => {
    calls.push(text.trim().split(/\s+/).slice(0, 2).join(" "));
    return { rows: [{ count: 0 }], rowCount: 0 };
  };
  const client = { query, release() {} };
  return {
    pool: () => ({ query, connect: async () => client }) as unknown as Pool,
    requireUser: async () => ({ id: "user-1", clerkUserId: "clerk-1", email: "a@example.com", displayName: null }),
    store: () => null,
    deleteSignIn: async (id) => { calls.push(`sign-out ${id}`); }
  };
}

function request(method: string, body?: unknown) {
  return new Request("https://omgskills.com/api/portal/account", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test("the account is deleted only with a DELETE that says delete", async () => {
  const calls: string[] = [];
  assert.equal((await portalAccount(request("POST", { confirm: "delete" }), context, dependencies(calls))).status, 405);
  assert.equal((await portalAccount(request("DELETE"), context, dependencies(calls))).status, 400);
  assert.equal((await portalAccount(request("DELETE", { confirm: "yes" }), context, dependencies(calls))).status, 400);
  assert.equal(calls.length, 0);

  const response = await portalAccount(request("DELETE", { confirm: "delete" }), context, dependencies(calls));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { deleted: true, deletedSets: 0 });
  assert.ok(calls.includes("sign-out clerk-1"));
});

test("signed-out requests are refused", async () => {
  const deps = { ...dependencies([]), requireUser: async () => { throw new Response("Unauthorized", { status: 401 }); } };
  const response = await portalAccount(request("DELETE", { confirm: "delete" }), context, deps);
  assert.equal(response.status, 401);
});

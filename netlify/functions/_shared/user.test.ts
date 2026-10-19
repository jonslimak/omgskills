import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { reconcilePortalUser, requirePortalUser, type PortalUser, type PortalUserClient } from "./user.js";

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: "UPDATE",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function portalUser(overrides: Partial<PortalUser> = {}): PortalUser {
  return {
    id: "internal-user-id",
    clerkUserId: "clerk-user-id",
    email: "person@example.com",
    displayName: "Person",
    ...overrides
  };
}

test("updates an existing Clerk identity without changing the internal user", async () => {
  const calls: Array<{ text: string; values?: any[] }> = [];
  const expected = portalUser();
  const client: PortalUserClient = {
    async query<T extends QueryResultRow>(text: string, values?: any[]) {
      calls.push({ text, values });
      return queryResult([expected]) as unknown as QueryResult<T>;
    }
  };

  const result = await reconcilePortalUser(client, {
    clerkUserId: expected.clerkUserId,
    email: expected.email,
    displayName: expected.displayName ?? "Person"
  });

  assert.equal(result.id, expected.id);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /WHERE clerk_user_id = \$1/);
});

test("reconnects a verified email to a new Clerk identity", async () => {
  const calls: Array<{ text: string; values?: any[] }> = [];
  const migrated = portalUser({ clerkUserId: "new-clerk-user-id" });
  const client: PortalUserClient = {
    async query<T extends QueryResultRow>(text: string, values?: any[]) {
      calls.push({ text, values });
      return queryResult(calls.length === 1 ? [] : [migrated]) as unknown as QueryResult<T>;
    }
  };

  const result = await reconcilePortalUser(client, {
    clerkUserId: migrated.clerkUserId,
    email: migrated.email,
    displayName: migrated.displayName ?? "Person"
  });

  assert.equal(result.id, "internal-user-id");
  assert.equal(result.clerkUserId, "new-clerk-user-id");
  assert.equal(calls.length, 2);
  assert.match(calls[1].text, /ON CONFLICT \(email\)/);
  assert.deepEqual(calls[1].values, ["new-clerk-user-id", "person@example.com", "Person"]);
});

test("account resolution authenticates and verifies email before using an injected async database", async () => {
  const calls: string[] = [];
  const expected = portalUser();
  const deps = {
    requireSkillGroupsWebFeature() { calls.push("gate"); },
    async requireAuth() { calls.push("auth"); return { clerkUserId: expected.clerkUserId }; },
    getEnv() { return "sk_test_UnitOnly"; },
    async loadClerkUser(id: string, key: string) {
      calls.push("identity"); assert.equal(id, expected.clerkUserId); assert.equal(key, "sk_test_UnitOnly");
      return { primaryEmailAddressId: "email", firstName: "Person", lastName: null,
        emailAddresses: [{ id: "email", emailAddress: " PERSON@EXAMPLE.COM ", verification: { status: "verified" } }] };
    },
    async getPgPool(): Promise<PortalUserClient> {
      calls.push("pool");
      return { async query<T extends QueryResultRow>(_text: string, values?: any[]) {
        calls.push("reconcile"); assert.deepEqual(values, [expected.clerkUserId, expected.email, "Person"]);
        return queryResult([expected]) as unknown as QueryResult<T>;
      } };
    }
  };
  const req = new Request("https://example.test");
  assert.equal((await requirePortalUser(req, deps)).id, expected.id);
  assert.deepEqual(calls, ["gate", "auth", "identity", "pool", "reconcile"]);
  const noPool = () => { assert.fail("unauthenticated/unverified identities must not access storage"); };
  await assert.rejects(requirePortalUser(req, { ...deps, getPgPool: noPool,
    requireAuth: async () => { throw new Response("Unauthorized", { status: 401 }); } }),
    error => error instanceof Response && error.status === 401);
  await assert.rejects(requirePortalUser(req, { ...deps, getPgPool: noPool,
    loadClerkUser: async () => ({ primaryEmailAddressId: "email", firstName: null, lastName: null,
      emailAddresses: [{ id: "email", emailAddress: expected.email, verification: { status: "unverified" } }] }) }),
    error => error instanceof Response && error.status === 400);
});

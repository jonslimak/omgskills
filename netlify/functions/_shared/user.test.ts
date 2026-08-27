import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { reconcilePortalUser, type PortalUser, type PortalUserClient } from "./user.js";

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

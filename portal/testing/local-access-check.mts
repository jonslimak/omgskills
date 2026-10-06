import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { connectionString, verifyDatabase } from "./local-environment.mjs";
import { requireGroupAccess } from "../../netlify/functions/_shared/group-access.js";
import { portalGroupDetail } from "../../netlify/functions/portal-group-detail.mjs";
import { portalGroupAllowedEmails } from "../../netlify/functions/portal-group-allowed-emails.mjs";
import type { Pool } from "pg";
import type { Context } from "@netlify/functions";

const client = new pg.Client({ connectionString: connectionString() });
await client.connect();
try {
  await verifyDatabase(client);
  const owner = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const outsider = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const member = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const group = randomUUID();
  await client.query("BEGIN");
  for (const actor of [owner, outsider, member]) {
    await client.query("INSERT INTO users (id,clerk_user_id,email) VALUES ($1,$2,$3)", [actor.id, `isolated-test-${actor.id}`, actor.email]);
  }
  await client.query("INSERT INTO skill_groups (id,owner_user_id,name,slug,visibility) VALUES ($1,$2,'Local test','local-test','private')", [group, owner.id]);
  assert.equal((await requireGroupAccess(owner, group, "read", client)).accessRole, "owner");
  const denied = (error: unknown) => error instanceof Response && error.status === 404;
  await assert.rejects(requireGroupAccess(outsider, group, "read", client), denied);
  await assert.rejects(requireGroupAccess(null, group, "read", client), denied);
  const deps = (actor: typeof owner) => ({ getPgPool: () => client as unknown as Pool, requireGroupAccess,
    requirePortalUser: async () => ({ ...actor, clerkUserId: `isolated-test-${actor.id}`, displayName: "Local test" }) });
  const request = (method: string, suffix: string, body?: unknown) => new Request(`http://127.0.0.1:8890/api/portal/groups/${group}${suffix}`, {
    method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const context = {} as Context;
  const visibility = async (value: string) => {
    const response = await portalGroupDetail(request("PATCH", "", { visibility: value }), context, deps(owner));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).visibility, value);
  };
  await visibility("restricted");
  assert.equal((await portalGroupAllowedEmails(request("POST", "/allowed-emails", { email: member.email }), context, deps(owner))).status, 201);
  assert.equal((await requireGroupAccess(member, group, "read", client)).accessRole, "invited");
  await assert.rejects(requireGroupAccess(member, group, "manage", client), denied);
  await assert.rejects(requireGroupAccess(outsider, group, "read", client), denied);
  for (const actor of [member, outsider]) {
    assert.equal((await portalGroupDetail(request("PATCH", "", { visibility: "public" }), context, deps(actor))).status, 404);
    assert.equal((await portalGroupAllowedEmails(request("POST", "/allowed-emails", { email: outsider.email }), context, deps(actor))).status, 404);
  }
  const read = await portalGroupDetail(request("GET", ""), context, deps(owner));
  const emailId = (await read.json()).group.allowedEmails[0].id;
  const memberRead = await portalGroupDetail(request("GET", ""), context, deps(member));
  assert.deepEqual((await memberRead.json()).group.allowedEmails, []);
  await visibility("public");
  assert.equal((await requireGroupAccess(null, group, "read", client)).accessRole, "public");
  await visibility("private");
  await assert.rejects(requireGroupAccess(member, group, "read", client), denied);
  await visibility("restricted");
  assert.equal((await portalGroupAllowedEmails(request("DELETE", "/allowed-emails", { emailId }), context, deps(owner))).status, 200);
  await assert.rejects(requireGroupAccess(member, group, "read", client), denied);
  await client.query("ROLLBACK");
  assert.equal((await client.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [[owner.id, outsider.id, member.id]])).rowCount, 0);
  console.log("Isolated handler/SQL check passed: visibility persisted, invited read-only access granted/revoked, non-owner edits denied, email records redacted, private/public rules enforced. All test records rolled back. Clerk sign-in not tested.");
} finally {
  await client.query("ROLLBACK");
  await client.end();
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { connectionString, verifyDatabase } from "./local-environment.mjs";
import { requireGroupAccess } from "../../netlify/functions/_shared/group-access.js";

const client = new pg.Client({ connectionString: connectionString() });
await client.connect();
try {
  await verifyDatabase(client);
  const owner = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const outsider = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const group = randomUUID();
  await client.query("BEGIN");
  for (const actor of [owner, outsider]) {
    await client.query("INSERT INTO users (id,clerk_user_id,email) VALUES ($1,$2,$3)", [actor.id, `isolated-test-${actor.id}`, actor.email]);
  }
  await client.query("INSERT INTO skill_groups (id,owner_user_id,name,slug,visibility) VALUES ($1,$2,'Local test','local-test','private')", [group, owner.id]);
  assert.equal((await requireGroupAccess(owner, group, "read", client)).accessRole, "owner");
  const denied = (error: unknown) => error instanceof Response && error.status === 404;
  await assert.rejects(requireGroupAccess(outsider, group, "read", client), denied);
  await assert.rejects(requireGroupAccess(null, group, "read", client), denied);
  await client.query("ROLLBACK");
  assert.equal((await client.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [[owner.id, outsider.id]])).rowCount, 0);
  console.log("Isolated SQL check passed: owner allowed; other account and anonymous denied; all test records rolled back. Clerk sign-in not tested.");
} finally {
  await client.query("ROLLBACK");
  await client.end();
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPgPool } from "../../netlify/functions/_shared/db.js";
import { requireGroupAccess } from "../../netlify/functions/_shared/group-access.js";

// Explicit Unix-socket test target only. Never inherit Netlify-managed DB routing.
const directory = process.env.PORTAL_TEST_DATABASE_DIRECTORY;
const url = new URL(process.env.SKILLGROUPS_DATABASE_URL || "");
assert.equal(process.env.CONTEXT, "dev");
assert.equal(url.hostname, "");
assert.equal(url.pathname, "/omgskills_portal_b1");
assert.equal(url.searchParams.get("port"), "55432");
assert.ok(directory?.startsWith("/private/tmp/omgskills-portal-b1.") && directory.endsWith("/data"));
assert.equal(url.searchParams.get("host"), directory.slice(0, -5));
const pool = getPgPool();
const owner = { id: randomUUID(), email: `d4-owner-${randomUUID()}@example.test` };
const invited = { id: randomUUID(), email: `d4-reader-${randomUUID()}@example.test` };
const outsider = { id: randomUUID(), email: `d4-outsider-${randomUUID()}@example.test` };
const groupId = randomUUID();
const client = await pool.connect();
try {
  const db = (await client.query("SELECT current_database() AS name, current_setting('data_directory') AS directory")).rows[0];
  assert.equal(db.name, "omgskills_portal_b1"); assert.equal(db.directory, directory);
  await client.query("BEGIN");
  for (const actor of [owner, invited, outsider]) {
    await client.query("INSERT INTO users (id, clerk_user_id, email) VALUES ($1,$2,$3)", [actor.id, `d4-fixture-${actor.id}`, actor.email]);
  }
  await client.query("INSERT INTO skill_groups (id,owner_user_id,name,slug,visibility) VALUES ($1,$2,$3,$4,'restricted')",
    [groupId, owner.id, "D4 transactional access fixture", "d4-fixture"]);
  await client.query("INSERT INTO skill_group_allowed_emails (group_id,email) VALUES ($1,$2)", [groupId, invited.email]);
  const denied = (actor: typeof owner | null, capability: "read" | "manage" = "read", id = groupId) =>
    assert.rejects(requireGroupAccess(actor, id, capability, client), asyncError);
  function asyncError(error: unknown) { return error instanceof Response && error.status === 404; }
  assert.equal((await requireGroupAccess(owner, groupId, "manage", client)).accessRole, "owner");
  assert.equal((await requireGroupAccess(invited, groupId, "read", client)).accessRole, "invited");
  await denied(invited, "manage"); await denied(outsider); await denied(null); await denied(outsider, "read", randomUUID());
  await client.query("DELETE FROM skill_group_allowed_emails WHERE group_id=$1 AND email=$2", [groupId, invited.email]);
  await denied(invited);
  await client.query("UPDATE skill_groups SET visibility='public' WHERE id=$1", [groupId]);
  for (const actor of [invited, outsider, null]) assert.equal((await requireGroupAccess(actor, groupId, "read", client)).accessRole, "public");
  await denied(outsider, "manage");
  await client.query("UPDATE skill_groups SET disabled_at=now() WHERE id=$1", [groupId]);
  for (const actor of [invited, outsider, null]) await denied(actor);
  assert.equal((await requireGroupAccess(owner, groupId, "read", client)).accessRole, "owner");
  await client.query("UPDATE skill_groups SET disabled_at=NULL, visibility='private' WHERE id=$1", [groupId]);
  await client.query("INSERT INTO skill_group_allowed_emails (group_id,email) VALUES ($1,$2)", [groupId, invited.email]);
  await denied(invited); await denied(outsider); await denied(null);
  await client.query("ROLLBACK");
  assert.equal((await client.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [[owner.id, invited.id, outsider.id]])).rowCount, 0);
  assert.equal((await client.query("SELECT id FROM skill_groups WHERE id=$1", [groupId])).rowCount, 0);
  console.log("D4 isolated SQL access passed: owner/invited/outsider/anonymous; restricted/public/private/hidden; access removal; all fixture writes rolled back. Clerk sign-in was not exercised.");
} finally {
  await client.query("ROLLBACK"); client.release(); await pool.end();
}

import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import pg from "pg";
import { reconcileSyncedGroupReferences } from "../netlify/functions/_shared/sync-group-reconciliation.js";

const { values } = parseArgs({ options: {
  "clerk-user-id": { type: "string" },
  "group-id": { type: "string" },
  // Each expected repair is item UUID:old synced UUID:new synced UUID from the dry run.
  repair: { type: "string", multiple: true },
  apply: { type: "boolean", default: false },
} });
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
if (!values["clerk-user-id"] || !uuid.test(values["group-id"] ?? "")) {
  throw new Error("Provide --clerk-user-id and --group-id; default is read-only dry run");
}
const expected = (values.repair ?? []).map((value) => {
  const parts = value.split(":");
  if (parts.length !== 3 || !parts.every((part) => uuid.test(part))) throw new Error("Invalid --repair tuple");
  return value;
}).sort();
if (values.apply && !expected.length) throw new Error("--apply requires exact --repair tuples from the dry run");
if (!process.env.REPAIR_DATABASE_URL) throw new Error("REPAIR_DATABASE_URL is required (no database fallback)");

const client = new pg.Client({ connectionString: process.env.REPAIR_DATABASE_URL,
  connectionTimeoutMillis: 15000, statement_timeout: 15000 });
try {
  await client.connect();
  await client.query(values.apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL lock_timeout = '5s'");
  const owner = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE clerk_user_id = $1 ${values.apply ? "FOR UPDATE" : ""}`,
    [values["clerk-user-id"]],
  );
  if (owner.rowCount !== 1) throw new Error("Expected exactly one owner");
  const userId = owner.rows[0].id;
  const group = await client.query(
    `SELECT * FROM skill_groups WHERE id = $1 AND owner_user_id = $2 ${values.apply ? "FOR UPDATE" : ""}`,
    [values["group-id"], userId],
  );
  if (group.rowCount !== 1) throw new Error("Group does not belong to the expected owner");
  const options = { groupId: values["group-id"], dryRun: true };
  const repairs = await reconcileSyncedGroupReferences(client, userId, options);
  const tuples = repairs.map((r) => `${r.id}:${r.syncedSkillId}:${r.replacementId}`).sort();
  if (values.apply) {
    assert.deepEqual(tuples, expected, "Repair plan changed; run a new dry run");
    const before = await client.query("SELECT * FROM skill_group_items WHERE group_id = $1 ORDER BY id", [options.groupId]);
    const applied = await reconcileSyncedGroupReferences(client, userId, { ...options, dryRun: false });
    assert.deepEqual(applied, repairs);
    const after = await client.query("SELECT * FROM skill_group_items WHERE group_id = $1 ORDER BY id", [options.groupId]);
    assert.deepEqual(after.rows, before.rows.map((item) => ({ ...item,
      synced_skill_id: repairs.find((r) => r.id === item.id)?.replacementId ?? item.synced_skill_id,
    })), "Only the approved references may change; snapshots and pins must be identical");
    const updatedGroup = (await client.query("SELECT * FROM skill_groups WHERE id = $1", [options.groupId])).rows[0];
    assert.deepEqual(updatedGroup, { ...group.rows[0], revision: group.rows[0].revision + 1, updated_at: updatedGroup.updated_at });
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ applied: values.apply, groupId: options.groupId, repairs: tuples }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  // Do not print connection strings, SQL parameter data, or account details.
  console.error(error instanceof assert.AssertionError ? error.message.split("\n")[0] : "Repair failed; transaction rolled back");
  process.exitCode = 1;
} finally {
  await client.end();
}

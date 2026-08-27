import type { PoolClient } from "pg";
import { getPgPool } from "./db.js";
import { validateCompleteItemOrder } from "./group-behavior.js";
import { incrementGroupRevision, lockGroupForMutation } from "./group-storage.js";

type GroupItemInput = {
  kind: "synced" | "catalog" | "github";
  syncedSkillId?: string | null;
  catalogSkillId?: string | null;
  githubUrl?: string | null;
  name?: string | null;
  description?: string | null;
  note?: string | null;
};

export async function addGroupItemWithClient(
  client: PoolClient,
  groupId: string,
  item: GroupItemInput
) {
  await lockGroupForMutation(client, groupId);
  let snapshotName = item.name ?? null;
  let snapshotDescription = item.description ?? null;

  if (item.syncedSkillId) {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM skill_group_items WHERE group_id = $1 AND synced_skill_id = $2 LIMIT 1",
      [groupId, item.syncedSkillId]
    );
    if (existing.rowCount) {
      throw new Response("Skill is already in this group", { status: 409 });
    }
    const syncedSkill = await client.query<{ name: string; description: string | null }>(
      "SELECT name, description FROM synced_skills WHERE id = $1 LIMIT 1",
      [item.syncedSkillId]
    );
    snapshotName = snapshotName ?? syncedSkill.rows[0]?.name ?? null;
    snapshotDescription = snapshotDescription ?? syncedSkill.rows[0]?.description ?? null;
  }

  const positionResult = await client.query<{ next_position: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0)::int AS next_position FROM skill_group_items WHERE group_id = $1",
    [groupId]
  );
  const position = positionResult.rows[0]?.next_position ?? 0;
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO skill_group_items (group_id, kind, synced_skill_id, catalog_skill_id, github_url, name, description, note, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      groupId,
      item.kind,
      item.syncedSkillId ?? null,
      item.catalogSkillId ?? null,
      item.githubUrl ?? null,
      snapshotName,
      snapshotDescription,
      item.note ?? null,
      position
    ]
  );
  await incrementGroupRevision(client, groupId);

  return { itemId: result.rows[0].id, position };
}

export async function addGroupItem(groupId: string, item: GroupItemInput) {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const result = await addGroupItemWithClient(client, groupId, item);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteGroupItemWithClient(
  client: PoolClient,
  groupId: string,
  itemId: string
) {
  await lockGroupForMutation(client, groupId);
  const deleted = await client.query<{ id: string }>(
    "DELETE FROM skill_group_items WHERE group_id = $1 AND id = $2 RETURNING id",
    [groupId, itemId]
  );
  if (!deleted.rowCount) {
    return false;
  }

  await client.query(
    `
      WITH ordered AS (
        SELECT
          id,
          (row_number() OVER (ORDER BY position ASC, created_at ASC, id ASC) - 1)::int AS position
        FROM skill_group_items
        WHERE group_id = $1
      )
      UPDATE skill_group_items item
      SET position = ordered.position
      FROM ordered
      WHERE item.id = ordered.id
    `,
    [groupId]
  );
  await incrementGroupRevision(client, groupId);
  return true;
}

export async function reorderGroupItemsWithClient(
  client: PoolClient,
  groupId: string,
  requestedItemIds: unknown
) {
  await lockGroupForMutation(client, groupId);
  const current = await client.query<{ id: string }>(
    `
      SELECT id
      FROM skill_group_items
      WHERE group_id = $1
      ORDER BY position ASC, created_at ASC, id ASC
      FOR UPDATE
    `,
    [groupId]
  );
  const itemIds = validateCompleteItemOrder(
    current.rows.map((row) => row.id),
    requestedItemIds
  );
  const changed = itemIds.some((itemId, index) => itemId !== current.rows[index].id);
  if (!changed) {
    return { itemIds, changed: false };
  }

  await client.query(
    `
      UPDATE skill_group_items item
      SET position = requested.position
      FROM (
        SELECT id, (ordinality - 1)::int AS position
        FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, ordinality)
      ) AS requested
      WHERE item.group_id = $1 AND item.id = requested.id
    `,
    [groupId, itemIds]
  );
  await incrementGroupRevision(client, groupId);
  return { itemIds, changed: true };
}

export async function recordAnalytics(eventName: string, fields: {
  groupId?: string | null;
  profileUserId?: string | null;
  skillItemId?: string | null;
}) {
  await getPgPool().query(
    `
      INSERT INTO analytics_events (event_name, group_id, profile_user_id, skill_item_id)
      VALUES ($1, $2, $3, $4)
    `,
    [eventName, fields.groupId ?? null, fields.profileUserId ?? null, fields.skillItemId ?? null]
  );
}

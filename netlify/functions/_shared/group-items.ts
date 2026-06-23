import { getPgPool } from "./db.js";

type GroupItemInput = {
  kind: "catalog" | "github";
  catalogSkillId?: string | null;
  githubUrl?: string | null;
  note?: string | null;
};

export async function requireOwnedGroup(userId: string, groupId: string) {
  const result = await getPgPool().query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM skill_groups WHERE id = $1 AND owner_user_id = $2",
    [groupId, userId]
  );
  const group = result.rows[0];
  if (!group) {
    throw new Response("Group not found", { status: 404 });
  }
  return group;
}

export async function addGroupItem(groupId: string, item: GroupItemInput) {
  const pool = getPgPool();
  const positionResult = await pool.query<{ next_position: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0)::int AS next_position FROM skill_group_items WHERE group_id = $1",
    [groupId]
  );
  const position = positionResult.rows[0]?.next_position ?? 0;
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO skill_group_items (group_id, kind, catalog_skill_id, github_url, note, position)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [groupId, item.kind, item.catalogSkillId ?? null, item.githubUrl ?? null, item.note ?? null, position]
  );

  return { itemId: result.rows[0].id, position };
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

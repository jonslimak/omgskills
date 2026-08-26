import { getPgPool } from "./db.js";

type GroupItemInput = {
  kind: "synced" | "catalog" | "github";
  syncedSkillId?: string | null;
  catalogSkillId?: string | null;
  githubUrl?: string | null;
  name?: string | null;
  description?: string | null;
  note?: string | null;
};

export async function addGroupItem(groupId: string, item: GroupItemInput) {
  const pool = getPgPool();
  let snapshotName = item.name ?? null;
  let snapshotDescription = item.description ?? null;

  if (item.syncedSkillId) {
    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM skill_group_items WHERE group_id = $1 AND synced_skill_id = $2 LIMIT 1",
      [groupId, item.syncedSkillId]
    );
    if (existing.rowCount) {
      throw new Response("Skill is already in this group", { status: 409 });
    }
    const syncedSkill = await pool.query<{ name: string; description: string | null }>(
      "SELECT name, description FROM synced_skills WHERE id = $1 LIMIT 1",
      [item.syncedSkillId]
    );
    snapshotName = snapshotName ?? syncedSkill.rows[0]?.name ?? null;
    snapshotDescription = snapshotDescription ?? syncedSkill.rows[0]?.description ?? null;
  }

  const positionResult = await pool.query<{ next_position: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0)::int AS next_position FROM skill_group_items WHERE group_id = $1",
    [groupId]
  );
  const position = positionResult.rows[0]?.next_position ?? 0;
  const result = await pool.query<{ id: string }>(
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

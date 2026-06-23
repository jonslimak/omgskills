import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { isReservedHandleOrSlug } from "./_shared/reserved.js";
import { requirePortalUser } from "./_shared/user.js";
import { optionalString, requireString, slugify } from "./_shared/validation.js";

async function listGroups(req: Request) {
  const user = await requirePortalUser(req);
  const result = await getPgPool().query(
    `
      SELECT
        g.id,
        g.name,
        g.description,
        g.slug,
        g.visibility,
        count(i.id)::int AS "itemCount",
        count(a.id)::int AS "allowedEmailCount"
      FROM skill_groups g
      LEFT JOIN skill_group_items i ON i.group_id = g.id
      LEFT JOIN skill_group_allowed_emails a ON a.group_id = g.id
      WHERE g.owner_user_id = $1
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `,
    [user.id]
  );

  return jsonResponse(req, { groups: result.rows });
}

async function createGroup(req: Request) {
  const user = await requirePortalUser(req);
  const body = await req.json();
  const name = requireString(body?.name, "name", 120);
  const description = optionalString(body?.description, 1000);
  const visibility = body?.visibility === "restricted" ? "restricted" : "private";
  const syncedSkillIds = Array.isArray(body?.syncedSkillIds) ? body.syncedSkillIds : [];
  if (syncedSkillIds.length === 0) {
    throw new Response("Select at least one synced skill", { status: 400 });
  }
  if (syncedSkillIds.some((id: unknown) => typeof id !== "string")) {
    throw new Response("syncedSkillIds must be strings", { status: 400 });
  }

  let slug = slugify(typeof body?.slug === "string" ? body.slug : name);
  if (isReservedHandleOrSlug(slug)) {
    throw new Response("Group slug is reserved", { status: 400 });
  }

  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const groupResult = await client.query<{ id: string }>(
      `
        INSERT INTO skill_groups (owner_user_id, name, description, slug, visibility)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [user.id, name, description, slug, visibility]
    );
    const groupId = groupResult.rows[0].id;

    const ownedSkills = await client.query<{ id: string }>(
      `
        SELECT id
        FROM synced_skills
        WHERE user_id = $1
          AND is_current = true
          AND id = ANY($2::uuid[])
      `,
      [user.id, syncedSkillIds]
    );
    if (ownedSkills.rows.length !== syncedSkillIds.length) {
      throw new Response("One or more synced skills are unavailable", { status: 400 });
    }

    for (const [index, syncedSkillId] of syncedSkillIds.entries()) {
      await client.query(
        `
          INSERT INTO skill_group_items (group_id, kind, synced_skill_id, position)
          VALUES ($1, 'synced', $2, $3)
        `,
        [groupId, syncedSkillId, index]
      );
    }

    await client.query("COMMIT");
    return jsonResponse(req, { groupId, slug }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Response) {
      throw error;
    }
    if ((error as { code?: string }).code === "23505") {
      throw new Response("Group slug is already used", { status: 409 });
    }
    throw new Response("Failed to create group", { status: 500 });
  } finally {
    client.release();
  }
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    if (req.method === "GET") {
      return await listGroups(req);
    }
    if (req.method === "POST") {
      return await createGroup(req);
    }
    return errorResponse(req, 405, "Method not allowed");
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Group request failed");
  }
};

export const config: Config = {
  path: "/api/portal/groups"
};

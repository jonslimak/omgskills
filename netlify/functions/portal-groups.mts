import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { parseGroupVisibility } from "./_shared/group-behavior.js";
import { resolveCreateGroupSlug } from "./_shared/group-slug.js";
import { findOwnedGroupIds, requireGroupAccess } from "./_shared/group-access.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { optionalString, requireString } from "./_shared/validation.js";

async function listGroups(req: Request) {
  const user = await requirePortalUser(req);
  const pool = getPgPool();
  const candidateIds = await findOwnedGroupIds(user.id, pool);
  const accessibleIds = (await Promise.all(
    candidateIds.map(async (groupId) => {
      await requireGroupAccess(user, groupId, "manage", pool);
      return groupId;
    })
  ));
  if (accessibleIds.length === 0) {
    return jsonResponse(req, { groups: [] });
  }
  const result = await pool.query(
    `
      SELECT
        g.id,
        g.name,
        g.description,
        g.slug,
        g.visibility,
        g.is_favorites AS "isFavorites",
        g.disabled_at AS "disabledAt",
        count(DISTINCT i.id)::int AS "itemCount",
        count(DISTINCT a.id)::int AS "allowedEmailCount",
        COALESCE(
          jsonb_agg(DISTINCT jsonb_build_object('id', a.id, 'email', a.email)) FILTER (WHERE a.id IS NOT NULL),
          '[]'::jsonb
        ) AS "allowedEmails",
        COALESCE(
          array_agg(DISTINCT i.synced_skill_id) FILTER (WHERE i.synced_skill_id IS NOT NULL),
          ARRAY[]::uuid[]
        ) AS "syncedSkillIds"
      FROM skill_groups g
      LEFT JOIN skill_group_items i ON i.group_id = g.id
      LEFT JOIN skill_group_allowed_emails a ON a.group_id = g.id
      WHERE g.id = ANY($1::uuid[])
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `,
    [accessibleIds]
  );

  return jsonResponse(req, { groups: result.rows });
}

async function createGroup(req: Request) {
  const user = await requirePortalUser(req);
  const body = await req.json();
  const name = requireString(body?.name, "name", 120);
  const description = optionalString(body?.description, 1000);
  const isFavorites = body?.isFavorites === true;
  const visibility = isFavorites
    ? "public"
    : body?.visibility === undefined
      ? "private"
      : parseGroupVisibility(body.visibility);
  const syncedSkillIds = Array.isArray(body?.syncedSkillIds) ? body.syncedSkillIds : [];
  if (isFavorites && syncedSkillIds.length === 0) {
    throw new Response("Select at least one synced skill", { status: 400 });
  }
  if (syncedSkillIds.some((id: unknown) => typeof id !== "string")) {
    throw new Response("syncedSkillIds must be strings", { status: 400 });
  }

  const slug = resolveCreateGroupSlug(name, body?.slug, isFavorites);

  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const groupResult = await client.query<{ id: string }>(
      `
        INSERT INTO skill_groups (owner_user_id, name, description, slug, visibility, is_favorites)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [user.id, isFavorites ? "Favorite Skills" : name, description, slug, visibility, isFavorites]
    );
    const groupId = groupResult.rows[0].id;

    const ownedSkills = await client.query<{ id: string; name: string; description: string | null }>(
      `
        SELECT id, name, description
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
    const ownedSkillById = new Map(ownedSkills.rows.map((skill) => [skill.id, skill]));

    for (const [index, syncedSkillId] of syncedSkillIds.entries()) {
      const syncedSkill = ownedSkillById.get(syncedSkillId);
      await client.query(
        `
          INSERT INTO skill_group_items (group_id, kind, synced_skill_id, name, description, position)
          VALUES ($1, 'synced', $2, $3, $4, $5)
        `,
        [groupId, syncedSkillId, syncedSkill?.name ?? null, syncedSkill?.description ?? null, index]
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

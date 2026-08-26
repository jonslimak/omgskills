import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { assertGroupCanBeDeleted, parseGroupPatch } from "./_shared/group-behavior.js";
import { requireGroupAccess } from "./_shared/group-access.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { requireJsonObject } from "./_shared/validation.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (!["GET", "PATCH", "DELETE"].includes(req.method)) {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Missing group id", { status: 400 });
    }

    if (req.method === "GET") {
      const pool = getPgPool();
      const access = await requireGroupAccess(user, groupId, "read", pool);
      const groupResult = await pool.query(
        `
          SELECT
            g.id,
            g.name,
            g.description,
            g.slug,
            g.visibility,
            g.is_favorites AS "isFavorites",
            g.disabled_at AS "disabledAt",
            owner.display_name AS "ownerDisplayName",
            count(DISTINCT i.id)::int AS "itemCount",
            COALESCE(
              jsonb_agg(DISTINCT jsonb_build_object('id', a.id, 'email', a.email)) FILTER (WHERE a.id IS NOT NULL AND $2 = 'owner'),
              '[]'::jsonb
            ) AS "allowedEmails"
          FROM skill_groups g
          JOIN users owner ON owner.id = g.owner_user_id
          LEFT JOIN skill_group_items i ON i.group_id = g.id
          LEFT JOIN skill_group_allowed_emails a ON a.group_id = g.id
          WHERE g.id = $1
          GROUP BY g.id, owner.display_name
        `,
        [groupId, access.accessRole]
      );
      const group = groupResult.rows[0];
      if (!group) {
        throw new Response("Group not found", { status: 404 });
      }

      const itemsResult = await pool.query(
        `
          SELECT
            i.id,
            i.kind,
            i.catalog_skill_id AS "catalogSkillId",
            i.github_url AS "itemGithubUrl",
            i.name AS "snapshotName",
            i.description AS "snapshotDescription",
            i.note,
            i.position,
            s.name AS "skillName",
            s.description AS "skillDescription",
            s.github_url AS "githubUrl",
            s.source
          FROM skill_group_items i
          LEFT JOIN synced_skills s ON s.id = i.synced_skill_id
          WHERE i.group_id = $1
          ORDER BY i.position ASC
        `,
        [groupId]
      );

      const items = itemsResult.rows.map((row: any) => ({
        id: row.id,
        kind: row.kind,
        name: row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill",
        description: row.skillDescription || row.snapshotDescription || row.note || "",
        githubUrl: row.githubUrl || row.itemGithubUrl || null,
        source: row.source || row.kind,
        position: row.position
      }));

      return jsonResponse(req, { group, items, accessRole: access.accessRole });
    }

    const pool = getPgPool();
    const access = await requireGroupAccess(user, groupId, "manage", pool);
    if (req.method === "DELETE") {
      assertGroupCanBeDeleted(access);
      await pool.query("DELETE FROM skill_groups WHERE id = $1", [groupId]);
      return jsonResponse(req, { groupId: access.id, deleted: true });
    }

    const body = await requireJsonObject(req);
    const patch = parseGroupPatch(body, access);
    const result = await pool.query<{
      name: string;
      description: string | null;
      visibility: string;
    }>(
      `
        UPDATE skill_groups
        SET
          name = CASE WHEN $2 THEN $3 ELSE name END,
          description = CASE WHEN $4 THEN $5 ELSE description END,
          visibility = CASE WHEN $6 THEN $7 ELSE visibility END,
          updated_at = now()
        WHERE id = $1
        RETURNING name, description, visibility
      `,
      [
        groupId,
        patch.hasName,
        patch.name,
        patch.hasDescription,
        patch.description,
        patch.hasVisibility,
        patch.visibility,
      ]
    );
    return jsonResponse(req, {
      groupId: access.id,
      slug: access.slug,
      ...result.rows[0],
    });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Group update failed");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId"
};

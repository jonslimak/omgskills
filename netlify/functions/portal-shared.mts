import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { findInvitedGroupIds, requireGroupAccess } from "./_shared/group-access.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const pool = getPgPool();
    const candidateIds = await findInvitedGroupIds(user.email, pool);
    const accessibleIds = (await Promise.all(
      candidateIds.map(async (groupId) => {
        try {
          const access = await requireGroupAccess(user, groupId, "read", pool);
          return access.accessRole === "invited" ? groupId : null;
        } catch (error) {
          if (error instanceof Response && error.status === 404) {
            return null;
          }
          throw error;
        }
      })
    )).filter((groupId): groupId is string => Boolean(groupId));
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
          owner.display_name AS "ownerDisplayName",
          count(i.id)::int AS "itemCount"
        FROM skill_groups g
        JOIN users owner ON owner.id = g.owner_user_id
        LEFT JOIN skill_group_items i ON i.group_id = g.id
        WHERE g.id = ANY($1::uuid[])
        GROUP BY g.id, owner.display_name
        ORDER BY g.created_at DESC
      `,
      [accessibleIds]
    );

    return jsonResponse(req, { groups: result.rows });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to load shared groups");
  }
};

export const config: Config = {
  path: "/api/portal/shared"
};

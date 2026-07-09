import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
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
    const result = await getPgPool().query(
      `
        SELECT
          g.id,
          g.name,
          g.description,
          g.slug,
          owner.display_name AS "ownerDisplayName",
          count(i.id)::int AS "itemCount"
        FROM skill_group_allowed_emails a
        JOIN skill_groups g ON g.id = a.group_id
        JOIN users owner ON owner.id = g.owner_user_id
        LEFT JOIN skill_group_items i ON i.group_id = g.id
        WHERE a.email = $1
          AND g.visibility = 'restricted'
          AND g.disabled_at IS NULL
        GROUP BY g.id, owner.display_name
        ORDER BY g.created_at DESC
      `,
      [user.email]
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

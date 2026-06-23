import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "PATCH") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Missing group id", { status: 400 });
    }

    const body = await req.json();
    const visibility = typeof body?.visibility === "string" ? body.visibility : "";
    if (!["private", "restricted", "public"].includes(visibility)) {
      throw new Response("visibility is invalid", { status: 400 });
    }

    const result = await getPgPool().query<{ id: string; slug: string }>(
      `
        UPDATE skill_groups
        SET visibility = $3, updated_at = now()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING id, slug
      `,
      [groupId, user.id, visibility]
    );

    const group = result.rows[0];
    if (!group) {
      throw new Response("Group not found", { status: 404 });
    }

    return jsonResponse(req, { groupId: group.id, slug: group.slug, visibility });
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

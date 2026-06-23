import type { Config, Context } from "@netlify/functions";
import { requireOwnedGroup } from "./_shared/group-items.js";
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
    await requireOwnedGroup(user.id, groupId);
    const body = await req.json();
    const disabled = body?.disabled === true;
    await getPgPool().query(
      "UPDATE skill_groups SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1",
      [groupId, disabled]
    );
    return jsonResponse(req, { groupId, disabled });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Moderation update failed");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/moderation"
};

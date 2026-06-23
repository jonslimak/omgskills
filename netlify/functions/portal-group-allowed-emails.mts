import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { normalizeEmail } from "./_shared/validation.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "POST") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Missing group id", { status: 400 });
    }
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const pool = getPgPool();
    const ownerCheck = await pool.query(
      "SELECT id FROM skill_groups WHERE id = $1 AND owner_user_id = $2",
      [groupId, user.id]
    );
    if (ownerCheck.rowCount === 0) {
      throw new Response("Group not found", { status: 404 });
    }

    await pool.query(
      `
        INSERT INTO skill_group_allowed_emails (group_id, email)
        VALUES ($1, $2)
        ON CONFLICT (group_id, email) DO NOTHING
      `,
      [groupId, email]
    );

    return jsonResponse(req, { email }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to add allowed email");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/allowed-emails"
};

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
          id,
          stable_key AS "stableKey",
          name,
          description,
          catalog_skill_id AS "catalogSkillId",
          github_url AS "githubUrl",
          is_local_only AS "isLocalOnly",
          source,
          is_current AS "isCurrent",
          last_seen_at AS "lastSeenAt"
        FROM synced_skills
        WHERE user_id = $1
          AND is_current = true
        ORDER BY lower(name), source
      `,
      [user.id]
    );

    return jsonResponse(req, { skills: result.rows });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Failed to load synced skills");
  }
};

export const config: Config = {
  path: "/api/portal/synced-skills"
};

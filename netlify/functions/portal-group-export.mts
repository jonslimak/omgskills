import type { Config, Context } from "@netlify/functions";
import { requireGroupAccess } from "./_shared/group-access.js";
import { recordAnalytics } from "./_shared/group-items.js";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (req.method !== "GET") {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const user = await requirePortalUser(req);
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Missing group id", { status: 400 });
    }
    const group = await requireGroupAccess(user, groupId, "manage");
    const items = await getPgPool().query(
      `
        SELECT
          i.kind,
          i.catalog_skill_id AS "catalogSkillId",
          i.github_url AS "githubUrl",
          i.name AS "snapshotName",
          i.description AS "snapshotDescription",
          i.note,
          i.position,
          s.name AS "syncedName",
          s.description AS "syncedDescription",
          s.github_url AS "syncedGithubUrl",
          s.is_local_only AS "syncedIsLocalOnly",
          s.source AS "syncedSource"
        FROM skill_group_items i
        LEFT JOIN synced_skills s ON s.id = i.synced_skill_id
        WHERE i.group_id = $1
        ORDER BY i.position ASC
      `,
      [group.id]
    );

    await recordAnalytics("group_export", { groupId: group.id });
    const exportedAt = new Date().toISOString();
    const body = {
      type: "omgskills.skill_group",
      version: 1,
      exported_at: exportedAt,
      group: {
        id: group.id,
        name: group.name,
        slug: group.slug,
        owner: user.email
      },
      items: items.rows
    };
    const date = exportedAt.slice(0, 10);

    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="skillgroup-${group.slug}-${date}.json"`
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Export failed");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/export"
};

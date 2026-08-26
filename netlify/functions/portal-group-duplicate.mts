import type { Config, Context } from "@netlify/functions";
import { recordAnalytics } from "./_shared/group-items.js";
import { requireGroupAccess } from "./_shared/group-access.js";
import { getPgPool } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";
import { requirePortalUser } from "./_shared/user.js";
import { slugify } from "./_shared/validation.js";

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

  const pool = getPgPool();
  const client = await pool.connect();
  try {
    const user = await requirePortalUser(req);
    const sourceGroupId = groupIdFromPath(req);
    if (!sourceGroupId) {
      throw new Response("Missing group id", { status: 400 });
    }

    await client.query("BEGIN");
    await requireGroupAccess(user, sourceGroupId, "public", client);
    const sourceResult = await client.query<{
      id: string;
      name: string;
      description: string | null;
      slug: string;
      owner_handle: string | null;
      owner_display_name: string | null;
    }>(
      `
        SELECT g.id, g.name, g.description, g.slug, owner.handle AS owner_handle, owner.display_name AS owner_display_name
        FROM skill_groups g
        JOIN users owner ON owner.id = g.owner_user_id
        WHERE g.id = $1
      `,
      [sourceGroupId]
    );
    const source = sourceResult.rows[0];
    if (!source) {
      throw new Response("Group not found", { status: 404 });
    }

    const baseSlug = slugify(`${source.slug}-copy`);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;
    const newGroup = await client.query<{ id: string }>(
      `
        INSERT INTO skill_groups (owner_user_id, name, description, slug, visibility)
        VALUES ($1, $2, $3, $4, 'private')
        RETURNING id
      `,
      [user.id, `${source.name} Copy`, source.description, slug]
    );
    const newGroupId = newGroup.rows[0].id;

    await client.query(
      `
        INSERT INTO skill_group_items (group_id, kind, synced_skill_id, catalog_skill_id, github_url, name, description, note, position)
        SELECT $1, kind, synced_skill_id, catalog_skill_id, github_url, name, description, note, position
        FROM skill_group_items
        WHERE group_id = $2
        ORDER BY position ASC
      `,
      [newGroupId, source.id]
    );

    await client.query(
      `
        INSERT INTO skill_group_copies (new_group_id, source_group_id, source_owner_handle, source_group_slug, source_owner_display_name)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [newGroupId, source.id, source.owner_handle, source.slug, source.owner_display_name]
    );
    await client.query("COMMIT");
    await recordAnalytics("group_duplicate", { groupId: source.id });

    return jsonResponse(req, { groupId: newGroupId, slug }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Duplicate failed");
  } finally {
    client.release();
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/duplicate"
};

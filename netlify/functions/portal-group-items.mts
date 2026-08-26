import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import {
  GithubSkillValidationError,
  groupItemForValidatedGithubSkill,
  validateGithubSkill,
} from "./_shared/github-skill-resolution.js";
import { requireGroupItemId, validateCompleteItemOrder } from "./_shared/group-behavior.js";
import { requireGroupAccess } from "./_shared/group-access.js";
import { addGroupItem } from "./_shared/group-items.js";
import { errorResponse, jsonResponse, optionsResponse, withTimeout } from "./_shared/http.js";
import { loadPublishedCatalogIdentity } from "./_shared/published-catalog.js";
import { requirePortalUser } from "./_shared/user.js";
import { optionalString, requireJsonObject, requireString } from "./_shared/validation.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

async function getSyncedSkill(userId: string, syncedSkillId: string) {
  const result = await getPgPool().query<{ id: string }>(
    `
      SELECT id
      FROM synced_skills
      WHERE id = $1
        AND user_id = $2
        AND is_current = true
      LIMIT 1
    `,
    [syncedSkillId, userId]
  );
  return result.rows[0] ?? null;
}

async function listGroupItems(req: Request, groupId: string) {
  const user = await requirePortalUser(req);
  await requireGroupAccess(user, groupId, "read");

  const result = await getPgPool().query(
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

  const items = result.rows.map((row: any) => ({
    id: row.id,
    kind: row.kind,
    name: row.skillName || row.snapshotName || row.catalogSkillId || row.itemGithubUrl || "Skill",
    description: row.skillDescription || row.snapshotDescription || row.note || "",
    githubUrl: row.githubUrl || row.itemGithubUrl || null,
    source: row.source || row.kind,
    position: row.position
  }));

  return jsonResponse(req, { items });
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    return errorResponse(req, 405, "Method not allowed");
  }

  try {
    const groupId = groupIdFromPath(req);
    if (!groupId) {
      throw new Response("Missing group id", { status: 400 });
    }
    if (req.method === "GET") {
      return await listGroupItems(req, groupId);
    }

    const user = await requirePortalUser(req);

    if (req.method === "PATCH" || req.method === "DELETE") {
      const pool = getPgPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await requireGroupAccess(user, groupId, "manage", client);

        if (req.method === "DELETE") {
          const body = await requireJsonObject(req);
          const itemId = requireGroupItemId(body.itemId);
          const deleted = await client.query<{ id: string }>(
            "DELETE FROM skill_group_items WHERE group_id = $1 AND id = $2 RETURNING id",
            [groupId, itemId]
          );
          if (!deleted.rowCount) {
            throw new Response("Group item not found", { status: 404 });
          }
          await client.query(
            `
              WITH ordered AS (
                SELECT id, (row_number() OVER (ORDER BY position ASC, created_at ASC, id ASC) - 1)::int AS position
                FROM skill_group_items
                WHERE group_id = $1
              )
              UPDATE skill_group_items item
              SET position = ordered.position
              FROM ordered
              WHERE item.id = ordered.id
            `,
            [groupId]
          );
          await client.query("COMMIT");
          return jsonResponse(req, { itemId, deleted: true });
        }

        const body = await requireJsonObject(req);
        const current = await client.query<{ id: string }>(
          `
            SELECT id
            FROM skill_group_items
            WHERE group_id = $1
            ORDER BY position ASC, created_at ASC, id ASC
            FOR UPDATE
          `,
          [groupId]
        );
        const itemIds = validateCompleteItemOrder(
          current.rows.map((row) => row.id),
          body.itemIds
        );
        await client.query(
          `
            UPDATE skill_group_items item
            SET position = requested.position
            FROM (
              SELECT id, (ordinality - 1)::int AS position
              FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, ordinality)
            ) AS requested
            WHERE item.group_id = $1 AND item.id = requested.id
          `,
          [groupId, itemIds]
        );
        await client.query("COMMIT");
        return jsonResponse(req, { itemIds });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    await requireGroupAccess(user, groupId, "manage");

    const body = await requireJsonObject(req);
    const kind = body?.kind;
    if (kind === "synced") {
      const syncedSkillId = requireString(body?.syncedSkillId, "syncedSkillId", 80);
      const available = await getSyncedSkill(user.id, syncedSkillId);
      if (!available) {
        throw new Response("Synced skill is unavailable", { status: 400 });
      }
      const note = optionalString(body?.note, 1000);
      const item = await addGroupItem(groupId, { kind: "synced", syncedSkillId, note });
      return jsonResponse(req, item, { status: 201 });
    }
    if (kind === "catalog") {
      const catalogSkillId = requireString(body?.catalogSkillId, "catalogSkillId", 500);
      const name = optionalString(body?.name, 200);
      const description = optionalString(body?.description, 2000);
      const note = optionalString(body?.note, 1000);
      const item = await addGroupItem(groupId, { kind: "catalog", catalogSkillId, name, description, note });
      return jsonResponse(req, item, { status: 201 });
    }
    if (kind === "github") {
      const githubUrl = requireString(body?.githubUrl, "githubUrl", 500);
      const validated = await validateGithubSkill(githubUrl);
      const note = optionalString(body?.note, 1000);
      // GitHub validation succeeded, so catalog enrichment remains non-blocking.
      const catalogIdentity = await withTimeout(loadPublishedCatalogIdentity(), 5_000)
        .catch(() => null);
      const resolvedItem = groupItemForValidatedGithubSkill(validated, catalogIdentity);
      const item = await addGroupItem(groupId, {
        ...resolvedItem,
        note
      });
      return jsonResponse(req, item, { status: 201 });
    }

    throw new Response("kind must be synced, catalog, or github", { status: 400 });
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    if (error instanceof GithubSkillValidationError) {
      return errorResponse(req, 400, error.message);
    }
    return errorResponse(req, 500, "Failed to add group item");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/items"
};

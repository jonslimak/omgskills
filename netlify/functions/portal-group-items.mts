import type { Config, Context } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import {
  GithubSkillValidationError,
  groupItemForValidatedGithubSkill,
  validateGithubSkill,
} from "./_shared/github-skill-resolution.js";
import { requireGroupItemId } from "./_shared/group-behavior.js";
import { requireGroupAccess } from "./_shared/group-access.js";
import {
  addGroupItemWithClient,
  deleteGroupItemWithClient,
  type GroupItemInput,
  type GroupItemPublication,
  reorderGroupItemsWithClient
} from "./_shared/group-items.js";
import { errorResponse, jsonResponse, optionsResponse, withTimeout } from "./_shared/http.js";
import { loadPublishedCatalogIdentity } from "./_shared/published-catalog.js";
import {
  PublicReleaseResolutionError,
  resolveCatalogPublicRelease,
  resolveGithubPublicRelease,
  type PreparedPublicRelease,
} from "./_shared/public-releases.js";
import {
  prepareSyncedGroupPublication,
  sameSyncedGroupPublicationIdentity,
} from "./_shared/synced-group-publication.js";
import { requirePortalUser } from "./_shared/user.js";
import { optionalString, requireJsonObject, requireString } from "./_shared/validation.js";

function groupIdFromPath(req: Request): string | undefined {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[3];
}

type SyncedSkill = {
  id: string;
  name: string;
  description: string | null;
  identityStatus: string;
  catalogSkillId: string | null;
  skillMdSha: string;
};

type QueryClient = Pick<ReturnType<typeof getPgPool>, "query">;

async function getSyncedSkill(
  client: QueryClient,
  userId: string,
  syncedSkillId: string,
  lock = false,
): Promise<SyncedSkill | null> {
  const result = await client.query<SyncedSkill>(
    `
      SELECT
        id,
        name,
        description,
        identity_status AS "identityStatus",
        catalog_skill_id AS "catalogSkillId",
        skill_md_sha AS "skillMdSha"
      FROM synced_skills
      WHERE id = $1
        AND user_id = $2
        AND is_current = true
      LIMIT 1
      ${lock ? "FOR SHARE" : ""}
    `,
    [syncedSkillId, userId]
  );
  return result.rows[0] ?? null;
}

function publicReleasePublication(release: PreparedPublicRelease): GroupItemPublication {
  return { kind: "release", ...release };
}

async function persistGroupItem(
  user: Awaited<ReturnType<typeof requirePortalUser>>,
  groupId: string,
  item: GroupItemInput,
  publication: GroupItemPublication,
  syncedSnapshot?: SyncedSkill,
) {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    await requireGroupAccess(user, groupId, "manage", client);
    if (syncedSnapshot) {
      const current = await getSyncedSkill(client, user.id, syncedSnapshot.id, true);
      if (!current || !sameSyncedGroupPublicationIdentity(current, syncedSnapshot)) {
        throw new Response("Synced skill changed; try again", { status: 409 });
      }
    }
    const result = await addGroupItemWithClient(client, groupId, item, publication);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
          const deleted = await deleteGroupItemWithClient(client, groupId, itemId);
          if (!deleted) {
            throw new Response("Group item not found", { status: 404 });
          }
          await client.query("COMMIT");
          return jsonResponse(req, { itemId, deleted: true });
        }

        const body = await requireJsonObject(req);
        const { itemIds } = await reorderGroupItemsWithClient(client, groupId, body.itemIds);
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
      const available = await getSyncedSkill(getPgPool(), user.id, syncedSkillId);
      if (!available) {
        throw new Response("Synced skill is unavailable", { status: 400 });
      }
      const note = optionalString(body?.note, 1000);
      const publication = await prepareSyncedGroupPublication(available);
      const item = await persistGroupItem(
        user,
        groupId,
        { kind: "synced", syncedSkillId, note },
        publication,
        available,
      );
      return jsonResponse(req, item, { status: 201 });
    }
    if (kind === "catalog") {
      const catalogSkillId = requireString(body?.catalogSkillId, "catalogSkillId", 500);
      const name = optionalString(body?.name, 200);
      const description = optionalString(body?.description, 2000);
      const note = optionalString(body?.note, 1000);
      const publication = publicReleasePublication(
        await resolveCatalogPublicRelease(catalogSkillId),
      );
      const item = await persistGroupItem(
        user,
        groupId,
        { kind: "catalog", catalogSkillId, name, description, note },
        publication,
      );
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
      const release = resolvedItem.kind === "catalog"
        ? await resolveCatalogPublicRelease(resolvedItem.catalogSkillId)
        : await resolveGithubPublicRelease(validated);
      const item = await persistGroupItem(user, groupId, {
        ...resolvedItem,
        note
      }, publicReleasePublication(release));
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
    if (error instanceof PublicReleaseResolutionError) {
      const status = error.code === "rate_limited" || error.code === "upstream_unavailable"
        ? 503
        : error.code === "skill_changed" || error.code === "catalog_unavailable"
          ? 409
          : 400;
      return jsonResponse(req, { error: error.message }, {
        status,
        headers: error.retryAfterSeconds
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : undefined,
      });
    }
    return errorResponse(req, 500, "Failed to add group item");
  }
};

export const config: Config = {
  path: "/api/portal/groups/:groupId/items"
};

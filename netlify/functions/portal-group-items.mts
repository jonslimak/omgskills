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
  reorderGroupItemsWithClient,
  updateCloudGroupItemWithClient
} from "./_shared/group-items.js";
import { normalizeSkillKey, readCloudRecordNames } from "./_shared/cloud-save.js";
import { cloudSkillKeys } from "./_shared/cloud-skill-keys.js";
import { installationFolderFromKey } from "./_shared/sync-skill.js";
import { errorResponse, jsonResponse, optionsResponse, secretJsonResponse, withTimeout } from "./_shared/http.js";
import { portalGroupItem, type PortalGroupItemRow } from "./_shared/portal-group-item.js";
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
  stableKey: string;
  source: string;
};

/**
 * The cloud save key of one synced skill: its folder name, unless another skill in a same-name folder
 * holds that key (see cloud-skill-keys.ts). Its Mac's other current copies and the saved skills decide.
 */
async function cloudKeyOf(client: QueryClient, userId: string, skill: SyncedSkill): Promise<string | null> {
  const rows = await client.query<{ id: string; name: string; source: string; stableKey: string; deviceId: string | null;
    isCurrent: boolean }>(
    `SELECT id, name, source, stable_key AS "stableKey", device_id AS "deviceId", is_current AS "isCurrent"
     FROM synced_skills
     WHERE user_id = $1 AND is_current = true
       AND device_id IS NOT DISTINCT FROM (SELECT device_id FROM synced_skills WHERE id = $2 AND user_id = $1)
     ORDER BY lower(name), source, id`,
    [userId, skill.id]
  );
  const copies = rows.rows.map(row => ({ ...row, installationFolder: installationFolderFromKey(row.stableKey, row.source) }));
  const own = copies.find(copy => copy.id === skill.id);
  if (!own) return null;
  const key = cloudSkillKeys(copies, await readCloudRecordNames(client, userId)).get(own);
  try {
    return key ? normalizeSkillKey(key) : null;
  } catch {
    return null;
  }
}

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
        skill_md_sha AS "skillMdSha",
        stable_key AS "stableKey",
        source
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

const defaultReadDependencies = { getPgPool, requirePortalUser, requireGroupAccess };

export async function listGroupItems(req: Request, groupId: string, dependencies = defaultReadDependencies) {
  const { getPgPool, requirePortalUser, requireGroupAccess } = dependencies;
  const user = await requirePortalUser(req);
  const pool = getPgPool();
  const access = await requireGroupAccess(user, groupId, "read", pool);

  const result = await pool.query<PortalGroupItemRow>(
    `
      SELECT
        i.id,
        i.kind,
        CASE WHEN $2 = 'owner' THEN i.synced_skill_id ELSE NULL END AS "syncedSkillId",
        i.catalog_skill_id AS "catalogSkillId",
        i.github_url AS "itemGithubUrl",
        i.name AS "snapshotName",
        i.description AS "snapshotDescription",
        i.note,
        i.position,
        s.name AS "skillName",
        s.description AS "skillDescription",
        s.github_url AS "githubUrl",
        s.source,
        src.kind AS "sourceKind",
        i.metadata_only_reason AS "metadataOnlyReason",
        i.release_id AS "releaseId",
        -- A duplicated Set holds someone else's version, which only that person's Sets can share.
        (src.owner_user_id = (SELECT owner_user_id FROM skill_groups WHERE id = $1)) AS "sharedByOwner",
        CASE WHEN $2 = 'owner' THEN saved.current_release_id ELSE NULL END AS "savedReleaseId"
      FROM skill_group_items i
      LEFT JOIN synced_skills s ON s.id = i.synced_skill_id
      LEFT JOIN skill_sources src ON src.id = i.source_id
      LEFT JOIN cloud_saved_skills saved ON saved.source_id = i.source_id
      WHERE i.group_id = $1
      ORDER BY i.position ASC
    `,
    [groupId, access.accessRole]
  );

  const items = result.rows.map((row) => portalGroupItem(row, access.accessRole));

  return secretJsonResponse(req, { items });
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
        if (body.updateItemId !== undefined) {
          const update = await updateCloudGroupItemWithClient(
            client, groupId, requireGroupItemId(body.updateItemId), user.id);
          await client.query("COMMIT");
          return jsonResponse(req, update);
        }
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
      const prepared = await prepareSyncedGroupPublication(available);
      // A skill only on the owner's Macs is shared from its cloud save copy, when there is one.
      const cloudKey = prepared.kind === "metadata_only" ? await cloudKeyOf(getPgPool(), user.id, available) : null;
      const publication: GroupItemPublication = prepared.kind === "metadata_only" && cloudKey
        ? { kind: "cloud", ownerUserId: user.id, skillKey: cloudKey, fallback: prepared.reason }
        : prepared;
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

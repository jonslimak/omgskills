import type { QueryResult, QueryResultRow } from "pg";
import { getPgPool } from "./db.js";
import type { PortalUser } from "./user.js";

export type GroupAccessCapability = "read" | "manage" | "public";
export type GroupAccessRole = "owner" | "invited" | "public";

export type GroupAccessFacts = {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  visibility: "private" | "restricted" | "public";
  isFavorites: boolean;
  disabledAt: string | null;
  invited: boolean;
};

export type GroupAccess = GroupAccessFacts & {
  accessRole: GroupAccessRole;
};

export type PublicGroupRouteFacts = {
  handle: string;
  groupSlug: string;
};

export type GroupAccessActor = Pick<PortalUser, "id" | "email"> | null;

export type GroupAccessClient = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

export function decideGroupAccess(
  group: GroupAccessFacts | null,
  actor: GroupAccessActor,
  capability: GroupAccessCapability
): GroupAccessRole | null {
  if (!group) {
    return null;
  }

  const isOwner = actor?.id === group.ownerUserId;
  if (capability === "manage") {
    return isOwner ? "owner" : null;
  }

  if (capability === "public") {
    return group.visibility === "public" && group.disabledAt === null ? "public" : null;
  }

  if (isOwner) {
    return "owner";
  }
  if (group.disabledAt !== null) {
    return null;
  }
  if (group.visibility === "public") {
    return "public";
  }
  if (group.visibility === "restricted" && actor && group.invited) {
    return "invited";
  }
  return null;
}

export async function requireGroupAccess(
  actor: GroupAccessActor,
  groupId: string,
  capability: GroupAccessCapability,
  client: GroupAccessClient = getPgPool()
): Promise<GroupAccess> {
  const result = await client.query<GroupAccessFacts>(
    `
      SELECT
        g.id,
        g.owner_user_id AS "ownerUserId",
        g.name,
        g.slug,
        g.visibility,
        g.is_favorites AS "isFavorites",
        g.disabled_at AS "disabledAt",
        CASE
          WHEN $2::text IS NULL THEN false
          ELSE EXISTS (
            SELECT 1
            FROM skill_group_allowed_emails a
            WHERE a.group_id = g.id AND a.email = $2
          )
        END AS invited
      FROM skill_groups g
      WHERE g.id = $1
      LIMIT 1
    `,
    [groupId, actor?.email ?? null]
  );
  const group = result.rows[0] ?? null;
  const accessRole = decideGroupAccess(group, actor, capability);
  if (!group || !accessRole) {
    throw new Response("Group not found", { status: 404 });
  }
  return { ...group, accessRole };
}

export async function findOwnedGroupIds(
  ownerUserId: string,
  client: GroupAccessClient = getPgPool()
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM skill_groups WHERE owner_user_id = $1 ORDER BY created_at DESC",
    [ownerUserId]
  );
  return result.rows.map((row) => row.id);
}

export async function findInvitedGroupIds(
  email: string,
  client: GroupAccessClient = getPgPool()
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    "SELECT DISTINCT group_id AS id FROM skill_group_allowed_emails WHERE email = $1",
    [email]
  );
  return result.rows.map((row) => row.id);
}

export async function findGroupIdByOwnerSlug(
  ownerUserId: string,
  slug: string,
  client: GroupAccessClient = getPgPool()
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM skill_groups WHERE owner_user_id = $1 AND slug = $2 LIMIT 1",
    [ownerUserId, slug]
  );
  return result.rows[0]?.id ?? null;
}

export async function findIndexablePublicGroups(
  client: GroupAccessClient = getPgPool()
): Promise<PublicGroupRouteFacts[]> {
  const result = await client.query<PublicGroupRouteFacts>(
    `
      SELECT u.handle, g.slug AS "groupSlug"
      FROM skill_groups g
      JOIN users u ON u.id = g.owner_user_id
      WHERE
        u.profile_published = true
        AND u.handle IS NOT NULL
        AND g.visibility = 'public'
        AND g.disabled_at IS NULL
      ORDER BY lower(u.handle), lower(g.slug)
    `
  );
  return result.rows;
}

import type { QueryResult, QueryResultRow } from "pg";
import { decideGroupAccess, type GroupAccessFacts } from "./group-access.js";

export type PrivateReleaseActor = {
  userId: string;
  email: string;
  deviceId?: string | null;
};

export type PrivateReleaseGrant = {
  accessRole: "owner" | "invited";
  actorUserId: string;
  deviceId: string | null;
  sourceId: string;
  releaseId: string;
  ownerUserId: string;
  installationId: string;
  repositoryId: string;
  repositorySlug: string;
  normalizedRoot: string;
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
  createdAt: string;
  groupId: string | null;
  skillItemId: string | null;
};

export type PrivateReleaseAccessRow = {
  sourceId: string;
  releaseId: string;
  ownerUserId: string;
  installationId: string;
  repositoryId: string;
  repositorySlug: string;
  normalizedRoot: string;
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
  createdAt: string;
  groupId: string | null;
  groupOwnerUserId: string | null;
  groupName: string | null;
  groupSlug: string | null;
  groupVisibility: "private" | "restricted" | "public" | null;
  groupIsFavorites: boolean | null;
  groupDisabledAt: string | null;
  invited: boolean;
  skillItemId: string | null;
};

type PrivateReleaseAccessDatabase = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

export class PrivateReleaseAccessError extends Error {
  readonly code = "release_unavailable";

  constructor() {
    super("Private release is unavailable");
    this.name = "PrivateReleaseAccessError";
  }
}

function linkedGroup(row: PrivateReleaseAccessRow): GroupAccessFacts | null {
  if (
    !row.groupId
    || !row.groupOwnerUserId
    || !row.groupName
    || !row.groupSlug
    || !row.groupVisibility
    || row.groupIsFavorites === null
    || row.groupOwnerUserId !== row.ownerUserId
  ) {
    return null;
  }
  return {
    id: row.groupId,
    ownerUserId: row.groupOwnerUserId,
    name: row.groupName,
    slug: row.groupSlug,
    visibility: row.groupVisibility,
    isFavorites: row.groupIsFavorites,
    disabledAt: row.groupDisabledAt,
    invited: row.invited
  };
}

function grant(
  row: PrivateReleaseAccessRow,
  actor: PrivateReleaseActor,
  accessRole: "owner" | "invited",
  group: GroupAccessFacts | null
): PrivateReleaseGrant {
  return {
    accessRole,
    actorUserId: actor.userId,
    deviceId: actor.deviceId ?? null,
    sourceId: row.sourceId,
    releaseId: row.releaseId,
    ownerUserId: row.ownerUserId,
    installationId: row.installationId,
    repositoryId: row.repositoryId,
    repositorySlug: row.repositorySlug,
    normalizedRoot: row.normalizedRoot,
    commitSha: row.commitSha,
    treeSha: row.treeSha,
    skillMdSha: row.skillMdSha,
    createdAt: row.createdAt,
    groupId: group?.id ?? null,
    skillItemId: group ? row.skillItemId : null
  };
}

export function decidePrivateReleaseAccess(
  rows: PrivateReleaseAccessRow[],
  actor: PrivateReleaseActor
): PrivateReleaseGrant | null {
  const first = rows[0];
  if (!first) {
    return null;
  }

  if (first.ownerUserId === actor.userId) {
    const linked = rows
      .map((row) => ({ row, group: linkedGroup(row) }))
      .find(({ group }) => group !== null);
    return grant(linked?.row ?? first, actor, "owner", linked?.group ?? null);
  }

  for (const row of rows) {
    const group = linkedGroup(row);
    if (!group) continue;
    const role = decideGroupAccess(
      group,
      { id: actor.userId, email: actor.email },
      "read"
    );
    if (role === "invited") {
      return grant(row, actor, role, group);
    }
  }
  return null;
}

export async function requirePrivateReleaseAccess(
  client: PrivateReleaseAccessDatabase,
  actor: PrivateReleaseActor,
  releaseId: string
): Promise<PrivateReleaseGrant> {
  const result = await client.query<PrivateReleaseAccessRow>(
    `
      SELECT
        release.id AS "releaseId",
        release.source_id AS "sourceId",
        release.commit_sha AS "commitSha",
        release.tree_sha AS "treeSha",
        release.skill_md_sha AS "skillMdSha",
        release.created_at::text AS "createdAt",
        source.owner_user_id AS "ownerUserId",
        source.broker_installation_id AS "installationId",
        source.repository_id AS "repositoryId",
        source.repository_slug AS "repositorySlug",
        source.normalized_root AS "normalizedRoot",
        group_row.id AS "groupId",
        group_row.owner_user_id AS "groupOwnerUserId",
        group_row.name AS "groupName",
        group_row.slug AS "groupSlug",
        group_row.visibility AS "groupVisibility",
        group_row.is_favorites AS "groupIsFavorites",
        group_row.disabled_at::text AS "groupDisabledAt",
        CASE
          WHEN group_row.id IS NULL THEN false
          ELSE EXISTS (
            SELECT 1
            FROM skill_group_allowed_emails allowed
            WHERE allowed.group_id = group_row.id
              AND allowed.email = $2
          )
        END AS invited,
        CASE WHEN group_row.id IS NULL THEN NULL ELSE item.id END AS "skillItemId"
      FROM skill_releases release
      JOIN skill_sources source ON source.id = release.source_id
      LEFT JOIN skill_group_items item
        ON item.release_id = release.id
        AND item.source_id = source.id
      LEFT JOIN skill_groups group_row
        ON group_row.id = item.group_id
        AND group_row.owner_user_id = source.owner_user_id
      WHERE release.id = $1
        AND source.kind = 'private_github'
        AND source.tombstoned_at IS NULL
      ORDER BY group_row.id NULLS LAST, item.id NULLS LAST
    `,
    [releaseId, actor.email]
  );
  const resolved = decidePrivateReleaseAccess(result.rows, actor);
  if (!resolved) {
    throw new PrivateReleaseAccessError();
  }
  return resolved;
}

export async function recordContentFetch(
  client: PrivateReleaseAccessDatabase,
  grant: PrivateReleaseGrant
): Promise<void> {
  await client.query(
    `
      INSERT INTO analytics_events (
        event_name, group_id, skill_item_id, actor_user_id, source_id, release_id, device_id
      ) VALUES ('content_fetch', $1, $2, $3, $4, $5, $6)
    `,
    [
      grant.groupId,
      grant.skillItemId,
      grant.actorUserId,
      grant.sourceId,
      grant.releaseId,
      grant.deviceId
    ]
  );
}

export function samePrivateRelease(
  first: PrivateReleaseGrant,
  second: PrivateReleaseGrant
): boolean {
  return first.releaseId === second.releaseId
    && first.sourceId === second.sourceId
    && first.commitSha === second.commitSha
    && first.treeSha === second.treeSha
    && first.skillMdSha === second.skillMdSha;
}

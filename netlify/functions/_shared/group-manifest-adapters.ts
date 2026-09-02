import type { Pool, PoolClient } from "pg";
import {
  requireGroupAccess,
  type GroupAccessActor,
  type GroupAccessCapability,
  type GroupAccessClient
} from "./group-access.js";
import {
  buildGroupManifest,
  type GroupManifest,
  type GroupManifestInput
} from "./group-manifest.js";

type GroupManifestRow = {
  groupId: string;
  groupName: string;
  groupDescription: string | null;
  groupSlug: string;
  groupRevision: number;
  itemId: string | null;
  itemKind: GroupManifestInput["items"][number]["kind"] | null;
  itemPosition: number | null;
  itemName: string | null;
  itemDescription: string | null;
  itemNote: string | null;
  itemCatalogSkillId: string | null;
  itemGithubUrl: string | null;
  metadataOnlyReason: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  sourceNormalizedRoot: string | null;
  sourceCatalogSkillId: string | null;
  sourceRepositoryId: string | null;
  sourceRepositorySlug: string | null;
  sourceTombstonedAt: Date | string | null;
  releaseId: string | null;
  releaseSourceId: string | null;
  releaseCommitSha: string | null;
  releaseTreeSha: string | null;
  releaseSkillMdSha: string | null;
  syncedName: string | null;
  syncedDescription: string | null;
  syncedGithubUrl: string | null;
  syncedIdentityStatus: string | null;
  syncedCatalogSkillId: string | null;
  syncedIsLocalOnly: boolean | null;
  syncedIsCurrent: boolean | null;
};

export type PublicManifestLinkHint = {
  catalogSkillId: string | null;
  githubUrl: string | null;
  isLocalOnly: boolean;
};

export type GroupManifestView = {
  manifest: GroupManifest;
  linkHints: ReadonlyMap<string, PublicManifestLinkHint>;
};

export type GroupManifestPool = Pick<Pool, "connect">;

function groupNotFound(): Response {
  return new Response("Group not found", { status: 404 });
}

function sourceFromRow(row: GroupManifestRow) {
  if (!row.sourceId || !row.sourceKind) {
    return null;
  }
  return {
    id: row.sourceId,
    kind: row.sourceKind,
    normalizedRoot: row.sourceNormalizedRoot,
    catalogSkillId: row.sourceCatalogSkillId,
    repositoryId: row.sourceRepositoryId,
    repositorySlug: row.sourceRepositorySlug,
    tombstonedAt: row.sourceTombstonedAt
  };
}

function releaseFromRow(row: GroupManifestRow) {
  if (!row.releaseId) {
    return null;
  }
  return {
    id: row.releaseId,
    sourceId: row.releaseSourceId,
    commitSha: row.releaseCommitSha,
    treeSha: row.releaseTreeSha,
    skillMdSha: row.releaseSkillMdSha
  };
}

function githubUrlFromRow(row: GroupManifestRow): string | null {
  if (row.syncedGithubUrl || row.itemGithubUrl) {
    return row.syncedGithubUrl || row.itemGithubUrl;
  }
  if (
    row.sourceKind === "public_github"
    && row.sourceRepositorySlug
    && row.sourceNormalizedRoot
    && row.releaseCommitSha
  ) {
    return `https://github.com/${row.sourceRepositorySlug}/tree/${row.releaseCommitSha}/${row.sourceNormalizedRoot}`;
  }
  return null;
}

export async function loadGroupManifestInput(
  groupId: string,
  client: GroupAccessClient
): Promise<{ input: GroupManifestInput; linkHints: Map<string, PublicManifestLinkHint> }> {
  const result = await client.query<GroupManifestRow>(
    `
      SELECT
        g.id AS "groupId",
        g.name AS "groupName",
        g.description AS "groupDescription",
        g.slug AS "groupSlug",
        g.revision AS "groupRevision",
        i.id AS "itemId",
        i.kind AS "itemKind",
        i.position AS "itemPosition",
        i.name AS "itemName",
        i.description AS "itemDescription",
        i.note AS "itemNote",
        i.catalog_skill_id AS "itemCatalogSkillId",
        i.github_url AS "itemGithubUrl",
        i.metadata_only_reason AS "metadataOnlyReason",
        source.id AS "sourceId",
        source.kind AS "sourceKind",
        source.normalized_root AS "sourceNormalizedRoot",
        source.catalog_skill_id AS "sourceCatalogSkillId",
        source.repository_id AS "sourceRepositoryId",
        source.repository_slug AS "sourceRepositorySlug",
        source.tombstoned_at AS "sourceTombstonedAt",
        release.id AS "releaseId",
        release.source_id AS "releaseSourceId",
        release.commit_sha AS "releaseCommitSha",
        release.tree_sha AS "releaseTreeSha",
        release.skill_md_sha AS "releaseSkillMdSha",
        synced.name AS "syncedName",
        synced.description AS "syncedDescription",
        synced.github_url AS "syncedGithubUrl",
        synced.identity_status AS "syncedIdentityStatus",
        synced.catalog_skill_id AS "syncedCatalogSkillId",
        synced.is_local_only AS "syncedIsLocalOnly",
        synced.is_current AS "syncedIsCurrent"
      FROM skill_groups g
      LEFT JOIN skill_group_items i ON i.group_id = g.id
      LEFT JOIN skill_sources source ON source.id = i.source_id
      LEFT JOIN skill_releases release ON release.id = i.release_id
      LEFT JOIN synced_skills synced ON synced.id = i.synced_skill_id
      WHERE g.id = $1
      ORDER BY i.position ASC, i.id ASC
    `,
    [groupId]
  );
  const first = result.rows[0];
  if (!first) {
    throw groupNotFound();
  }

  const linkHints = new Map<string, PublicManifestLinkHint>();
  const items = result.rows.flatMap((row) => {
    if (!row.itemId || !row.itemKind || row.itemPosition === null) {
      return [];
    }
    const catalogSkillId = row.itemCatalogSkillId || row.syncedCatalogSkillId;
    linkHints.set(row.itemId, {
      catalogSkillId,
      githubUrl: githubUrlFromRow(row),
      isLocalOnly: row.syncedIsLocalOnly === true
    });
    return [{
      id: row.itemId,
      kind: row.itemKind,
      position: row.itemPosition,
      name: row.syncedName || row.itemName || catalogSkillId || row.itemGithubUrl || "Skill",
      description: row.syncedDescription || row.itemDescription,
      note: row.itemNote,
      catalogSkillId: row.itemCatalogSkillId,
      metadataOnlyReason: row.metadataOnlyReason,
      source: sourceFromRow(row),
      release: releaseFromRow(row),
      syncedIdentity: row.itemKind === "synced"
        ? {
            identityStatus: row.syncedIdentityStatus,
            catalogSkillId: row.syncedCatalogSkillId,
            isCurrent: row.syncedIsCurrent
          }
        : null
    }];
  });

  return {
    input: {
      group: {
        id: first.groupId,
        name: first.groupName,
        description: first.groupDescription,
        slug: first.groupSlug,
        revision: first.groupRevision
      },
      items
    },
    linkHints
  };
}

function publicInput(input: GroupManifestInput): GroupManifestInput {
  return {
    group: input.group,
    items: input.items.map((item) => item.source?.kind === "private_github"
      ? {
          ...item,
          source: null,
          release: null,
          metadataOnlyReason: "source_unavailable"
        }
      : item)
  };
}

function publicLinkHints(
  input: GroupManifestInput,
  hints: ReadonlyMap<string, PublicManifestLinkHint>
): Map<string, PublicManifestLinkHint> {
  const privateItemIds = new Set(
    input.items
      .filter((item) => item.source?.kind === "private_github")
      .map((item) => item.id)
  );
  return new Map([...hints].map(([itemId, hint]) => [
    itemId,
    privateItemIds.has(itemId)
      ? { catalogSkillId: null, githubUrl: null, isLocalOnly: true }
      : hint
  ]));
}

async function buildAuthorizedManifest(
  actor: GroupAccessActor,
  groupId: string,
  capability: GroupAccessCapability,
  client: GroupAccessClient,
  publicView: boolean
): Promise<GroupManifestView> {
  await requireGroupAccess(actor, groupId, capability, client);
  const loaded = await loadGroupManifestInput(groupId, client);
  return {
    manifest: buildGroupManifest(publicView ? publicInput(loaded.input) : loaded.input),
    linkHints: publicView
      ? publicLinkHints(loaded.input, loaded.linkHints)
      : loaded.linkHints
  };
}

export async function buildMemberGroupManifest(
  actor: GroupAccessActor,
  groupId: string,
  client: GroupAccessClient
): Promise<GroupManifestView> {
  return buildAuthorizedManifest(actor, groupId, "read", client, false);
}

export async function buildPublicGroupManifestByRoute(
  handle: string,
  groupSlug: string,
  client: GroupAccessClient
): Promise<GroupManifestView> {
  const route = await client.query<{ id: string }>(
    `
      SELECT g.id
      FROM skill_groups g
      JOIN users owner ON owner.id = g.owner_user_id
      WHERE lower(owner.handle) = lower($1)
        AND owner.profile_published = true
        AND g.slug = $2
      LIMIT 1
    `,
    [handle, groupSlug]
  );
  const groupId = route.rows[0]?.id;
  if (!groupId) {
    throw groupNotFound();
  }
  return buildAuthorizedManifest(null, groupId, "public", client, true);
}

export async function buildDeviceGroupManifestByRoute(
  actor: GroupAccessActor,
  handle: string,
  groupSlug: string,
  client: GroupAccessClient
): Promise<GroupManifestView> {
  const route = await client.query<{ id: string }>(
    `
      SELECT g.id
      FROM skill_groups g
      JOIN users owner ON owner.id = g.owner_user_id
      WHERE lower(owner.handle) = lower($1)
        AND g.slug = $2
      LIMIT 1
    `,
    [handle, groupSlug]
  );
  const groupId = route.rows[0]?.id;
  if (!groupId) {
    throw groupNotFound();
  }

  const access = await requireGroupAccess(actor, groupId, "read", client);
  const loaded = await loadGroupManifestInput(groupId, client);
  const publicView = access.accessRole === "public";
  return {
    manifest: buildGroupManifest(publicView ? publicInput(loaded.input) : loaded.input),
    linkHints: publicView
      ? publicLinkHints(loaded.input, loaded.linkHints)
      : loaded.linkHints
  };
}

export async function withGroupManifestSnapshot<T>(
  pool: GroupManifestPool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original read or authorization error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function readMemberGroupManifest(
  pool: GroupManifestPool,
  actor: GroupAccessActor,
  groupId: string
): Promise<GroupManifestView> {
  return withGroupManifestSnapshot(pool, (client) =>
    buildMemberGroupManifest(actor, groupId, client));
}

export async function readPublicGroupManifestByRoute(
  pool: GroupManifestPool,
  handle: string,
  groupSlug: string
): Promise<GroupManifestView> {
  return withGroupManifestSnapshot(pool, (client) =>
    buildPublicGroupManifestByRoute(handle, groupSlug, client));
}

export async function readDeviceGroupManifestByRoute(
  pool: GroupManifestPool,
  actor: GroupAccessActor,
  handle: string,
  groupSlug: string
): Promise<GroupManifestView> {
  return withGroupManifestSnapshot(pool, (client) =>
    buildDeviceGroupManifestByRoute(actor, handle, groupSlug, client));
}

import type { PoolClient } from "pg";

export type SkillSourceInput =
  | {
      kind: "catalog";
      normalizedRoot: string;
      catalogSkillId: string;
    }
  | {
      kind: "public_github";
      normalizedRoot: string;
      repositoryId: string;
      repositorySlug: string;
    }
  | {
      kind: "private_github";
      normalizedRoot: string;
      repositoryId: string;
      repositorySlug: string;
      ownerUserId: string;
      brokerInstallationId: string;
    };

export type SkillReleaseInput = {
  sourceId: string;
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
  createdBy: string;
};

export type GroupItemReleaseState =
  | { kind: "release"; sourceId: string; releaseId: string }
  | { kind: "metadata_only"; sourceId?: string | null; reason: string };

export class GroupStorageError extends Error {
  constructor(
    readonly code: "group_not_found" | "item_not_found" | "source_not_found" | "source_in_use",
    message: string
  ) {
    super(message);
    this.name = "GroupStorageError";
  }
}

export async function lockGroupForMutation(client: PoolClient, groupId: string) {
  const result = await client.query<{ revision: number }>(
    "SELECT revision FROM skill_groups WHERE id = $1 FOR UPDATE",
    [groupId]
  );
  if (!result.rowCount) {
    throw new GroupStorageError("group_not_found", "Group not found");
  }
  return result.rows[0].revision;
}

export async function incrementGroupRevision(client: PoolClient, groupId: string) {
  const result = await client.query<{ revision: number }>(
    `
      UPDATE skill_groups
      SET revision = revision + 1, updated_at = now()
      WHERE id = $1
      RETURNING revision
    `,
    [groupId]
  );
  if (!result.rowCount) {
    throw new GroupStorageError("group_not_found", "Group not found");
  }
  return result.rows[0].revision;
}

export async function createSkillSource(client: PoolClient, input: SkillSourceInput) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO skill_sources (
        kind,
        normalized_root,
        catalog_skill_id,
        repository_id,
        repository_slug,
        owner_user_id,
        broker_installation_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [
      input.kind,
      input.normalizedRoot,
      input.kind === "catalog" ? input.catalogSkillId : null,
      input.kind === "catalog" ? null : input.repositoryId,
      input.kind === "catalog" ? null : input.repositorySlug,
      input.kind === "private_github" ? input.ownerUserId : null,
      input.kind === "private_github" ? input.brokerInstallationId : null
    ]
  );
  return result.rows[0].id;
}

export async function appendSkillRelease(client: PoolClient, input: SkillReleaseInput) {
  const source = await client.query<{ id: string }>(
    "SELECT id FROM skill_sources WHERE id = $1 AND tombstoned_at IS NULL FOR SHARE",
    [input.sourceId]
  );
  if (!source.rowCount) {
    throw new GroupStorageError("source_not_found", "Active skill source not found");
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO skill_releases (
        source_id, commit_sha, tree_sha, skill_md_sha, created_by
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (source_id, commit_sha, tree_sha, skill_md_sha) DO NOTHING
      RETURNING id
    `,
    [input.sourceId, input.commitSha, input.treeSha, input.skillMdSha, input.createdBy]
  );
  if (inserted.rowCount) {
    return inserted.rows[0].id;
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM skill_releases
      WHERE source_id = $1
        AND commit_sha = $2
        AND tree_sha = $3
        AND skill_md_sha = $4
    `,
    [input.sourceId, input.commitSha, input.treeSha, input.skillMdSha]
  );
  return existing.rows[0].id;
}

export async function tombstoneSkillSource(
  client: PoolClient,
  sourceId: string,
  tombstonedAt = new Date()
) {
  const source = await client.query<{ tombstoned_at: Date | null }>(
    "SELECT tombstoned_at FROM skill_sources WHERE id = $1 FOR UPDATE",
    [sourceId]
  );
  if (!source.rowCount) {
    throw new GroupStorageError("source_not_found", "Skill source not found");
  }
  if (source.rows[0].tombstoned_at) {
    return false;
  }

  const reference = await client.query(
    "SELECT 1 FROM skill_group_items WHERE source_id = $1 LIMIT 1",
    [sourceId]
  );
  if (reference.rowCount) {
    throw new GroupStorageError("source_in_use", "Skill source is referenced by a group item");
  }

  await client.query(
    "UPDATE skill_sources SET tombstoned_at = $2, updated_at = $2 WHERE id = $1",
    [sourceId, tombstonedAt]
  );
  return true;
}

export async function selectGroupItemRelease(
  client: PoolClient,
  groupId: string,
  itemId: string,
  state: GroupItemReleaseState
) {
  await lockGroupForMutation(client, groupId);
  const current = await client.query<{
    source_id: string | null;
    release_id: string | null;
    metadata_only_reason: string | null;
  }>(
    `
      SELECT source_id, release_id, metadata_only_reason
      FROM skill_group_items
      WHERE id = $1 AND group_id = $2
      FOR UPDATE
    `,
    [itemId, groupId]
  );
  if (!current.rowCount) {
    throw new GroupStorageError("item_not_found", "Group item not found");
  }

  const next = state.kind === "release"
    ? { sourceId: state.sourceId, releaseId: state.releaseId, reason: null }
    : { sourceId: state.sourceId ?? null, releaseId: null, reason: state.reason.trim() };
  const previous = current.rows[0];
  if (
    previous.source_id === next.sourceId
    && previous.release_id === next.releaseId
    && previous.metadata_only_reason === next.reason
  ) {
    return false;
  }

  await client.query(
    `
      UPDATE skill_group_items
      SET source_id = $3, release_id = $4, metadata_only_reason = $5
      WHERE id = $1 AND group_id = $2
    `,
    [itemId, groupId, next.sourceId, next.releaseId, next.reason]
  );
  await incrementGroupRevision(client, groupId);
  return true;
}

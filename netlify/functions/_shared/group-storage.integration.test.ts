import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg, { type Pool, type PoolClient } from "pg";
import {
  addGroupItemWithClient,
  deleteGroupItemWithClient,
  reorderGroupItemsWithClient
} from "./group-items.js";
import {
  readMemberGroupManifest,
  readPublicGroupManifestByRoute
} from "./group-manifest-adapters.js";
import {
  appendSkillRelease,
  createSkillSource,
  GroupStorageError,
  selectGroupItemRelease,
  tombstoneSkillSource
} from "./group-storage.js";
import {
  bindGithubBrokerInstallation,
  PrivateSourceError,
  upsertOwnerPrivateSource
} from "./private-sources.js";
import {
  loadOwnerPrivateReleasePackage,
  PrivateReleaseError,
  registerOwnerPrivateRelease
} from "./private-releases.js";
import {
  PrivateReleaseAccessError,
  recordContentFetch,
  requirePrivateReleaseAccess
} from "./private-release-access.js";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("AUTH_TEST_DATABASE_URL is required for group storage integration tests");
}

const migrationsDirectory = fileURLToPath(
  new URL("../../database/migrations", import.meta.url)
);
const sharedStorageMigration = "20260827150000_add_shared_skill_release_storage";

async function migrationFiles() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(migrationsDirectory, entry.name, "migration.sql")
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function schemaName() {
  return `group_storage_${randomUUID().replaceAll("-", "")}`;
}

async function createSchema(client: PoolClient, schema: string) {
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
}

async function applyMigrations(
  client: PoolClient,
  predicate: (name: string) => boolean = () => true
) {
  for (const migration of await migrationFiles()) {
    if (predicate(migration.name)) {
      await client.query(await readFile(migration.path, "utf8"));
    }
  }
}

async function withMigratedSchema(run: (pool: Pool, schema: string) => Promise<void>) {
  const schema = schemaName();
  const admin = new pg.Pool({ connectionString });
  const client = await admin.connect();
  try {
    await createSchema(client, schema);
    await applyMigrations(client);
  } finally {
    client.release();
  }

  const pool = new pg.Pool({
    connectionString,
    options: `-c search_path=${schema},public`
  });
  try {
    await run(pool, schema);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createUser(pool: Pool, label: string) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, clerk_user_id, email, display_name) VALUES ($1, $2, $3, $4)`,
    [id, `storage-${label}-${id}`, `${id}@example.com`, label]
  );
  return id;
}

async function createGroup(pool: Pool, userId: string, slug: string = randomUUID()) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO skill_groups (owner_user_id, name, slug)
      VALUES ($1, 'Storage group', $2)
      RETURNING id
    `,
    [userId, slug]
  );
  return result.rows[0].id;
}

const sha = {
  commit: "1111111111111111111111111111111111111111",
  tree: "2222222222222222222222222222222222222222",
  skill: "3333333333333333333333333333333333333333"
};

test("shared storage migration preserves production-shaped legacy groups", async () => {
  const schema = schemaName();
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await createSchema(client, schema);
    await applyMigrations(client, (name) => name < sharedStorageMigration);
    const userId = randomUUID();
    const groupId = randomUUID();
    const itemId = randomUUID();
    await client.query(
      `INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, $3)`,
      [userId, `legacy-${userId}`, `${userId}@example.com`]
    );
    await client.query(
      `INSERT INTO skill_groups (id, owner_user_id, name, slug) VALUES ($1, $2, 'Legacy', 'legacy')`,
      [groupId, userId]
    );
    await client.query(
      `
        INSERT INTO skill_group_items (id, group_id, kind, catalog_skill_id, position)
        VALUES ($1, $2, 'catalog', 'owner/repo:legacy', 0)
      `,
      [itemId, groupId]
    );

    await applyMigrations(client, (name) => name === sharedStorageMigration);
    const group = await client.query<{ revision: number }>(
      "SELECT revision FROM skill_groups WHERE id = $1",
      [groupId]
    );
    const item = await client.query<{
      catalog_skill_id: string;
      source_id: string | null;
      release_id: string | null;
      metadata_only_reason: string | null;
    }>(
      `
        SELECT catalog_skill_id, source_id, release_id, metadata_only_reason
        FROM skill_group_items
        WHERE id = $1
      `,
      [itemId]
    );

    assert.equal(group.rows[0].revision, 1);
    assert.deepEqual(item.rows[0], {
      catalog_skill_id: "owner/repo:legacy",
      source_id: null,
      release_id: null,
      metadata_only_reason: null
    });
  } finally {
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});

test("sources preserve repository identity and releases are append-only", async () => {
  await withMigratedSchema(async (pool) => {
    const userId = await createUser(pool, "owner");
    await bindGithubBrokerInstallation(pool, {
      ownerUserId: userId,
      installationId: "123456789",
      accountId: "7001",
      accountLogin: "owner",
      accountType: "User"
    });
    const client = await pool.connect();
    try {
      const catalogSourceId = await createSkillSource(client, {
        kind: "catalog",
        normalizedRoot: "skills/review",
        catalogSkillId: "owner/repo:review"
      });
      const repositoryId = "900719925474099312345";
      const publicSourceId = await createSkillSource(client, {
        kind: "public_github",
        normalizedRoot: "skills/public",
        repositoryId,
        repositorySlug: "owner/repo"
      });
      await createSkillSource(client, {
        kind: "private_github",
        normalizedRoot: "skills/private",
        repositoryId: "987654321",
        repositorySlug: "owner/private-skills",
        ownerUserId: userId,
        brokerInstallationId: "123456789"
      });
      const storedRepo = await client.query<{ repository_id: string }>(
        "SELECT repository_id FROM skill_sources WHERE id = $1",
        [publicSourceId]
      );
      assert.equal(storedRepo.rows[0].repository_id, repositoryId);

      await assert.rejects(
        client.query(
          `INSERT INTO skill_sources (kind, normalized_root) VALUES ('catalog', 'skills/invalid')`
        ),
        (error: any) => error.code === "23514"
      );
      await assert.rejects(
        client.query(
          `
            INSERT INTO skill_sources (kind, normalized_root, catalog_skill_id)
            VALUES ('catalog', 'skills\\invalid', 'owner/repo:backslash')
          `
        ),
        (error: any) => error.code === "23514"
      );

      const releaseId = await appendSkillRelease(client, {
        sourceId: catalogSourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "catalog:owner/repo:review"
      });
      const duplicateId = await appendSkillRelease(client, {
        sourceId: catalogSourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "catalog:owner/repo:review"
      });
      assert.equal(duplicateId, releaseId);
      await assert.rejects(
        client.query("UPDATE skill_releases SET created_by = 'changed' WHERE id = $1", [releaseId]),
        (error: any) => error.code === "55000"
      );
      await assert.rejects(
        client.query("DELETE FROM skill_releases WHERE id = $1", [releaseId]),
        (error: any) => error.code === "55000"
      );
      await assert.rejects(
        client.query("DELETE FROM skill_sources WHERE id = $1", [publicSourceId]),
        (error: any) => error.code === "55000"
      );
      await assert.rejects(
        client.query(
          `
            INSERT INTO skill_group_items (group_id, kind, source_id)
            VALUES ($1, 'catalog', $2)
          `,
          [await createGroup(pool, userId), catalogSourceId]
        ),
        (error: any) => error.code === "23514"
      );
    } finally {
      client.release();
    }
  });
});

test("owner release registration is idempotent and opaque release loading stays owner-scoped", async () => {
  await withMigratedSchema(async (pool) => {
    const ownerUserId = await createUser(pool, "release-owner");
    const otherUserId = await createUser(pool, "release-other");
    await bindGithubBrokerInstallation(pool, {
      ownerUserId,
      installationId: "123456789",
      accountId: "7001",
      accountLogin: "owner",
      accountType: "User"
    });
    const source = await upsertOwnerPrivateSource(pool, {
      ownerUserId,
      installationId: "123456789",
      repositoryId: "987654321",
      repositorySlug: "owner/private-skills",
      normalizedRoot: "skills/example"
    });
    const skillPackage = {
      coordinates: {
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill
      },
      entries: []
    };
    let pinnedCoordinates: unknown;
    const broker = {
      async listRepositories() {
        return [{
          id: "987654321",
          fullName: "renamed/private-skills",
          name: "private-skills",
          isPrivate: true,
          defaultBranch: "main"
        }];
      },
      async fetchCurrentSkillPackage() { return skillPackage; },
      async fetchPinnedSkillPackage(
        _installationId: string,
        _repository: unknown,
        _root: string,
        expected: unknown
      ) {
        pinnedCoordinates = expected;
        return skillPackage;
      }
    };

    const first = await registerOwnerPrivateRelease(pool, broker, {
      ownerUserId,
      sourceId: source.id
    });
    const duplicate = await registerOwnerPrivateRelease(pool, broker, {
      ownerUserId,
      sourceId: source.id
    });
    assert.equal(duplicate.id, first.id);
    assert.equal(
      Number((await pool.query(
        "SELECT count(*) FROM skill_releases WHERE source_id = $1",
        [source.id]
      )).rows[0].count),
      1
    );

    const loaded = await loadOwnerPrivateReleasePackage(pool, broker, {
      ownerUserId,
      releaseId: first.id
    });
    assert.equal(loaded.release.sourceId, source.id);
    assert.deepEqual(pinnedCoordinates, skillPackage.coordinates);

    await assert.rejects(
      loadOwnerPrivateReleasePackage(pool, broker, {
        ownerUserId: otherUserId,
        releaseId: first.id
      }),
      (error: unknown) => error instanceof PrivateReleaseError
        && error.code === "release_unavailable"
    );
  });
});

test("group and item deletion preserve reusable sources and immutable releases", async () => {
  await withMigratedSchema(async (pool) => {
    const userId = await createUser(pool, "deletion");
    const groupId = await createGroup(pool, userId);
    const client = await pool.connect();
    let sourceId: string;
    let releaseId: string;
    try {
      sourceId = await createSkillSource(client, {
        kind: "catalog",
        normalizedRoot: "skills/delete-test",
        catalogSkillId: "owner/repo:delete-test"
      });
      releaseId = await appendSkillRelease(client, {
        sourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "catalog:owner/repo:delete-test"
      });
    } finally {
      client.release();
    }
    const item = await pool.query<{ id: string }>(
      `
        INSERT INTO skill_group_items (
          group_id, kind, catalog_skill_id, source_id, release_id, position
        ) VALUES ($1, 'catalog', 'owner/repo:delete-test', $2, $3, 0)
        RETURNING id
      `,
      [groupId, sourceId, releaseId]
    );
    await pool.query(
      "INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, 'member@example.com')",
      [groupId]
    );

    await assert.rejects(
      transaction(pool, (transactionClient) => tombstoneSkillSource(transactionClient, sourceId)),
      (error) => error instanceof GroupStorageError && error.code === "source_in_use"
    );
    await transaction(pool, async (transactionClient) => {
      assert.equal(
        await deleteGroupItemWithClient(transactionClient, groupId, item.rows[0].id),
        true
      );
    });
    assert.equal(
      Number((await pool.query("SELECT count(*) FROM skill_releases WHERE id = $1", [releaseId])).rows[0].count),
      1
    );
    assert.equal(
      await transaction(pool, (transactionClient) => tombstoneSkillSource(transactionClient, sourceId)),
      true
    );
    await assert.rejects(
      transaction(pool, (transactionClient) => appendSkillRelease(transactionClient, {
        sourceId,
        commitSha: "4444444444444444444444444444444444444444",
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "catalog:owner/repo:delete-test"
      })),
      (error) => error instanceof GroupStorageError && error.code === "source_not_found"
    );

    const secondGroupId = await createGroup(pool, userId);
    const secondClient = await pool.connect();
    let secondSourceId: string;
    let secondReleaseId: string;
    try {
      secondSourceId = await createSkillSource(secondClient, {
        kind: "catalog",
        normalizedRoot: "skills/group-delete",
        catalogSkillId: "owner/repo:group-delete"
      });
      secondReleaseId = await appendSkillRelease(secondClient, {
        sourceId: secondSourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "catalog:owner/repo:group-delete"
      });
    } finally {
      secondClient.release();
    }
    await pool.query(
      `
        INSERT INTO skill_group_items (
          group_id, kind, catalog_skill_id, source_id, release_id, position
        ) VALUES ($1, 'catalog', 'owner/repo:group-delete', $2, $3, 0)
      `,
      [secondGroupId, secondSourceId, secondReleaseId]
    );
    await pool.query(
      "INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, 'other@example.com')",
      [secondGroupId]
    );
    await pool.query("DELETE FROM skill_groups WHERE id = $1", [secondGroupId]);

    assert.equal(
      Number((await pool.query("SELECT count(*) FROM skill_sources WHERE id = $1", [secondSourceId])).rows[0].count),
      1
    );
    assert.equal(
      Number((await pool.query("SELECT count(*) FROM skill_releases WHERE id = $1", [secondReleaseId])).rows[0].count),
      1
    );
    assert.equal(
      Number((await pool.query("SELECT count(*) FROM skill_group_allowed_emails WHERE group_id = $1", [secondGroupId])).rows[0].count),
      0
    );
  });
});

test("publishable group changes increment revisions exactly once", async () => {
  await withMigratedSchema(async (pool) => {
    const userId = await createUser(pool, "revision");
    const groupId = await createGroup(pool, userId);
    const add = (name: string) => transaction(pool, (client) => addGroupItemWithClient(
      client,
      groupId,
      { kind: "catalog", catalogSkillId: `owner/repo:${name}`, name }
    ));
    await Promise.all([add("one"), add("two")]);

    const ordered = await pool.query<{ id: string; position: number }>(
      "SELECT id, position FROM skill_group_items WHERE group_id = $1 ORDER BY position",
      [groupId]
    );
    assert.deepEqual(ordered.rows.map((row) => row.position), [0, 1]);
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      3
    );

    const originalOrder = ordered.rows.map((row) => row.id);
    const unchanged = await transaction(pool, (client) => reorderGroupItemsWithClient(
      client,
      groupId,
      originalOrder
    ));
    assert.equal(unchanged.changed, false);
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      3
    );

    const reversed = [...originalOrder].reverse();
    const changed = await transaction(pool, (client) => reorderGroupItemsWithClient(
      client,
      groupId,
      reversed
    ));
    assert.equal(changed.changed, true);
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      4
    );

    const deleted = await transaction(pool, (client) => deleteGroupItemWithClient(
      client,
      groupId,
      reversed[1]
    ));
    assert.equal(deleted, true);
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      5
    );

    const client = await pool.connect();
    let sourceId: string;
    let releaseId: string;
    try {
      sourceId = await createSkillSource(client, {
        kind: "catalog",
        normalizedRoot: "skills/one",
        catalogSkillId: "owner/repo:release-one"
      });
      releaseId = await appendSkillRelease(client, {
        sourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "catalog:owner/repo:release-one"
      });
    } finally {
      client.release();
    }
    assert.equal(
      await transaction(pool, (transactionClient) => selectGroupItemRelease(
        transactionClient,
        groupId,
        reversed[0],
        { kind: "release", sourceId, releaseId }
      )),
      true
    );
    assert.equal(
      await transaction(pool, (transactionClient) => selectGroupItemRelease(
        transactionClient,
        groupId,
        reversed[0],
        { kind: "release", sourceId, releaseId }
      )),
      false
    );
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      6
    );

    const otherClient = await pool.connect();
    let otherSourceId: string;
    try {
      otherSourceId = await createSkillSource(otherClient, {
        kind: "catalog",
        normalizedRoot: "skills/other",
        catalogSkillId: "owner/repo:other"
      });
    } finally {
      otherClient.release();
    }
    await assert.rejects(
      transaction(pool, (transactionClient) => selectGroupItemRelease(
        transactionClient,
        groupId,
        reversed[0],
        { kind: "release", sourceId: otherSourceId, releaseId }
      )),
      (error: any) => error.code === "23503"
    );
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      6
    );

    assert.equal(
      await transaction(pool, (transactionClient) => selectGroupItemRelease(
        transactionClient,
        groupId,
        reversed[0],
        { kind: "metadata_only", sourceId, reason: "catalog coordinates unavailable" }
      )),
      true
    );
    assert.equal(
      await transaction(pool, (transactionClient) => selectGroupItemRelease(
        transactionClient,
        groupId,
        reversed[0],
        { kind: "metadata_only", sourceId, reason: "catalog coordinates unavailable" }
      )),
      false
    );
    assert.equal(
      (await pool.query("SELECT revision FROM skill_groups WHERE id = $1", [groupId])).rows[0].revision,
      7
    );
  });
});

test("authorized adapters read pinned releases from one migrated snapshot", async () => {
  await withMigratedSchema(async (pool) => {
    const ownerId = await createUser(pool, "manifest-owner");
    await bindGithubBrokerInstallation(pool, {
      ownerUserId: ownerId,
      installationId: "456123",
      accountId: "7002",
      accountLogin: "manifest-owner",
      accountType: "User"
    });
    await pool.query(
      `UPDATE users SET handle = 'manifest-owner', profile_published = true WHERE id = $1`,
      [ownerId]
    );
    const groupId = await createGroup(pool, ownerId, "shared-manifest");
    await pool.query(
      `UPDATE skill_groups SET visibility = 'public', revision = 12 WHERE id = $1`,
      [groupId]
    );

    const client = await pool.connect();
    let sourceId: string;
    let releaseId: string;
    try {
      sourceId = await createSkillSource(client, {
        kind: "private_github",
        normalizedRoot: "skills/private-review",
        repositoryId: "987654321",
        repositorySlug: "secret/private-skills",
        ownerUserId: ownerId,
        brokerInstallationId: "456123"
      });
      releaseId = await appendSkillRelease(client, {
        sourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: "github:secret/private-skills"
      });
    } finally {
      client.release();
    }
    await pool.query(
      `
        INSERT INTO skill_group_items (
          group_id, kind, github_url, name, description, position, source_id, release_id
        ) VALUES (
          $1, 'github', 'https://github.com/secret/private-skills/tree/main/skills/private-review',
          'Private review', 'Private review workflow.', 0, $2, $3
        )
      `,
      [groupId, sourceId, releaseId]
    );

    const member = await readMemberGroupManifest(
      pool,
      { id: ownerId, email: "owner@example.com" },
      groupId
    );
    assert.equal(member.manifest.group.revision, 12);
    assert.equal(member.manifest.items[0].installability.status, "installable");
    assert.equal(JSON.stringify(member.manifest).includes("secret/private-skills"), false);

    const publicView = await readPublicGroupManifestByRoute(
      pool,
      "manifest-owner",
      "shared-manifest"
    );
    assert.deepEqual(publicView.manifest.items[0].installability, {
      status: "metadata_only",
      reason: "source_unavailable"
    });
    assert.equal(JSON.stringify(publicView).includes("secret/private-skills"), false);
  });
});

test("private release access follows live restricted-group ACLs and records metadata-only audit", async () => {
  await withMigratedSchema(async (pool) => {
    const ownerId = await createUser(pool, "access-owner");
    const recipientId = await createUser(pool, "access-recipient");
    const outsiderId = await createUser(pool, "access-outsider");
    const recipientEmail = `${recipientId}@example.com`;
    const outsiderEmail = `${outsiderId}@example.com`;
    await bindGithubBrokerInstallation(pool, {
      ownerUserId: ownerId,
      installationId: "888001",
      accountId: "9101",
      accountLogin: "access-owner",
      accountType: "User"
    });
    const groupId = await createGroup(pool, ownerId, "private-access");
    await pool.query("UPDATE skill_groups SET visibility = 'restricted' WHERE id = $1", [groupId]);
    await pool.query(
      "INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, $2)",
      [groupId, recipientEmail]
    );

    const client = await pool.connect();
    let sourceId: string;
    let releaseId: string;
    try {
      sourceId = await createSkillSource(client, {
        kind: "private_github",
        normalizedRoot: "skills/private-access",
        repositoryId: "991001",
        repositorySlug: "access-owner/private-skills",
        ownerUserId: ownerId,
        brokerInstallationId: "888001"
      });
      releaseId = await appendSkillRelease(client, {
        sourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: ownerId
      });
    } finally {
      client.release();
    }
    const item = await pool.query<{ id: string }>(
      `
        INSERT INTO skill_group_items (
          group_id, kind, github_url, name, description, position, source_id, release_id
        ) VALUES (
          $1, 'github', 'https://github.com/access-owner/private-skills/tree/main/skills/private-access',
          'Private access', 'Private access fixture.', 0, $2, $3
        )
        RETURNING id
      `,
      [groupId, sourceId, releaseId]
    );
    const itemId = item.rows[0].id;

    const ownerGrant = await requirePrivateReleaseAccess(
      pool,
      { userId: ownerId, email: `${ownerId}@example.com` },
      releaseId
    );
    assert.equal(ownerGrant.accessRole, "owner");

    const recipientGrant = await requirePrivateReleaseAccess(
      pool,
      { userId: recipientId, email: recipientEmail },
      releaseId
    );
    assert.equal(recipientGrant.accessRole, "invited");
    assert.equal(recipientGrant.groupId, groupId);
    assert.equal(recipientGrant.skillItemId, itemId);

    await assert.rejects(
      requirePrivateReleaseAccess(
        pool,
        { userId: outsiderId, email: outsiderEmail },
        releaseId
      ),
      (error: unknown) => error instanceof PrivateReleaseAccessError
    );

    await recordContentFetch(pool, recipientGrant);
    const audit = await pool.query(
      `
        SELECT
          event_name, group_id, skill_item_id, actor_user_id, source_id, release_id,
          device_id, created_at
        FROM analytics_events
        WHERE event_name = 'content_fetch'
      `
    );
    assert.equal(audit.rowCount, 1);
    assert.deepEqual(
      {
        eventName: audit.rows[0].event_name,
        groupId: audit.rows[0].group_id,
        skillItemId: audit.rows[0].skill_item_id,
        actorUserId: audit.rows[0].actor_user_id,
        sourceId: audit.rows[0].source_id,
        releaseId: audit.rows[0].release_id,
        deviceId: audit.rows[0].device_id,
        hasTime: audit.rows[0].created_at instanceof Date
      },
      {
        eventName: "content_fetch",
        groupId,
        skillItemId: itemId,
        actorUserId: recipientId,
        sourceId,
        releaseId,
        deviceId: null,
        hasTime: true
      }
    );
    await assert.rejects(
      pool.query("INSERT INTO analytics_events (event_name) VALUES ('content_fetch')"),
      (error: any) => error.code === "23514"
    );

    await pool.query(
      "DELETE FROM skill_group_allowed_emails WHERE group_id = $1 AND email = $2",
      [groupId, recipientEmail]
    );
    await assert.rejects(
      requirePrivateReleaseAccess(pool, { userId: recipientId, email: recipientEmail }, releaseId),
      (error: unknown) => error instanceof PrivateReleaseAccessError
    );

    await pool.query(
      "INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, $2)",
      [groupId, recipientEmail]
    );
    await pool.query("UPDATE skill_groups SET disabled_at = now() WHERE id = $1", [groupId]);
    await assert.rejects(
      requirePrivateReleaseAccess(pool, { userId: recipientId, email: recipientEmail }, releaseId),
      (error: unknown) => error instanceof PrivateReleaseAccessError
    );
    await pool.query("UPDATE skill_groups SET disabled_at = NULL, visibility = 'public' WHERE id = $1", [groupId]);
    await assert.rejects(
      requirePrivateReleaseAccess(pool, { userId: recipientId, email: recipientEmail }, releaseId),
      (error: unknown) => error instanceof PrivateReleaseAccessError
    );
    await pool.query("UPDATE skill_groups SET visibility = 'restricted' WHERE id = $1", [groupId]);
    assert.equal(
      (await requirePrivateReleaseAccess(
        pool,
        { userId: recipientId, email: recipientEmail },
        releaseId
      )).accessRole,
      "invited"
    );

    await pool.query("DELETE FROM users WHERE id = $1", [recipientId]);
    assert.equal(
      (await pool.query(
        "SELECT actor_user_id FROM analytics_events WHERE event_name = 'content_fetch'"
      )).rows[0].actor_user_id,
      null
    );
  });
});

test("private release access rejects unlinked releases and cross-owner group substitution", async () => {
  await withMigratedSchema(async (pool) => {
    const ownerId = await createUser(pool, "substitution-owner");
    const otherOwnerId = await createUser(pool, "substitution-other-owner");
    const recipientId = await createUser(pool, "substitution-recipient");
    const recipientEmail = `${recipientId}@example.com`;
    await bindGithubBrokerInstallation(pool, {
      ownerUserId: ownerId,
      installationId: "888002",
      accountId: "9102",
      accountLogin: "substitution-owner",
      accountType: "User"
    });
    const otherGroupId = await createGroup(pool, otherOwnerId, "cross-owner");
    await pool.query("UPDATE skill_groups SET visibility = 'restricted' WHERE id = $1", [otherGroupId]);
    await pool.query(
      "INSERT INTO skill_group_allowed_emails (group_id, email) VALUES ($1, $2)",
      [otherGroupId, recipientEmail]
    );

    const client = await pool.connect();
    let sourceId: string;
    let linkedReleaseId: string;
    let unlinkedReleaseId: string;
    try {
      sourceId = await createSkillSource(client, {
        kind: "private_github",
        normalizedRoot: "skills/substitution",
        repositoryId: "991002",
        repositorySlug: "substitution-owner/private-skills",
        ownerUserId: ownerId,
        brokerInstallationId: "888002"
      });
      linkedReleaseId = await appendSkillRelease(client, {
        sourceId,
        commitSha: sha.commit,
        treeSha: sha.tree,
        skillMdSha: sha.skill,
        createdBy: ownerId
      });
      unlinkedReleaseId = await appendSkillRelease(client, {
        sourceId,
        commitSha: "4".repeat(40),
        treeSha: "5".repeat(40),
        skillMdSha: "6".repeat(40),
        createdBy: ownerId
      });
    } finally {
      client.release();
    }
    await pool.query(
      `
        INSERT INTO skill_group_items (
          group_id, kind, github_url, name, description, position, source_id, release_id
        ) VALUES (
          $1, 'github', 'https://github.com/substitution-owner/private-skills/tree/main/skills/substitution',
          'Substitution', 'Cross-owner fixture.', 0, $2, $3
        )
      `,
      [otherGroupId, sourceId, linkedReleaseId]
    );

    for (const releaseId of [linkedReleaseId, unlinkedReleaseId]) {
      await assert.rejects(
        requirePrivateReleaseAccess(
          pool,
          { userId: recipientId, email: recipientEmail },
          releaseId
        ),
        (error: unknown) => error instanceof PrivateReleaseAccessError
      );
    }
    assert.equal(
      (await requirePrivateReleaseAccess(
        pool,
        { userId: ownerId, email: `${ownerId}@example.com` },
        unlinkedReleaseId
      )).accessRole,
      "owner"
    );
  });
});

test("private source bindings enforce owner identity and preserve repository identity", async () => {
  await withMigratedSchema(async (pool) => {
    const ownerId = await createUser(pool, "private-owner");
    const otherOwnerId = await createUser(pool, "other-owner");
    await bindGithubBrokerInstallation(pool, {
      ownerUserId: ownerId,
      installationId: "555001",
      accountId: "8001",
      accountLogin: "private-owner",
      accountType: "User"
    });
    await assert.rejects(
      pool.query(
        `
          INSERT INTO skill_sources (
            kind, normalized_root, repository_id, repository_slug, owner_user_id,
            broker_installation_id
          ) VALUES ('private_github', 'skills/../other', '99000', 'private-owner/skills', $1, '555001')
        `,
        [ownerId]
      ),
      (error: any) => error.code === "23514"
    );
    await assert.rejects(
      bindGithubBrokerInstallation(pool, {
        ownerUserId: otherOwnerId,
        installationId: "555001",
        accountId: "8001",
        accountLogin: "private-owner",
        accountType: "User"
      }),
      (error: unknown) => error instanceof PrivateSourceError
        && error.code === "installation_conflict"
    );
    await bindGithubBrokerInstallation(pool, {
      ownerUserId: otherOwnerId,
      installationId: "555002",
      accountId: "8002",
      accountLogin: "other-owner",
      accountType: "User"
    });
    await assert.rejects(
      pool.query(
        `
          INSERT INTO skill_sources (
            kind, normalized_root, repository_id, repository_slug, owner_user_id,
            broker_installation_id
          ) VALUES ('private_github', 'skills/wrong-owner', '99003', 'other-owner/skills', $1, '555002')
        `,
        [ownerId]
      ),
      (error: any) => error.code === "23503"
    );

    const source = await upsertOwnerPrivateSource(pool, {
      ownerUserId: ownerId,
      installationId: "555001",
      repositoryId: "99001",
      repositorySlug: "private-owner/skills",
      normalizedRoot: "skills/example"
    });
    const renamed = await upsertOwnerPrivateSource(pool, {
      ownerUserId: ownerId,
      installationId: "555001",
      repositoryId: "99001",
      repositorySlug: "private-owner/renamed-skills",
      normalizedRoot: "skills/example"
    });
    assert.equal(renamed.id, source.id);
    assert.equal(renamed.repositorySlug, "private-owner/renamed-skills");

    await assert.rejects(
      pool.query(
        `
          INSERT INTO skill_sources (
            kind, normalized_root, repository_id, repository_slug, owner_user_id,
            broker_installation_id
          ) VALUES ('private_github', 'skills/missing', '99002', 'other/repo', $1, '999999')
        `,
        [ownerId]
      ),
      (error: any) => error.code === "23503"
    );
  });
});

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  GitHubBrokerClient,
  GitHubBrokerError,
  type BrokerRepository
} from "./github-broker.js";
import { appendSkillRelease } from "./group-storage.js";
import {
  SkillPackageValidationError,
  type SkillPackage,
  type SkillPackageCoordinates
} from "./skill-package.js";
import {
  PrivateReleaseAccessError,
  type PrivateReleaseGrant
} from "./private-release-access.js";

type PrivateReleaseDatabase = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

type PrivateReleaseSourceRow = {
  sourceId: string;
  installationId: string;
  repositoryId: string;
  repositorySlug: string;
  normalizedRoot: string;
};

type PrivateReleaseRow = PrivateReleaseSourceRow & SkillPackageCoordinates & {
  releaseId: string;
  createdAt: string;
};

export type PrivateSkillRelease = {
  id: string;
  sourceId: string;
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
  createdAt: string;
};

export class PrivateReleaseError extends Error {
  constructor(
    readonly code: "source_unavailable" | "release_unavailable" | "repository_unavailable",
    message: string
  ) {
    super(message);
    this.name = "PrivateReleaseError";
  }
}

export type PrivateReleaseBroker = Pick<
  GitHubBrokerClient,
  "listRepositories" | "fetchCurrentSkillPackage" | "fetchPinnedSkillPackage"
>;

async function requireOwnerSource(
  client: PrivateReleaseDatabase,
  ownerUserId: string,
  sourceId: string
): Promise<PrivateReleaseSourceRow> {
  const result = await client.query<PrivateReleaseSourceRow>(
    `
      SELECT
        id AS "sourceId",
        broker_installation_id AS "installationId",
        repository_id AS "repositoryId",
        repository_slug AS "repositorySlug",
        normalized_root AS "normalizedRoot"
      FROM skill_sources
      WHERE id = $1
        AND kind = 'private_github'
        AND owner_user_id = $2
        AND tombstoned_at IS NULL
      LIMIT 1
    `,
    [sourceId, ownerUserId]
  );
  if (!result.rows[0]) {
    throw new PrivateReleaseError("source_unavailable", "Private source is unavailable");
  }
  return result.rows[0];
}

async function requireOwnerRelease(
  client: PrivateReleaseDatabase,
  ownerUserId: string,
  releaseId: string
): Promise<PrivateReleaseRow> {
  const result = await client.query<PrivateReleaseRow>(
    `
      SELECT
        release.id AS "releaseId",
        release.source_id AS "sourceId",
        release.commit_sha AS "commitSha",
        release.tree_sha AS "treeSha",
        release.skill_md_sha AS "skillMdSha",
        release.created_at::text AS "createdAt",
        source.broker_installation_id AS "installationId",
        source.repository_id AS "repositoryId",
        source.repository_slug AS "repositorySlug",
        source.normalized_root AS "normalizedRoot"
      FROM skill_releases release
      JOIN skill_sources source ON source.id = release.source_id
      WHERE release.id = $1
        AND source.kind = 'private_github'
        AND source.owner_user_id = $2
        AND source.tombstoned_at IS NULL
      LIMIT 1
    `,
    [releaseId, ownerUserId]
  );
  if (!result.rows[0]) {
    throw new PrivateReleaseError("release_unavailable", "Private release is unavailable");
  }
  return result.rows[0];
}

async function liveRepository(
  broker: PrivateReleaseBroker,
  source: PrivateReleaseSourceRow
): Promise<BrokerRepository> {
  const repository = (await broker.listRepositories(source.installationId))
    .find((candidate) => candidate.id === source.repositoryId && candidate.isPrivate);
  if (!repository) {
    throw new PrivateReleaseError("repository_unavailable", "Private repository is unavailable");
  }
  return repository;
}

async function readRelease(
  client: PrivateReleaseDatabase,
  releaseId: string,
  sourceId: string
): Promise<PrivateSkillRelease> {
  const result = await client.query<PrivateSkillRelease>(
    `
      SELECT
        id,
        source_id AS "sourceId",
        commit_sha AS "commitSha",
        tree_sha AS "treeSha",
        skill_md_sha AS "skillMdSha",
        created_at::text AS "createdAt"
      FROM skill_releases
      WHERE id = $1 AND source_id = $2
    `,
    [releaseId, sourceId]
  );
  if (!result.rows[0]) {
    throw new PrivateReleaseError("release_unavailable", "Private release is unavailable");
  }
  return result.rows[0];
}

export async function registerOwnerPrivateRelease(
  pool: Pool,
  broker: PrivateReleaseBroker,
  input: { ownerUserId: string; sourceId: string }
): Promise<PrivateSkillRelease> {
  const source = await requireOwnerSource(pool, input.ownerUserId, input.sourceId);
  const repository = await liveRepository(broker, source);
  const skillPackage = await broker.fetchCurrentSkillPackage(
    source.installationId,
    repository,
    source.normalizedRoot
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await requireOwnerSource(client, input.ownerUserId, input.sourceId);
    const releaseId = await appendSkillRelease(client, {
      sourceId: source.sourceId,
      ...skillPackage.coordinates,
      createdBy: input.ownerUserId
    });
    const release = await readRelease(client, releaseId, source.sourceId);
    await client.query("COMMIT");
    return release;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadOwnerPrivateReleasePackage(
  pool: Pick<Pool, "query">,
  broker: PrivateReleaseBroker,
  input: { ownerUserId: string; releaseId: string }
): Promise<{ release: PrivateSkillRelease; package: SkillPackage }> {
  const row = await requireOwnerRelease(pool, input.ownerUserId, input.releaseId);
  const repository = await liveRepository(broker, row);
  const coordinates = {
    commitSha: row.commitSha,
    treeSha: row.treeSha,
    skillMdSha: row.skillMdSha
  };
  const skillPackage = await broker.fetchPinnedSkillPackage(
    row.installationId,
    repository,
    row.normalizedRoot,
    coordinates
  );
  return {
    release: {
      id: row.releaseId,
      sourceId: row.sourceId,
      ...coordinates,
      createdAt: row.createdAt
    },
    package: skillPackage
  };
}

export async function loadAuthorizedPrivateReleasePackage(
  broker: PrivateReleaseBroker,
  grant: PrivateReleaseGrant
): Promise<SkillPackage> {
  const repository = await liveRepository(broker, grant);
  return broker.fetchPinnedSkillPackage(
    grant.installationId,
    repository,
    grant.normalizedRoot,
    {
      commitSha: grant.commitSha,
      treeSha: grant.treeSha,
      skillMdSha: grant.skillMdSha
    }
  );
}

export function privateReleaseResponse(error: unknown): Response {
  if (error instanceof PrivateReleaseError || error instanceof PrivateReleaseAccessError) {
    return new Response("Private release is unavailable", { status: 404 });
  }
  if (error instanceof GitHubBrokerError) {
    if (error.code === "rate_limited") {
      return new Response("GitHub is temporarily unavailable", {
        status: 503,
        headers: error.retryAfterSeconds
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : undefined
      });
    }
    const status = error.code === "package_invalid" || error.code === "skill_root_missing"
      ? 422
      : 502;
    return new Response(
      status === 422 ? "Private package is invalid" : "GitHub Broker is unavailable",
      { status }
    );
  }
  if (error instanceof SkillPackageValidationError) {
    return new Response("Private package is invalid", { status: 422 });
  }
  return new Response("Private release request failed", { status: 500 });
}

export type PrivateReleaseTransactionClient = PoolClient;

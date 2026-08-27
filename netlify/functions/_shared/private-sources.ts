import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  GitHubBrokerClient,
  GitHubBrokerError,
  type BrokerInstallation,
  type BrokerRepository
} from "./github-broker.js";

export type PrivateSourceDatabase = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

export type BrokerInstallationBinding = {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
};

export type PrivateSkillSource = {
  id: string;
  installationId: string;
  repositoryId: string;
  repositorySlug: string;
  normalizedRoot: string;
  createdAt: string;
};

export type PrivateSourceView = {
  installations: Array<BrokerInstallationBinding & { repositories: BrokerRepository[] }>;
  sources: PrivateSkillSource[];
};

export class PrivateSourceError extends Error {
  constructor(
    readonly code:
      | "invalid_root"
      | "installation_not_found"
      | "installation_conflict"
      | "repository_not_found"
      | "source_conflict",
    message: string
  ) {
    super(message);
    this.name = "PrivateSourceError";
  }
}

export function normalizePrivateSkillRoot(value: unknown): string {
  if (typeof value !== "string") {
    throw new PrivateSourceError("invalid_root", "Skill root must be a string");
  }
  const root = value.trim();
  if (!root || root.length > 1000) {
    throw new PrivateSourceError("invalid_root", "Skill root must be between 1 and 1000 characters");
  }
  if (root === ".") return root;
  if (
    root.startsWith("/")
    || root.endsWith("/")
    || root.includes("\\")
    || root.includes("//")
    || /[\u0000-\u001f\u007f]/.test(root)
  ) {
    throw new PrivateSourceError("invalid_root", "Skill root is invalid");
  }
  const segments = root.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PrivateSourceError("invalid_root", "Skill root is invalid");
  }
  return root;
}

export async function bindGithubBrokerInstallation(
  client: PrivateSourceDatabase,
  input: { ownerUserId: string } & BrokerInstallation
): Promise<BrokerInstallationBinding> {
  const result = await client.query<BrokerInstallationBinding>(
    `
      INSERT INTO github_broker_installations (
        owner_user_id, installation_id, account_id, account_login, account_type
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (installation_id)
      DO UPDATE SET
        account_id = EXCLUDED.account_id,
        account_login = EXCLUDED.account_login,
        account_type = EXCLUDED.account_type,
        updated_at = now()
      WHERE github_broker_installations.owner_user_id = EXCLUDED.owner_user_id
      RETURNING
        installation_id AS "installationId",
        account_id AS "accountId",
        account_login AS "accountLogin",
        account_type AS "accountType"
    `,
    [
      input.ownerUserId,
      input.installationId,
      input.accountId,
      input.accountLogin,
      input.accountType
    ]
  );
  if (!result.rows[0]) {
    throw new PrivateSourceError(
      "installation_conflict",
      "Broker installation is already bound to another owner"
    );
  }
  return result.rows[0];
}

export async function listOwnerBrokerInstallations(
  client: PrivateSourceDatabase,
  ownerUserId: string
): Promise<BrokerInstallationBinding[]> {
  const result = await client.query<BrokerInstallationBinding>(
    `
      SELECT
        installation_id AS "installationId",
        account_id AS "accountId",
        account_login AS "accountLogin",
        account_type AS "accountType"
      FROM github_broker_installations
      WHERE owner_user_id = $1
      ORDER BY created_at, installation_id
    `,
    [ownerUserId]
  );
  return result.rows;
}

export async function requireOwnerBrokerInstallation(
  client: PrivateSourceDatabase,
  ownerUserId: string,
  installationId: string
): Promise<BrokerInstallationBinding> {
  const result = await client.query<BrokerInstallationBinding>(
    `
      SELECT
        installation_id AS "installationId",
        account_id AS "accountId",
        account_login AS "accountLogin",
        account_type AS "accountType"
      FROM github_broker_installations
      WHERE owner_user_id = $1 AND installation_id = $2
    `,
    [ownerUserId, installationId]
  );
  if (!result.rows[0]) {
    throw new PrivateSourceError("installation_not_found", "Broker installation is unavailable");
  }
  return result.rows[0];
}

export async function listOwnerPrivateSources(
  client: PrivateSourceDatabase,
  ownerUserId: string
): Promise<PrivateSkillSource[]> {
  const result = await client.query<PrivateSkillSource>(
    `
      SELECT
        id,
        broker_installation_id AS "installationId",
        repository_id AS "repositoryId",
        repository_slug AS "repositorySlug",
        normalized_root AS "normalizedRoot",
        created_at::text AS "createdAt"
      FROM skill_sources
      WHERE kind = 'private_github'
        AND owner_user_id = $1
        AND tombstoned_at IS NULL
      ORDER BY repository_slug, normalized_root, id
    `,
    [ownerUserId]
  );
  return result.rows;
}

export async function upsertOwnerPrivateSource(
  client: PrivateSourceDatabase,
  input: {
    ownerUserId: string;
    installationId: string;
    repositoryId: string;
    repositorySlug: string;
    normalizedRoot: string;
  }
): Promise<PrivateSkillSource> {
  const result = await client.query<PrivateSkillSource>(
    `
      INSERT INTO skill_sources (
        kind,
        normalized_root,
        repository_id,
        repository_slug,
        owner_user_id,
        broker_installation_id
      )
      VALUES ('private_github', $1, $2, $3, $4, $5)
      ON CONFLICT (kind, repository_id, normalized_root)
        WHERE kind IN ('public_github', 'private_github')
      DO UPDATE SET
        repository_slug = EXCLUDED.repository_slug,
        broker_installation_id = EXCLUDED.broker_installation_id,
        updated_at = now()
      WHERE skill_sources.owner_user_id = EXCLUDED.owner_user_id
        AND skill_sources.tombstoned_at IS NULL
      RETURNING
        id,
        broker_installation_id AS "installationId",
        repository_id AS "repositoryId",
        repository_slug AS "repositorySlug",
        normalized_root AS "normalizedRoot",
        created_at::text AS "createdAt"
    `,
    [
      input.normalizedRoot,
      input.repositoryId,
      input.repositorySlug,
      input.ownerUserId,
      input.installationId
    ]
  );
  if (!result.rows[0]) {
    throw new PrivateSourceError("source_conflict", "Private source is unavailable");
  }
  return result.rows[0];
}

function installationMatches(
  stored: BrokerInstallationBinding,
  current: BrokerInstallation
): boolean {
  return stored.installationId === current.installationId && stored.accountId === current.accountId;
}

export async function readOwnerPrivateSourceView(
  pool: Pool,
  broker: GitHubBrokerClient,
  ownerUserId: string
): Promise<PrivateSourceView> {
  const [bindings, sources] = await Promise.all([
    listOwnerBrokerInstallations(pool, ownerUserId),
    listOwnerPrivateSources(pool, ownerUserId)
  ]);
  const installations = await Promise.all(bindings.map(async (binding) => {
    const current = await broker.getInstallation(binding.installationId);
    if (!installationMatches(binding, current)) {
      throw new PrivateSourceError("installation_conflict", "Broker installation owner changed");
    }
    return {
      ...binding,
      accountLogin: current.accountLogin,
      accountType: current.accountType,
      repositories: (await broker.listRepositories(binding.installationId))
        .filter((repository) => repository.isPrivate)
        .sort((left, right) => left.fullName.localeCompare(right.fullName))
    };
  }));
  return { installations, sources };
}

export async function registerOwnerPrivateSource(
  pool: Pool,
  broker: GitHubBrokerClient,
  input: {
    ownerUserId: string;
    installationId: string;
    repositoryId: string;
    root: unknown;
  }
): Promise<PrivateSkillSource> {
  const normalizedRoot = normalizePrivateSkillRoot(input.root);
  const binding = await requireOwnerBrokerInstallation(pool, input.ownerUserId, input.installationId);
  const current = await broker.getInstallation(binding.installationId);
  if (!installationMatches(binding, current)) {
    throw new PrivateSourceError("installation_conflict", "Broker installation owner changed");
  }
  const repositories = await broker.listRepositories(binding.installationId);
  const repository = repositories.find((candidate) => candidate.id === input.repositoryId);
  if (!repository?.isPrivate) {
    throw new PrivateSourceError("repository_not_found", "Private repository is unavailable");
  }
  await broker.verifySkillRoot(binding.installationId, repository, normalizedRoot);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await requireOwnerBrokerInstallation(client, input.ownerUserId, binding.installationId);
    const source = await upsertOwnerPrivateSource(client, {
      ownerUserId: input.ownerUserId,
      installationId: binding.installationId,
      repositoryId: repository.id,
      repositorySlug: repository.fullName,
      normalizedRoot
    });
    await client.query("COMMIT");
    return source;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function privateSourceResponse(error: unknown): Response {
  if (error instanceof PrivateSourceError) {
    const status = error.code === "invalid_root"
      ? 400
      : error.code === "source_conflict" || error.code === "installation_conflict"
        ? 409
        : 404;
    return new Response(error.message, { status });
  }
  if (error instanceof GitHubBrokerError) {
    if (error.code === "rate_limited") {
      return new Response("GitHub is temporarily unavailable", {
        status: 503,
        headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined
      });
    }
    const status = error.code === "skill_root_missing" ? 400 : 502;
    return new Response(
      error.code === "skill_root_missing" ? error.message : "GitHub Broker is unavailable",
      { status }
    );
  }
  return new Response("Private source request failed", { status: 500 });
}

export type PrivateSourceTransactionClient = PoolClient;

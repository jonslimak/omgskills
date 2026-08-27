import { createSign } from "node:crypto";
import { getEnv } from "./env.js";
import {
  BROKER_SKILL_PACKAGE_LIMITS,
  SkillPackageValidationError,
  type SkillPackage,
  type SkillPackageCoordinates,
  validateSkillPackage
} from "./skill-package.js";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPOSITORY_PAGES = 10;
const MAX_BLOB_CONCURRENCY = 6;

export type GitHubBrokerConfig = {
  appId: number;
  privateKey: string;
};

export type BrokerInstallation = {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
};

export type BrokerRepository = {
  id: string;
  fullName: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
};

export class GitHubBrokerError extends Error {
  constructor(
    readonly code:
      | "configuration"
      | "installation_unavailable"
      | "installation_scope"
      | "repository_unavailable"
      | "skill_root_missing"
      | "package_invalid"
      | "rate_limited"
      | "upstream",
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "GitHubBrokerError";
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createBrokerAppJwt(config: GitHubBrokerConfig, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000) - 60;
  const unsigned = [
    encodeJson({ alg: "RS256", typ: "JWT" }),
    encodeJson({ iat: issuedAt, exp: issuedAt + 600, iss: String(config.appId) })
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(config.privateKey, "base64url")}`;
}

export function githubBrokerConfigFromEnv(): GitHubBrokerConfig {
  const appIdValue = getEnv("OMGSKILLS_GITHUB_BROKER_APP_ID")?.trim();
  const privateKeyValue = getEnv("OMGSKILLS_GITHUB_BROKER_PRIVATE_KEY")?.trim();
  const appId = Number(appIdValue);
  if (!Number.isSafeInteger(appId) || appId < 1 || !privateKeyValue) {
    throw new GitHubBrokerError("configuration", "GitHub Broker App is not configured");
  }
  return {
    appId,
    privateKey: privateKeyValue.replace(/\\n/g, "\n")
  };
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^[0-9]+$/.test(normalized) || normalized === "0") {
    throw new GitHubBrokerError("upstream", `GitHub returned an invalid ${label}`);
  }
  return normalized;
}

function retryAfterSeconds(response: Response, now = Date.now()): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  const direct = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(3600, Math.max(1, Math.ceil(direct)));
  const resetAt = response.headers.get("x-ratelimit-reset");
  const reset = resetAt === null ? Number.NaN : Number(resetAt);
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(3600, Math.max(1, Math.ceil(reset - now / 1000)));
  }
  return undefined;
}

function repositoryPath(repository: BrokerRepository): string {
  const [owner, name, ...extra] = repository.fullName.split("/");
  if (!owner || !name || extra.length > 0) {
    throw new GitHubBrokerError("upstream", "GitHub returned an invalid repository name");
  }
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function requireSha(value: unknown, label: string): string {
  const sha = String(value ?? "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new GitHubBrokerError("upstream", `GitHub returned an invalid ${label}`);
  }
  return sha;
}

async function mapConcurrent<T, U>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<U>
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

async function githubRequest(
  fetchImpl: typeof fetch,
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetchImpl(`${API_ORIGIN}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": API_VERSION,
      ...init.headers
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

async function requireJson<T>(
  response: Response,
  code: GitHubBrokerError["code"],
  now = Date.now()
): Promise<T> {
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new GitHubBrokerError(
        "rate_limited",
        "GitHub temporarily limited Broker access",
        retryAfterSeconds(response, now)
      );
    }
    throw new GitHubBrokerError(code, "GitHub Broker request failed");
  }
  return response.json() as Promise<T>;
}

function assertReadOnlyPermissions(permissions: Record<string, string> | undefined): void {
  if (permissions?.contents !== "read") {
    throw new GitHubBrokerError("installation_scope", "Broker token is not contents-read-only");
  }
  for (const [name, level] of Object.entries(permissions)) {
    if (level === "write" || level === "admin") {
      throw new GitHubBrokerError("installation_scope", `Broker token grants ${name}:${level}`);
    }
    if (name !== "contents" && name !== "metadata" && level !== "none") {
      throw new GitHubBrokerError("installation_scope", `Broker token grants unexpected ${name}:${level}`);
    }
  }
}

export class GitHubBrokerClient {
  constructor(
    private readonly config = githubBrokerConfigFromEnv(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  private appJwt(): string {
    return createBrokerAppJwt(this.config, this.now());
  }

  async getInstallation(installationId: string): Promise<BrokerInstallation> {
    const id = positiveId(installationId, "installation ID");
    const response = await githubRequest(
      this.fetchImpl,
      `/app/installations/${encodeURIComponent(id)}`,
      this.appJwt()
    );
    const installation = await requireJson<{
      id?: number;
      repository_selection?: string;
      account?: { id?: number; login?: string; type?: string };
    }>(response, "installation_unavailable", this.now());
    if (installation.repository_selection !== "selected") {
      throw new GitHubBrokerError(
        "installation_scope",
        "Broker installation must use selected repositories"
      );
    }
    const accountType = installation.account?.type;
    if (accountType !== "User" && accountType !== "Organization") {
      throw new GitHubBrokerError("upstream", "GitHub returned an invalid installation account");
    }
    const accountLogin = installation.account?.login?.trim();
    if (!accountLogin) {
      throw new GitHubBrokerError("upstream", "GitHub returned an invalid account login");
    }
    return {
      installationId: positiveId(installation.id, "installation ID"),
      accountId: positiveId(installation.account?.id, "account ID"),
      accountLogin,
      accountType
    };
  }

  private async createInstallationToken(
    installationId: string,
    repositoryIds?: string[]
  ): Promise<string> {
    const body: Record<string, unknown> = { permissions: { contents: "read" } };
    if (repositoryIds) {
      body.repository_ids = repositoryIds.map((id) => Number(positiveId(id, "repository ID")));
    }
    const response = await githubRequest(
      this.fetchImpl,
      `/app/installations/${encodeURIComponent(positiveId(installationId, "installation ID"))}/access_tokens`,
      this.appJwt(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    const token = await requireJson<{
      token?: string;
      expires_at?: string;
      permissions?: Record<string, string>;
      repositories?: Array<{ id?: number }>;
    }>(response, "installation_unavailable", this.now());
    if (!token.token || token.token.length < 1) {
      throw new GitHubBrokerError("upstream", "GitHub did not return an installation token");
    }
    assertReadOnlyPermissions(token.permissions);
    const expiresAt = Date.parse(token.expires_at ?? "");
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt > this.now() + 65 * 60 * 1000) {
      throw new GitHubBrokerError("installation_scope", "Broker token expiry is invalid");
    }
    if (repositoryIds) {
      const returnedIds = token.repositories?.map((repository) => positiveId(repository.id, "repository ID"));
      if (!returnedIds || returnedIds.length !== repositoryIds.length) {
        throw new GitHubBrokerError("repository_unavailable", "Repository is not granted to the Broker App");
      }
      const requested = new Set(repositoryIds);
      if (returnedIds.some((id) => !requested.has(id))) {
        throw new GitHubBrokerError("installation_scope", "Broker token includes an unexpected repository");
      }
    }
    return token.token;
  }

  async listRepositories(installationId: string): Promise<BrokerRepository[]> {
    await this.getInstallation(installationId);
    const token = await this.createInstallationToken(installationId);
    const repositories: BrokerRepository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const response = await githubRequest(
        this.fetchImpl,
        `/installation/repositories?per_page=100&page=${page}`,
        token
      );
      const body = await requireJson<{
        repositories?: Array<{
          id?: number;
          full_name?: string;
          name?: string;
          private?: boolean;
          default_branch?: string;
        }>;
      }>(response, "installation_unavailable", this.now());
      const pageRepositories = body.repositories ?? [];
      for (const repository of pageRepositories) {
        if (!repository.full_name || !repository.name || !repository.default_branch) {
          throw new GitHubBrokerError("upstream", "GitHub returned incomplete repository metadata");
        }
        repositories.push({
          id: positiveId(repository.id, "repository ID"),
          fullName: repository.full_name,
          name: repository.name,
          isPrivate: repository.private === true,
          defaultBranch: repository.default_branch
        });
      }
      if (pageRepositories.length < 100) return repositories;
    }
    throw new GitHubBrokerError("upstream", "Broker repository grant is too large for the pilot");
  }

  async verifySkillRoot(
    installationId: string,
    repository: BrokerRepository,
    normalizedRoot: string
  ): Promise<void> {
    const token = await this.createInstallationToken(installationId, [repository.id]);
    const skillPath = normalizedRoot === "." ? "SKILL.md" : `${normalizedRoot}/SKILL.md`;
    const encodedPath = skillPath.split("/").map(encodeURIComponent).join("/");
    const response = await githubRequest(
      this.fetchImpl,
      `${repositoryPath(repository)}/contents/${encodedPath}`,
      token
    );
    if (response.status === 404) {
      throw new GitHubBrokerError("skill_root_missing", "SKILL.md was not found at that root");
    }
    const file = await requireJson<{ type?: string; name?: string }>(
      response,
      "repository_unavailable",
      this.now()
    );
    if (file.type !== "file" || file.name !== "SKILL.md") {
      throw new GitHubBrokerError("skill_root_missing", "SKILL.md was not found at that root");
    }
  }

  async fetchCurrentSkillPackage(
    installationId: string,
    repository: BrokerRepository,
    normalizedRoot: string
  ): Promise<SkillPackage> {
    return this.fetchSkillPackage(installationId, repository, normalizedRoot);
  }

  async fetchPinnedSkillPackage(
    installationId: string,
    repository: BrokerRepository,
    normalizedRoot: string,
    expected: SkillPackageCoordinates
  ): Promise<SkillPackage> {
    return this.fetchSkillPackage(installationId, repository, normalizedRoot, expected);
  }

  private async fetchSkillPackage(
    installationId: string,
    repository: BrokerRepository,
    normalizedRoot: string,
    expected?: SkillPackageCoordinates
  ): Promise<SkillPackage> {
    const token = await this.createInstallationToken(installationId, [repository.id]);
    const repoPath = repositoryPath(repository);
    let commitSha: string;
    if (expected) {
      commitSha = requireSha(expected.commitSha, "commit SHA");
    } else {
      const branch = encodeURIComponent(repository.defaultBranch);
      const reference = await requireJson<{ object?: { type?: string; sha?: string } }>(
        await githubRequest(this.fetchImpl, `${repoPath}/git/ref/heads/${branch}`, token),
        "repository_unavailable",
        this.now()
      );
      if (reference.object?.type !== "commit") {
        throw new GitHubBrokerError("upstream", "GitHub returned an invalid default-branch reference");
      }
      commitSha = requireSha(reference.object.sha, "commit SHA");
    }

    const commit = await requireJson<{ sha?: string; tree?: { sha?: string } }>(
      await githubRequest(this.fetchImpl, `${repoPath}/git/commits/${commitSha}`, token),
      "repository_unavailable",
      this.now()
    );
    if (requireSha(commit.sha, "commit SHA") !== commitSha) {
      throw new GitHubBrokerError("package_invalid", "GitHub commit did not match the release");
    }
    let treeSha = requireSha(commit.tree?.sha, "tree SHA");
    if (normalizedRoot !== ".") {
      for (const segment of normalizedRoot.split("/")) {
        const tree = await requireJson<{
          sha?: string;
          tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
        }>(
          await githubRequest(this.fetchImpl, `${repoPath}/git/trees/${treeSha}`, token),
          "repository_unavailable",
          this.now()
        );
        if (requireSha(tree.sha, "tree SHA") !== treeSha) {
          throw new GitHubBrokerError("package_invalid", "GitHub tree did not match the release");
        }
        const child = tree.tree?.find((entry) => entry.path === segment);
        if (child?.type !== "tree" || child.mode !== "040000") {
          throw new GitHubBrokerError("skill_root_missing", "Skill root was not found");
        }
        treeSha = requireSha(child.sha, "tree SHA");
      }
    }

    const tree = await requireJson<{
      sha?: string;
      truncated?: boolean;
      tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string; size?: number }>;
    }>(
      await githubRequest(this.fetchImpl, `${repoPath}/git/trees/${treeSha}?recursive=1`, token),
      "repository_unavailable",
      this.now()
    );
    if (tree.truncated) {
      throw new GitHubBrokerError("package_invalid", "GitHub returned a truncated skill tree");
    }
    if (requireSha(tree.sha, "tree SHA") !== treeSha) {
      throw new GitHubBrokerError("package_invalid", "GitHub tree did not match the release");
    }
    const rawEntries = tree.tree ?? [];
    const fileEntries = rawEntries.filter((entry) => entry.type !== "tree");
    if (fileEntries.length > BROKER_SKILL_PACKAGE_LIMITS.maximumFileCount) {
      throw new GitHubBrokerError("package_invalid", "Skill package contains too many files");
    }
    let declaredBytes = 0;
    for (const entry of fileEntries) {
      if (!entry.path || !entry.mode || !entry.type || !entry.sha) {
        throw new GitHubBrokerError("upstream", "GitHub returned incomplete tree metadata");
      }
      if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
        throw new GitHubBrokerError("package_invalid", "Skill package contains an unsupported entry");
      }
      if (!Number.isSafeInteger(entry.size) || Number(entry.size) < 0) {
        throw new GitHubBrokerError("upstream", "GitHub returned an invalid blob size");
      }
      if (Number(entry.size) > BROKER_SKILL_PACKAGE_LIMITS.maximumFileBytes) {
        throw new GitHubBrokerError("package_invalid", "Skill package contains an oversized file");
      }
      if (entry.path === "SKILL.md" && Number(entry.size) > BROKER_SKILL_PACKAGE_LIMITS.maximumSkillMdBytes) {
        throw new GitHubBrokerError("package_invalid", "SKILL.md is too large");
      }
      declaredBytes += Number(entry.size);
      if (declaredBytes > BROKER_SKILL_PACKAGE_LIMITS.maximumTotalBytes) {
        throw new GitHubBrokerError("package_invalid", "Skill package exceeds the Broker delivery limit");
      }
    }

    const entries = await mapConcurrent(fileEntries, MAX_BLOB_CONCURRENCY, async (entry) => {
      const blobSha = requireSha(entry.sha, "blob SHA");
      const blob = await requireJson<{ sha?: string; encoding?: string; content?: string; size?: number }>(
        await githubRequest(this.fetchImpl, `${repoPath}/git/blobs/${blobSha}`, token),
        "repository_unavailable",
        this.now()
      );
      if (requireSha(blob.sha, "blob SHA") !== blobSha || blob.encoding !== "base64" || typeof blob.content !== "string") {
        throw new GitHubBrokerError("package_invalid", "GitHub blob did not match the package tree");
      }
      const data = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
      if (data.byteLength !== entry.size || data.byteLength !== blob.size) {
        throw new GitHubBrokerError("package_invalid", "GitHub blob size did not match the package tree");
      }
      return { path: entry.path!, mode: entry.mode!, blobSha, data };
    });

    const skillMdSha = entries.find((entry) => entry.path === "SKILL.md")?.blobSha;
    if (!skillMdSha) {
      throw new GitHubBrokerError("skill_root_missing", "SKILL.md was not found at that root");
    }
    const coordinates = { commitSha, treeSha, skillMdSha };
    const skillPackage = { coordinates, entries };
    try {
      validateSkillPackage(skillPackage, expected ?? coordinates, BROKER_SKILL_PACKAGE_LIMITS);
    } catch (error) {
      if (error instanceof SkillPackageValidationError) {
        throw new GitHubBrokerError("package_invalid", `Skill package validation failed: ${error.code}`);
      }
      throw error;
    }
    return skillPackage;
  }
}

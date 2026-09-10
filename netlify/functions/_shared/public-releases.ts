import type { SkillSourceInput } from "./group-storage.js";
import type { ValidatedGithubSkill } from "./github-skill-resolution.js";
import {
  loadPublishedSkills,
  type CatalogSkill,
} from "./published-catalog.js";
import type { SkillPackageCoordinates } from "./skill-package.js";

const githubApiOrigin = "https://api.github.com";
const shaPattern = /^[0-9a-f]{40}$/;
const pathSegmentPattern = /^[^/\\\u0000-\u001f\u007f]+$/;

type PublicSourceInput = Extract<SkillSourceInput, { kind: "catalog" | "public_github" }>;

export type PreparedPublicRelease = {
  source: PublicSourceInput;
  coordinates: SkillPackageCoordinates;
  createdBy: string;
};

export type PublicReleaseResolverOptions = {
  fetcher?: typeof fetch;
  githubToken?: string | null;
  loadSkills?: () => Promise<CatalogSkill[]>;
  now?: () => number;
};

export class PublicReleaseResolutionError extends Error {
  constructor(
    readonly code:
      | "catalog_unavailable"
      | "invalid_source"
      | "repository_unavailable"
      | "skill_changed"
      | "rate_limited"
      | "upstream_unavailable",
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PublicReleaseResolutionError";
  }
}

type GithubLocation = {
  owner: string;
  repository: string;
  reference: string | null;
  normalizedRoot: string;
};

type GithubRepository = {
  id: string;
  slug: string;
  defaultBranch: string;
};

function requireSha(value: unknown, label: string): string {
  const sha = String(value ?? "").trim().toLowerCase();
  if (!shaPattern.test(sha)) {
    throw new PublicReleaseResolutionError(
      "repository_unavailable",
      `GitHub returned an invalid ${label}`,
    );
  }
  return sha;
}

function normalizePath(segments: string[]): string {
  if (
    segments.some((segment) =>
      !pathSegmentPattern.test(segment)
      || segment === "."
      || segment === ".."
      || segment.toLowerCase() === ".git"
    )
  ) {
    throw new PublicReleaseResolutionError("invalid_source", "Skill path is invalid");
  }
  const normalized = segments.length === 0 ? "." : segments.join("/");
  if (normalized.length > 1000) {
    throw new PublicReleaseResolutionError("invalid_source", "Skill path is too long");
  }
  return normalized;
}

function decodedPathSegments(segments: string[]): string[] {
  try {
    return segments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new PublicReleaseResolutionError("invalid_source", "Skill path is invalid");
  }
}

function splitGithubRepository(rawUrl: string): { owner: string; repository: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicReleaseResolutionError("invalid_source", "GitHub URL is invalid");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.username
    || url.password
    || url.port
    || !parts[0]
    || !parts[1]
  ) {
    throw new PublicReleaseResolutionError("invalid_source", "GitHub repository is invalid");
  }
  return { owner: parts[0], repository: parts[1].replace(/\.git$/i, "") };
}

function catalogRoot(skill: CatalogSkill): string {
  if (skill.skill_md_path) {
    const segments = skill.skill_md_path.split("/");
    if (segments.pop()?.toLowerCase() !== "skill.md") {
      throw new PublicReleaseResolutionError("invalid_source", "Catalog SKILL.md path is invalid");
    }
    return normalizePath(segments);
  }
  const id = skill.id?.trim();
  const repository = (skill.github_url ?? skill.githubUrl)?.trim();
  if (id && repository && !id.includes(":")) {
    const parsed = splitGithubRepository(repository);
    if (id.toLowerCase() === `${parsed.owner}/${parsed.repository}`.toLowerCase()) {
      return ".";
    }
  }
  throw new PublicReleaseResolutionError(
    "catalog_unavailable",
    "Catalog skill does not include an installable SKILL.md path",
  );
}

function githubLocation(skill: ValidatedGithubSkill): GithubLocation {
  let raw: URL;
  try {
    raw = new URL(skill.rawSkillUrl);
  } catch {
    throw new PublicReleaseResolutionError("invalid_source", "Validated GitHub source is invalid");
  }
  const parts = raw.pathname.split("/").filter(Boolean);
  if (
    raw.protocol !== "https:"
    || raw.hostname !== "raw.githubusercontent.com"
    || parts.length < 4
    || parts.at(-1)?.toLowerCase() !== "skill.md"
  ) {
    throw new PublicReleaseResolutionError("invalid_source", "Validated GitHub source is invalid");
  }
  return {
    owner: parts[0],
    repository: parts[1],
    reference: decodedPathSegments([parts[2]])[0],
    normalizedRoot: normalizePath(decodedPathSegments(parts.slice(3, -1))),
  };
}

function retryAfterSeconds(response: Response, now: number): number | undefined {
  const direct = Number(response.headers.get("retry-after"));
  if (Number.isFinite(direct) && direct > 0) return Math.min(3600, Math.ceil(direct));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(3600, Math.max(1, Math.ceil(reset - now / 1000)));
  }
  return undefined;
}

async function githubJson<T>(
  path: string,
  options: PublicReleaseResolverOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "omgskills-public-release-resolver",
  };
  const token = options.githubToken?.trim()
    || process.env.GITHUB_PUBLIC_READ_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${githubApiOrigin}${path}`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new PublicReleaseResolutionError(
      "upstream_unavailable",
      "GitHub is temporarily unavailable",
    );
  }
  if (response.status === 403 || response.status === 429) {
    throw new PublicReleaseResolutionError(
      "rate_limited",
      "GitHub temporarily limited public release resolution",
      retryAfterSeconds(response, (options.now ?? Date.now)()),
    );
  }
  if (!response.ok) {
    if (response.status >= 500) {
      throw new PublicReleaseResolutionError(
        "upstream_unavailable",
        "GitHub is temporarily unavailable",
      );
    }
    throw new PublicReleaseResolutionError(
      "repository_unavailable",
      "GitHub repository or skill is unavailable",
    );
  }
  try {
    return await response.json() as T;
  } catch {
    throw new PublicReleaseResolutionError(
      "upstream_unavailable",
      "GitHub returned an invalid response",
    );
  }
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function resolveRepository(
  location: GithubLocation,
  options: PublicReleaseResolverOptions,
): Promise<GithubRepository> {
  const repository = await githubJson<{
    id?: number | string;
    full_name?: string;
    default_branch?: string;
  }>(`/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repository)}`, options);
  const id = typeof repository.id === "number"
    && Number.isSafeInteger(repository.id)
    && repository.id > 0
    ? String(repository.id)
    : typeof repository.id === "string"
      ? repository.id
      : "";
  const slug = repository.full_name?.trim();
  const defaultBranch = repository.default_branch?.trim();
  if (!/^\d+$/.test(id) || !slug || !defaultBranch || slug.split("/").length !== 2) {
    throw new PublicReleaseResolutionError(
      "repository_unavailable",
      "GitHub returned incomplete repository metadata",
    );
  }
  return { id, slug, defaultBranch };
}

async function resolveCoordinates(
  location: GithubLocation,
  expectedSkillMdSha: string,
  options: PublicReleaseResolverOptions,
): Promise<{ repository: GithubRepository; coordinates: SkillPackageCoordinates }> {
  const repository = await resolveRepository(location, options);
  const reference = location.reference ?? repository.defaultBranch;
  const [owner, name] = repository.slug.split("/");
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const commit = await githubJson<{
    sha?: string;
    commit?: { tree?: { sha?: string } };
  }>(`${repoPath}/commits/${encodeURIComponent(reference)}`, options);
  const commitSha = requireSha(commit.sha, "commit SHA");
  let treeSha = requireSha(commit.commit?.tree?.sha, "tree SHA");

  for (const segment of location.normalizedRoot === "."
    ? []
    : location.normalizedRoot.split("/")) {
    const tree = await githubJson<{
      sha?: string;
      tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
    }>(`${repoPath}/git/trees/${treeSha}`, options);
    if (requireSha(tree.sha, "tree SHA") !== treeSha) {
      throw new PublicReleaseResolutionError("repository_unavailable", "GitHub tree changed unexpectedly");
    }
    const child = tree.tree?.find((entry) => entry.path === segment);
    if (child?.type !== "tree" || child.mode !== "040000") {
      throw new PublicReleaseResolutionError("repository_unavailable", "Skill root is unavailable");
    }
    treeSha = requireSha(child.sha, "tree SHA");
  }

  const skillTree = await githubJson<{
    sha?: string;
    tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
  }>(`${repoPath}/git/trees/${treeSha}`, options);
  if (requireSha(skillTree.sha, "tree SHA") !== treeSha) {
    throw new PublicReleaseResolutionError("repository_unavailable", "GitHub tree changed unexpectedly");
  }
  const skillMd = skillTree.tree?.find((entry) => entry.path === "SKILL.md");
  if (skillMd?.type !== "blob" || (skillMd.mode !== "100644" && skillMd.mode !== "100755")) {
    throw new PublicReleaseResolutionError("repository_unavailable", "SKILL.md is unavailable");
  }
  const skillMdSha = requireSha(skillMd.sha, "SKILL.md SHA");
  if (skillMdSha !== requireSha(expectedSkillMdSha, "expected SKILL.md SHA")) {
    throw new PublicReleaseResolutionError(
      "skill_changed",
      "SKILL.md changed while its release was being resolved",
    );
  }
  return { repository, coordinates: { commitSha, treeSha, skillMdSha } };
}

export async function resolveCatalogPublicRelease(
  catalogSkillId: string,
  options: PublicReleaseResolverOptions = {},
): Promise<PreparedPublicRelease> {
  let skills: CatalogSkill[];
  try {
    skills = await (options.loadSkills ?? loadPublishedSkills)();
  } catch {
    throw new PublicReleaseResolutionError("catalog_unavailable", "Published catalog is unavailable");
  }
  const skill = skills.find((candidate) => candidate.id === catalogSkillId);
  const githubUrl = skill?.github_url ?? skill?.githubUrl;
  if (!skill || !githubUrl || !skill.skill_md_sha) {
    throw new PublicReleaseResolutionError("catalog_unavailable", "Catalog skill is unavailable");
  }
  const repository = splitGithubRepository(githubUrl);
  const normalizedRoot = catalogRoot(skill);
  const resolved = await resolveCoordinates({
    ...repository,
    reference: null,
    normalizedRoot,
  }, skill.skill_md_sha, options);
  return {
    source: { kind: "catalog", normalizedRoot, catalogSkillId },
    coordinates: resolved.coordinates,
    createdBy: `catalog:${catalogSkillId}`.slice(0, 500),
  };
}

export async function resolveGithubPublicRelease(
  skill: ValidatedGithubSkill,
  options: PublicReleaseResolverOptions = {},
): Promise<PreparedPublicRelease> {
  const location = githubLocation(skill);
  const resolved = await resolveCoordinates(location, skill.skillMdSha, options);
  return {
    source: {
      kind: "public_github",
      normalizedRoot: location.normalizedRoot,
      repositoryId: resolved.repository.id,
      repositorySlug: resolved.repository.slug,
    },
    coordinates: resolved.coordinates,
    createdBy: `github:${resolved.repository.slug}`,
  };
}

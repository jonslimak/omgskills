import { createHash } from "node:crypto";
import type { PublishedCatalogIdentity } from "./published-catalog.js";
import { withTimeout } from "./http.js";

const maximumSkillMdBytes = 2 * 1024 * 1024;
const gitBlobShaPattern = /^[a-f0-9]{40}$/;

export type ValidatedGithubSkill = {
  githubUrl: string;
  rawSkillUrl: string;
  name: string;
  description: string;
  skillMdSha: string;
};

export type CatalogResolution =
  | { status: "resolved"; catalogSkillId: string; reason: "unique" | "canonical" }
  | { status: "unresolved"; reason: "missing" | "ambiguous" | "invalid" };

export type ResolvedGroupItem =
  | {
      kind: "catalog";
      catalogSkillId: string;
      githubUrl: string;
      name: string;
      description: string;
    }
  | {
      kind: "github";
      githubUrl: string;
      name: string;
      description: string;
    };

export class GithubSkillValidationError extends Error {}

function parseGithubSkillUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new GithubSkillValidationError("GitHub URL is invalid");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new GithubSkillValidationError("Only public https://github.com URLs are supported");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo || !/^[a-z0-9_.-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo)) {
    throw new GithubSkillValidationError("GitHub URL must include a valid owner and repo");
  }
  if (parts.length === 2) {
    return url;
  }
  if (
    parts[2] !== "blob" ||
    !parts[3] ||
    parts.length < 5 ||
    parts.at(-1)?.toLowerCase() !== "skill.md"
  ) {
    throw new GithubSkillValidationError("GitHub URL must reference a repository or SKILL.md file");
  }
  return url;
}

function rawSkillMdCandidates(url: URL): string[] {
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo] = parts;
  if (parts[2] === "blob") {
    const branch = parts[3];
    const skillPath = parts.slice(4).join("/");
    return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}`];
  }
  return [
    `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
  ];
}

function frontmatter(markdown: string): string | null {
  return markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? null;
}

function frontmatterField(markdown: string, field: string): string | null {
  const value = frontmatter(markdown)?.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))?.[1];
  return value?.trim().replace(/^["']|["']$/g, "") || null;
}

export function gitBlobSha(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return createHash("sha1").update(header).update(body).digest("hex");
}

export async function validateGithubSkill(
  rawUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<ValidatedGithubSkill> {
  const githubUrl = parseGithubSkillUrl(rawUrl);
  for (const candidate of rawSkillMdCandidates(githubUrl)) {
    const response = await withTimeout(fetcher(candidate), 8_000);
    if (!response.ok) {
      continue;
    }
    const declaredBytes = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumSkillMdBytes) {
      throw new GithubSkillValidationError("SKILL.md is too large");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumSkillMdBytes) {
      throw new GithubSkillValidationError("SKILL.md is too large");
    }
    const markdown = new TextDecoder().decode(bytes);
    const name = frontmatterField(markdown, "name");
    const description = frontmatterField(markdown, "description");
    if (!name || !description) {
      throw new GithubSkillValidationError("SKILL.md must include name and description frontmatter");
    }
    return {
      githubUrl: githubUrl.toString(),
      rawSkillUrl: candidate,
      name,
      description,
      skillMdSha: gitBlobSha(bytes),
    };
  }
  throw new GithubSkillValidationError("Could not find a valid public SKILL.md");
}

export function resolveCatalogSkillId(
  skillMdSha: string,
  identity: PublishedCatalogIdentity | null,
): CatalogResolution {
  const normalizedSha = skillMdSha.trim().toLowerCase();
  if (!gitBlobShaPattern.test(normalizedSha) || !identity?.shaHistory) {
    return { status: "unresolved", reason: "missing" };
  }

  const mappedIds = identity.shaHistory.shaToSkillIds[normalizedSha];
  if (!Array.isArray(mappedIds)) {
    return {
      status: "unresolved",
      reason: mappedIds === undefined ? "missing" : "invalid",
    };
  }

  const liveCandidates = [...new Set(
    mappedIds.filter(
      (id): id is string => typeof id === "string" && identity.liveSkillIds.has(id),
    ),
  )].sort();
  if (liveCandidates.length === 1) {
    return {
      status: "resolved",
      catalogSkillId: liveCandidates[0],
      reason: "unique",
    };
  }
  if (liveCandidates.length === 0) {
    return { status: "unresolved", reason: "missing" };
  }

  const canonical = identity.shaHistory.canonicalBySha?.[normalizedSha];
  if (
    canonical?.confidence === "high" &&
    canonical.reason === "same-repo" &&
    typeof canonical.skillId === "string" &&
    liveCandidates.includes(canonical.skillId)
  ) {
    return {
      status: "resolved",
      catalogSkillId: canonical.skillId,
      reason: "canonical",
    };
  }
  return { status: "unresolved", reason: "ambiguous" };
}

export function groupItemForValidatedGithubSkill(
  skill: ValidatedGithubSkill,
  identity: PublishedCatalogIdentity | null,
): ResolvedGroupItem {
  const resolution = resolveCatalogSkillId(skill.skillMdSha, identity);
  const snapshot = {
    githubUrl: skill.githubUrl,
    name: skill.name,
    description: skill.description,
  };
  return resolution.status === "resolved"
    ? {
        kind: "catalog",
        catalogSkillId: resolution.catalogSkillId,
        ...snapshot,
      }
    : {
        kind: "github",
        ...snapshot,
      };
}

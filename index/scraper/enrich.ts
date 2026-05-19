import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { octokit } from "./client.js";
import type { Skill } from "./types.js";

export interface Candidate {
  id: string;
  skill_md_path: string;
  skill_name_hint?: string;
  ref?: string;
  stars?: number;
  last_updated?: string;
  tags?: string[];
  github_url?: string;
  author_handle?: string;
  repo_description?: string | null;
}

export interface RepoMeta {
  stars: number;
  lastUpdated: string;
  tags: string[];
  githubUrl: string;
}

export interface NegativeCacheFailure {
  scope: "repo" | "candidate";
  key: string;
  reason: string;
  status?: number;
}

export interface EnrichResult {
  skill: Skill | null;
  failure?: NegativeCacheFailure;
}

interface Frontmatter {
  name?: string;
  description?: string;
  tags?: string[];
}

const repoCache = new Map<string, RepoMeta>();

class StableFailure extends Error {
  scope: "repo" | "candidate";
  key: string;
  reason: string;
  status?: number;

  constructor(scope: "repo" | "candidate", key: string, reason: string, message: string, status?: number) {
    super(message);
    this.scope = scope;
    this.key = key;
    this.reason = reason;
    this.status = status;
  }
}

async function getRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  const key = `${owner}/${repo}`;
  const cached = repoCache.get(key);
  if (cached) return cached;

  const { data } = await octokit.rest.repos.get({ owner, repo });
  const meta: RepoMeta = {
    stars: data.stargazers_count ?? 0,
    lastUpdated: data.pushed_at ?? data.updated_at ?? new Date().toISOString(),
    tags: data.topics ?? [],
    githubUrl: data.html_url,
  };
  repoCache.set(key, meta);
  return meta;
}

function fallbackRepoMeta(c: Candidate, owner: string, today: string): RepoMeta {
  return {
    stars: c.stars ?? 0,
    lastUpdated: c.last_updated ?? `${today}T00:00:00.000Z`,
    tags: c.tags ?? [],
    githubUrl: c.github_url ?? `https://github.com/${owner}/${parseOwnerRepo(c.id)?.[1] ?? ""}`,
  };
}

export function seedRepoCache(repoFullName: string, meta: RepoMeta) {
  repoCache.set(repoFullName, meta);
}

export async function getCandidateRepoMeta(c: Candidate, today: string): Promise<RepoMeta | null> {
  const parsed = parseOwnerRepo(c.id);
  if (!parsed) return null;
  const [owner, repo] = parsed;

  if (c.stars !== undefined && c.last_updated && c.github_url) {
    return { stars: c.stars, lastUpdated: c.last_updated, tags: c.tags ?? [], githubUrl: c.github_url };
  }

  try {
    return await getRepoMeta(owner, repo);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 403 && c.github_url) {
      console.warn(`[meta-fallback] ${c.id}: ${e.message ?? "GitHub repo metadata unavailable"}`);
      return fallbackRepoMeta(c, owner, today);
    }
    if (e.status === 404) {
      throw new StableFailure("repo", `${owner}/${repo}`, "repo-404", `${owner}/${repo} not found`, 404);
    }
    throw err;
  }
}

const readmeCache = new Map<string, string | undefined>();
const treeCache = new Map<string, string[]>();
const branchGuessCache = new Map<string, string>();
const failedSkillPathCache = new Map<string, Error>();

function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return createHash("sha1").update(header).update(body).digest("hex");
}

async function getReadmeSnippet(owner: string, repo: string): Promise<string | undefined> {
  const key = `${owner}/${repo}`;
  if (readmeCache.has(key)) return readmeCache.get(key);

  let snippet: string | undefined;
  try {
    for (const name of ["README.md", "README.mdx", "README.txt", "README"]) {
      const file = await fetchRawFile(owner, repo, name);
      if (file?.content) {
        snippet = file.content.slice(0, 5000);
        break;
      }
    }
  } catch {
    // no README
  }
  readmeCache.set(key, snippet);
  return snippet;
}

async function fetchRawFile(
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<{ content: string; sha: string } | null> {
  const refsToTry = ref
    ? [ref]
    : branchGuessCache.has(`${owner}/${repo}`)
      ? [branchGuessCache.get(`${owner}/${repo}`)!]
      : ["main", "master"];

  for (const candidateRef of refsToTry) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${candidateRef}/${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) continue;
      throw new Error(`raw fetch failed (${res.status}) for ${owner}/${repo}/${path}@${candidateRef}`);
    }
    const content = await res.text();
    branchGuessCache.set(`${owner}/${repo}`, candidateRef);
    return {
      content,
      sha: gitBlobSha(content),
    };
  }

  return null;
}

async function listSkillPaths(owner: string, repo: string, ref?: string): Promise<string[]> {
  const key = `${owner}/${repo}@${ref ?? ""}`;
  if (treeCache.has(key)) return treeCache.get(key)!;

  const refsToTry = ref
    ? [ref]
    : branchGuessCache.has(`${owner}/${repo}`)
      ? [branchGuessCache.get(`${owner}/${repo}`)!]
      : ["main", "master"];

  let paths: string[] = [];
  let lastError: unknown;
  for (const candidateRef of refsToTry) {
    try {
      const { data } = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: candidateRef,
        recursive: "1",
      });

      paths = (data.tree ?? [])
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => entry.path!)
        .filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"));
      branchGuessCache.set(`${owner}/${repo}`, candidateRef);
      break;
    } catch (err: unknown) {
      const e = err as { status?: number };
      lastError = err;
      if (e.status !== 404) throw err;
    }
  }
  if (paths.length === 0 && lastError) throw lastError;

  treeCache.set(key, paths);
  return paths;
}

function resolveSkillPathFromHint(paths: string[], hint: string): string | null {
  for (const alias of buildSkillHintAliases(hint)) {
    const normalizedAlias = normalizeSkillKey(alias);
    const exactDirMatches = paths.filter((path) => path.split("/").at(-2) === alias);
    if (exactDirMatches.length > 0) {
      return exactDirMatches.sort((a, b) => a.length - b.length)[0];
    }

    const normalizedDirMatches = paths.filter((path) => normalizeSkillKey(path.split("/").at(-2) ?? "") === normalizedAlias);
    if (normalizedDirMatches.length > 0) {
      return normalizedDirMatches.sort((a, b) => a.length - b.length)[0];
    }

    const partialMatches = paths.filter((path) => path.includes(`/${alias}/`));
    if (partialMatches.length > 0) {
      return partialMatches.sort((a, b) => a.length - b.length)[0];
    }

    const normalizedPartialMatches = paths.filter((path) => normalizeSkillKey(path).includes(normalizedAlias));
    if (normalizedPartialMatches.length > 0) {
      return normalizedPartialMatches.sort((a, b) => a.length - b.length)[0];
    }
  }

  return null;
}

async function fetchSkillFile(
  candidateId: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  skillNameHint?: string,
) {
  const failureCacheKey = `${owner}/${repo}::${path}::${ref ?? ""}::${skillNameHint ?? ""}`;
  const cachedFailure = failedSkillPathCache.get(failureCacheKey);
  if (cachedFailure) throw cachedFailure;

  const tryPath = async (candidatePath: string) => {
    const fileData = await fetchRawFile(owner, repo, candidatePath, ref);
    if (!fileData) {
      throw new StableFailure("candidate", candidateId, "skill-file-404", `${candidatePath} not found`, 404);
    }
    return { fileData, resolvedPath: candidatePath };
  };

  if (path !== "__RESOLVE__") {
    try {
      return await tryPath(path);
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e.status !== 404 || !skillNameHint) throw err;
    }
  }

  if (!skillNameHint) {
    throw new Error(`Unable to resolve SKILL.md path for ${owner}/${repo}`);
  }

  const commonPaths = buildSkillHintAliases(skillNameHint).flatMap((alias) => [
    `${alias}/SKILL.md`,
    `skills/${alias}/SKILL.md`,
    `.claude/skills/${alias}/SKILL.md`,
    `claude/skills/${alias}/SKILL.md`,
    `Claude/skills/${alias}/SKILL.md`,
    `.codex/skills/${alias}/SKILL.md`,
    `codex/skills/${alias}/SKILL.md`,
  ]);
  for (const candidatePath of commonPaths) {
    try {
      return await tryPath(candidatePath);
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e.status && e.status !== 404) throw err;
    }
  }

  const resolvedPath = resolveSkillPathFromHint(
    await listSkillPaths(owner, repo, ref),
    skillNameHint,
  );
  if (!resolvedPath) {
    const err = new StableFailure(
      "candidate",
      candidateId,
      "skill-path-unresolved",
      `Unable to resolve SKILL.md path for ${owner}/${repo}:${skillNameHint}`,
    );
    failedSkillPathCache.set(failureCacheKey, err);
    throw err;
  }
  try {
    return await tryPath(resolvedPath);
  } catch (err: unknown) {
    if (err instanceof StableFailure) failedSkillPathCache.set(failureCacheKey, err);
    throw err;
  }
}

function parseFrontmatter(content: string): Frontmatter | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = content.slice(3, end).trim();
  try {
    const parsed = parseYaml(block);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Frontmatter;
  } catch {
    return null;
  }
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeSkillKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSkillHintAliases(hint: string): string[] {
  const normalized = normalizeSkillKey(hint);
  const aliases = new Set<string>([hint, normalized]);
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length >= 3) {
    aliases.add(parts.slice(1).join("-"));
    aliases.add(`${parts[0]}-${parts.at(-1)}`);
  }
  return [...aliases].filter(Boolean);
}

// Remove lone surrogates — Node.js can produce them from GitHub API responses
// but they produce invalid JSON that strict parsers (Swift) reject.
function stripSurrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      out += s[i];
    }
  }
  return out;
}

function hasCompleteCachedSkill(skill: Skill): boolean {
  return Boolean(
    skill.name &&
    skill.description &&
    skill.github_url &&
    skill.install_cmd &&
    skill.author_handle &&
    Array.isArray(skill.tags) &&
    typeof skill.stars === "number" &&
    skill.last_updated &&
    skill.first_seen
  );
}

function deriveInstallCmd(githubUrl: string, path: string, name: string): string {
  if (path === "SKILL.md") {
    return `git clone ${githubUrl} ~/.claude/skills/${name}`;
  }
  const repoName = githubUrl.split("/").pop() ?? "repo";
  const skillDir = path.replace(/\/SKILL\.md$/, "");
  return `git clone ${githubUrl} /tmp/${repoName} && ln -s /tmp/${repoName}/${skillDir} ~/.claude/skills/${name}`;
}

function parseOwnerRepo(candidateId: string): [string, string] | null {
  // id is "owner/repo" or "owner/repo:skill-name"
  const base = candidateId.includes(":") ? candidateId.split(":")[0] : candidateId;
  const [owner, repo] = base.split("/");
  if (!owner || !repo) return null;
  return [owner, repo];
}

export async function enrichCandidate(
  c: Candidate,
  existingFirstSeen: Map<string, string>,
  existingSkills: Map<string, Skill>,
  today: string,
  prefetchedMeta?: RepoMeta,
): Promise<EnrichResult> {
  const parsed = parseOwnerRepo(c.id);
  if (!parsed) return { skill: null };
  const [owner, repo] = parsed;

  try {
    const meta = prefetchedMeta ?? await getCandidateRepoMeta(c, today);
    if (!meta) return { skill: null };

    const { fileData, resolvedPath } = await fetchSkillFile(
      c.id,
      owner,
      repo,
      c.skill_md_path,
      c.ref,
      c.skill_name_hint,
    );

    // SHA cache: if SKILL.md hasn't changed, reuse existing parsed data
    const existing = existingSkills.get(c.id);
    if (existing?.skill_md_sha && existing.skill_md_sha === fileData.sha && hasCompleteCachedSkill(existing)) {
      const { readme_snippet: _readmeSnippet, ...lightweightExisting } = existing as Skill & { readme_snippet?: string };
      return {
        skill: {
          ...lightweightExisting,
          stars: meta.stars,
          last_updated: meta.lastUpdated,
        },
      };
    }

    const content = fileData.content;
    const fm = parseFrontmatter(content);
    if (!fm?.name || !fm?.description) {
      console.warn(`[skip] ${c.id}: missing name/description in frontmatter`);
      return { skill: null };
    }

    const name = stripSurrogates(normalize(fm.name));
    const description = stripSurrogates(normalize(fm.description));
    const mergedTags = Array.from(new Set([...(fm.tags ?? []), ...meta.tags])).filter(Boolean).map(stripSurrogates);
    const install_cmd = deriveInstallCmd(meta.githubUrl, resolvedPath, name);
    const first_seen = existingFirstSeen.get(c.id) ?? today;

    return {
      skill: {
        id: c.id,
        name,
        description,
        github_url: meta.githubUrl,
        skill_md_path: resolvedPath,
        install_cmd,
        author_handle: owner,
        tags: mergedTags,
        stars: meta.stars,
        last_updated: meta.lastUpdated,
        first_seen,
        skill_md_sha: fileData.sha,
      },
    };
  } catch (err: unknown) {
    if (err instanceof StableFailure) {
      console.warn(`[skip] ${c.id}: ${err.status ?? "?"} ${err.message}`);
      return {
        skill: null,
        failure: {
          scope: err.scope,
          key: err.key,
          reason: err.reason,
          status: err.status,
        },
      };
    }
    const e = err as { status?: number; message?: string };
    console.warn(`[skip] ${c.id}: ${e.status ?? "?"} ${e.message ?? String(err)}`);
    return { skill: null };
  }
}

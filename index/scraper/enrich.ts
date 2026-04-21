import { parse as parseYaml } from "yaml";
import { octokit } from "./client.js";
import type { Skill } from "./types.js";

export interface Candidate {
  id: string;
  skill_md_path: string;
  stars?: number;
  last_updated?: string;
  tags?: string[];
  github_url?: string;
  author_handle?: string;
  repo_description?: string | null;
}

interface RepoMeta {
  stars: number;
  lastUpdated: string;
  tags: string[];
  githubUrl: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  tags?: string[];
}

const repoCache = new Map<string, RepoMeta>();

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

export function seedRepoCache(repoFullName: string, meta: RepoMeta) {
  repoCache.set(repoFullName, meta);
}

const readmeCache = new Map<string, string | undefined>();

async function getReadmeSnippet(owner: string, repo: string): Promise<string | undefined> {
  const key = `${owner}/${repo}`;
  if (readmeCache.has(key)) return readmeCache.get(key);

  let snippet: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getReadme({ owner, repo });
    if ("content" in data && data.content) {
      snippet = Buffer.from(data.content, "base64").toString("utf8").slice(0, 5000);
    }
  } catch {
    // no README
  }
  readmeCache.set(key, snippet);
  return snippet;
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
): Promise<Skill | null> {
  const parsed = parseOwnerRepo(c.id);
  if (!parsed) return null;
  const [owner, repo] = parsed;

  try {
    // Use cached repo metadata (avoids duplicate calls for multi-skill repos)
    const meta = c.stars !== undefined && c.last_updated && c.github_url
      ? { stars: c.stars, lastUpdated: c.last_updated, tags: c.tags ?? [], githubUrl: c.github_url }
      : await getRepoMeta(owner, repo);

    const { data: fileData } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: c.skill_md_path,
    });
    if (Array.isArray(fileData) || fileData.type !== "file" || !("content" in fileData)) {
      console.warn(`[skip] ${c.id}: ${c.skill_md_path} is not a file`);
      return null;
    }

    // SHA cache: if SKILL.md hasn't changed, reuse existing parsed data
    const existing = existingSkills.get(c.id);
    if (existing?.skill_md_sha && existing.skill_md_sha === fileData.sha && hasCompleteCachedSkill(existing)) {
      return {
        ...existing,
        stars: meta.stars,
        last_updated: meta.lastUpdated,
      };
    }

    const content = Buffer.from(fileData.content, "base64").toString("utf8");
    const fm = parseFrontmatter(content);
    if (!fm?.name || !fm?.description) {
      console.warn(`[skip] ${c.id}: missing name/description in frontmatter`);
      return null;
    }

    const readme_snippet = await getReadmeSnippet(owner, repo);

    const name = stripSurrogates(normalize(fm.name));
    const description = stripSurrogates(normalize(fm.description));
    const mergedTags = Array.from(new Set([...(fm.tags ?? []), ...meta.tags])).filter(Boolean).map(stripSurrogates);
    const install_cmd = deriveInstallCmd(meta.githubUrl, c.skill_md_path, name);
    const first_seen = existingFirstSeen.get(c.id) ?? today;

    return {
      id: c.id,
      name,
      description,
      github_url: meta.githubUrl,
      install_cmd,
      author_handle: owner,
      tags: mergedTags,
      readme_snippet: readme_snippet ? stripSurrogates(readme_snippet) : undefined,
      stars: meta.stars,
      last_updated: meta.lastUpdated,
      first_seen,
      skill_md_sha: fileData.sha,
    };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    console.warn(`[skip] ${c.id}: ${e.status ?? "?"} ${e.message ?? String(err)}`);
    return null;
  }
}

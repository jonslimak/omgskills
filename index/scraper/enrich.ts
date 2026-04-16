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

interface Frontmatter {
  name?: string;
  description?: string;
  tags?: string[];
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

export async function enrichCandidate(
  c: Candidate,
  existingFirstSeen: Map<string, string>,
  today: string,
): Promise<Skill | null> {
  const [owner, repo] = c.id.split("/");
  if (!owner || !repo) return null;

  try {
    let stars = c.stars;
    let last_updated = c.last_updated;
    let tags = c.tags ?? [];
    let github_url = c.github_url;

    if (stars === undefined || !last_updated || !github_url) {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      stars = data.stargazers_count ?? 0;
      last_updated = data.pushed_at ?? data.updated_at ?? today;
      tags = data.topics ?? [];
      github_url = data.html_url;
    }

    const { data: fileData } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: c.skill_md_path,
    });
    if (Array.isArray(fileData) || fileData.type !== "file" || !("content" in fileData)) {
      console.warn(`[skip] ${c.id}: ${c.skill_md_path} is not a file`);
      return null;
    }
    const content = Buffer.from(fileData.content, "base64").toString("utf8");
    const fm = parseFrontmatter(content);
    if (!fm?.name || !fm?.description) {
      console.warn(`[skip] ${c.id}: missing name/description in frontmatter`);
      return null;
    }

    let readme_snippet: string | undefined;
    try {
      const { data: readmeData } = await octokit.rest.repos.getReadme({ owner, repo });
      if ("content" in readmeData && readmeData.content) {
        const full = Buffer.from(readmeData.content, "base64").toString("utf8");
        readme_snippet = full.slice(0, 500);
      }
    } catch {
      // no README is fine
    }

    const name = normalize(fm.name);
    const description = normalize(fm.description);
    const mergedTags = Array.from(new Set([...(fm.tags ?? []), ...tags])).filter(Boolean);
    const install_cmd = `git clone ${github_url} ~/.claude/skills/${name}`;
    const first_seen = existingFirstSeen.get(c.id) ?? today;

    return {
      id: c.id,
      name,
      description,
      github_url: github_url!,
      install_cmd,
      author_handle: owner,
      tags: mergedTags,
      readme_snippet,
      stars: stars!,
      last_updated: last_updated!,
      first_seen,
    };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    console.warn(`[skip] ${c.id}: ${e.status ?? "?"} ${e.message ?? String(err)}`);
    return null;
  }
}

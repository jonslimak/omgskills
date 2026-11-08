// "Add skill" on the web: the catalog skills a pasted GitHub link points at.
import type { CatalogSkill } from "./published-catalog.js";

/** Most skills one link lists (a repo can hold hundreds). */
export const GITHUB_LINK_LIMIT = 50;

export type GithubLink = { repo: string; path: string };

/**
 * A github.com link as owner/repo plus a folder inside it ("" for the whole repo).
 * Takes repo, /tree/<ref>/<folder> and /blob/<ref>/<folder>/SKILL.md links; null for anything else.
 * The ref is ignored: the catalog keeps one version of each skill.
 */
export function parseGithubLink(raw: string): GithubLink | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(url.hostname) || url.username || url.password || url.port) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const [owner, rawRepo, kind, ref, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !/^[a-z0-9_.-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo)) return null;
  if (parts.length > 2 && !((kind === "tree" || kind === "blob") && ref)) return null;
  const folder = kind === "blob" && rest.at(-1)?.toLowerCase() === "skill.md" ? rest.slice(0, -1) : rest;
  if (kind === "blob" && folder.length === rest.length) return null;
  return { repo: `${owner}/${repo}`.toLowerCase(), path: folder.join("/").toLowerCase() };
}

/** owner/repo of a catalog skill's GitHub URL, lower case. */
function skillRepo(skill: CatalogSkill): string | null {
  const parsed = parseGithubLink(skill.github_url ?? skill.githubUrl ?? "");
  return parsed ? parsed.repo : null;
}

/** The skill's folder in its repo ("" at the root), lower case; null when the catalog doesn't say. */
function skillFolder(skill: CatalogSkill): string | null {
  if (skill.skill_md_path) {
    const segments = skill.skill_md_path.split("/").filter(Boolean);
    return segments.pop()?.toLowerCase() === "skill.md" ? segments.join("/").toLowerCase() : null;
  }
  const id = skill.id?.toLowerCase();
  return id && !id.includes(":") && id === skillRepo(skill) ? "" : null;
}

export type GithubLinkSkill = { id: string; name: string; description: string | null; githubUrl: string | null };

/**
 * The catalog skills at that link: the one in that exact folder, else every skill under it
 * (the whole repo for a repo link), by name.
 */
export function catalogSkillsForGithubLink(link: GithubLink, skills: CatalogSkill[]): { skills: GithubLinkSkill[]; more: boolean } {
  const inRepo = skills.flatMap(skill => {
    if (!skill.id || skillRepo(skill) !== link.repo) return [];
    const folder = skillFolder(skill);
    return folder === null ? [] : [{ skill, folder }];
  });
  const exact = inRepo.filter(({ folder }) => folder === link.path);
  const found = exact.length ? exact
    : inRepo.filter(({ folder }) => !link.path || folder.startsWith(`${link.path}/`));
  const sorted = found.map(({ skill }) => ({
    id: skill.id!, name: skill.name || skill.id!.split(":").at(-1)!, description: skill.description ?? null,
    githubUrl: skill.github_url ?? skill.githubUrl ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { skills: sorted.slice(0, GITHUB_LINK_LIMIT), more: sorted.length > GITHUB_LINK_LIMIT };
}

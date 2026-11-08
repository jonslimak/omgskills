// "Add skill" on the web: the catalog skills a pasted GitHub link points at.
import type { CatalogSkill } from "./published-catalog.js";

/** Most skills one link lists (a repo can hold hundreds). */
export const GITHUB_LINK_LIMIT = 50;

/** paths: the folders the link may mean, most likely first (a branch name can hold slashes). */
export type GithubLink = { repo: string; paths: string[] };

/**
 * A github.com link as owner/repo plus the folder inside it ("" for the whole repo).
 * Takes repo, /tree/<ref>/<folder> and /blob/<ref>/<folder>/SKILL.md links; null for anything else.
 * The ref is ignored (the catalog keeps one version of each skill), but where it ends isn't known:
 * "tree/release/v2/skills/pdf" may be branch "release" or "release/v2", so each split is a candidate.
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
  const paths = folder.map((_, start) => folder.slice(start).join("/").toLowerCase());
  return { repo: `${owner}/${repo}`.toLowerCase(), paths: [...paths, ""] };
}

/** owner/repo of a catalog skill's GitHub URL, lower case. */
function skillRepo(skill: CatalogSkill): string | null {
  const parsed = parseGithubLink(skill.github_url ?? skill.githubUrl ?? "");
  return parsed ? parsed.repo : null;
}

type Located = { skill: CatalogSkill; folder: string };
// The catalog loader returns the same array until it reloads, so each load is indexed once.
const byRepoCache = new WeakMap<CatalogSkill[], Map<string, Located[]>>();
function skillsByRepo(skills: CatalogSkill[]) {
  let index = byRepoCache.get(skills);
  if (index) return index;
  index = new Map();
  for (const skill of skills) {
    const repo = skill.id ? skillRepo(skill) : null;
    const folder = repo ? skillFolder(skill) : null;
    if (repo && folder !== null) index.set(repo, [...(index.get(repo) ?? []), { skill, folder }]);
  }
  byRepoCache.set(skills, index);
  return index;
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
 * The catalog skills at that link: the one in that folder first, then every skill under it
 * (the whole repo for a repo link), by name. The first candidate folder with any skill wins.
 */
export function catalogSkillsForGithubLink(link: GithubLink, skills: CatalogSkill[]): { skills: GithubLinkSkill[]; more: boolean } {
  const inRepo = skillsByRepo(skills).get(link.repo) ?? [];
  const under = (path: string) => inRepo.filter(({ folder }) => !path || folder === path || folder.startsWith(`${path}/`));
  const path = link.paths.find(candidate => under(candidate).length) ?? "";
  const found = path || link.paths.length === 1 ? under(path) : [];
  const sorted = found.sort((a, b) => Number(b.folder === path) - Number(a.folder === path)).map(({ skill }) => ({
    id: skill.id!, name: skill.name || skill.id!.split(":").at(-1)!, description: skill.description ?? null,
    githubUrl: skill.github_url ?? skill.githubUrl ?? null,
  }));
  // The skill in the linked folder stays first; the rest by name.
  const [first, ...rest] = sorted;
  const ordered = first && found[0].folder === path ? [first, ...rest.sort(byName)] : sorted.sort(byName);
  return { skills: ordered.slice(0, GITHUB_LINK_LIMIT), more: ordered.length > GITHUB_LINK_LIMIT };
}

function byName(a: GithubLinkSkill, b: GithubLinkSkill) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

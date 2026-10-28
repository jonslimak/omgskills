// Whether a catalog record can be installed reproducibly. Plain JavaScript so the catalog
// build scripts and the MCP server share one definition of "pinned".
const sha = /^[a-f0-9]{40}$/i;
export const safePart = /^[a-z0-9_.-]+$/i;

/** The exact commit and folder to install from, or undefined when the record cannot be installed reproducibly. */
export function pinnedInstallFor(skill) {
  const repo = githubRepo(skill.github_url);
  if (!repo || !skill.skill_md_path || !skill.repo_commit_sha || !skill.skill_md_sha) return undefined;
  if (!sha.test(skill.repo_commit_sha) || !sha.test(skill.skill_md_sha)) return undefined;
  const pathParts = skillMdParts(skill.skill_md_path);
  if (!pathParts || pathParts.length < 2) return undefined;
  return {
    repo,
    path: pathParts.slice(0, -1).join("/"),
    commit_sha: skill.repo_commit_sha.toLowerCase(),
    skill_md_sha: skill.skill_md_sha.toLowerCase(),
    ...(skill.skill_tree_sha && sha.test(skill.skill_tree_sha) ? { skill_tree_sha: skill.skill_tree_sha.toLowerCase() } : {})
  };
}

/** owner/repo for a plain https://github.com/owner/repo URL. */
export function githubRepo(url) {
  if (!url) return undefined;
  let parsed;
  try { parsed = new URL(url); } catch { return undefined; }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password || parsed.port
    || parts.length !== 2 || parsed.search || parsed.hash || !parts.every(part => safePart.test(part))) return undefined;
  return parts.join("/");
}

/** Path segments of a SKILL.md path, or undefined if any segment is unsafe. */
export function skillMdParts(path) {
  const parts = path?.split("/");
  if (!parts || parts.at(-1) !== "SKILL.md") return undefined;
  return parts.every(part => safePart.test(part) && part !== "." && part !== "..") ? parts : undefined;
}

// The manual install command shown on skill pages, and which skills are deprecated.

const safePart = /^[a-z0-9_.-]+$/i;

function repoUrl(skill) {
  let url;
  try {
    url = new URL(skill.github_url);
  } catch {
    return "";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port
    || url.search || url.hash || parts.length !== 2 || !parts.every((part) => safePart.test(part))) return "";
  return `https://github.com/${parts[0]}/${parts[1]}`;
}

// The folder name under ~/.claude/skills: the one the catalog's command uses, else the skill name.
function targetName(skill) {
  const fromCatalog = String(skill.install_cmd || "").match(/~\/\.claude\/skills\/([^\s'"/]+)/)?.[1];
  const name = fromCatalog || String(skill.name || "");
  return safePart.test(name) && name !== "." && name !== ".." ? name : "";
}

/**
 * Copies the skill folder into ~/.claude/skills/<name>, at the pinned commit when there is one.
 * The catalog's own command clones into /tmp and links to it, which breaks after a restart and
 * fails for a second skill from the same repo. Returns "" when the parts aren't plain paths.
 */
export function manualInstallCommand(skill) {
  const url = repoUrl(skill);
  const name = targetName(skill);
  const parts = String(skill.skill_md_path || "").split("/");
  if (!url || !name || parts.at(-1) !== "SKILL.md"
    || !parts.every((part) => safePart.test(part) && part !== "." && part !== "..")) return "";
  const dir = parts.slice(0, -1).join("/");
  const sha = /^[a-f0-9]{40}$/i.test(skill.repo_commit_sha || "") ? skill.repo_commit_sha.toLowerCase() : "";
  const clone = sha
    ? `git clone -q --filter=blob:none ${url} "$tmp" && git -C "$tmp" checkout -q ${sha}`
    : `git clone -q --depth 1 ${url} "$tmp"`;
  const source = `"$tmp/${dir ? `${dir}/` : ""}."`;
  return `tmp="$(mktemp -d)" && ${clone} && mkdir -p ~/.claude/skills/${name} && cp -R ${source} ~/.claude/skills/${name}/ && rm -rf "$tmp"`;
}

/** A skill whose description says it is deprecated ("Deprecated.", "DEPRECATED: use x"). */
export function isDeprecatedSkill(skill) {
  return /^\s*\[?deprecated\b/i.test(String(skill.description || ""));
}

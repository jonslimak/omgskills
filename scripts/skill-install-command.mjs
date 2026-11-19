// The manual install command shown on skill pages, and which skills are deprecated.

const safePart = /^[a-z0-9_.-]+$/i;
// Folder and file names: letters and digits in any script, plus _ . - (nothing the shell reads).
const safeName = /^[\p{L}\p{N}_.-]+$/u;
const plainName = (value) => safeName.test(value) && value !== "." && value !== "..";

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

// The folder name under ~/.claude/skills: the catalog's install target, the one its old command
// used, or the skill name, whichever is first a plain name.
function targetName(skill) {
  const fromCommand = String(skill.install_cmd || "").match(/~\/\.claude\/skills\/([^\s'"/]+)/)?.[1];
  return [skill.install_target_name, fromCommand, skill.name].map((value) => String(value || "")).find(plainName) || "";
}

// The catalog's own command, when it doesn't use /tmp (a root clone straight into the skills folder).
function catalogCommand(skill) {
  const command = String(skill.install_cmd || "");
  return command && !command.includes("/tmp/") ? command : "";
}

/**
 * Copies the skill folder into ~/.claude/skills/<name>, at the pinned commit when there is one.
 * The catalog's own command clones into /tmp and links to it, which breaks after a restart and
 * fails for a second skill from the same repo. An old /tmp link at the target is replaced, and the
 * temporary clone is removed whether or not the copy worked. When the parts aren't plain paths it
 * falls back to the catalog's command unless that uses /tmp, else returns "".
 */
export function manualInstallCommand(skill) {
  const url = repoUrl(skill);
  const name = targetName(skill);
  const parts = String(skill.skill_md_path || "").split("/");
  if (!url || !name || parts.at(-1) !== "SKILL.md" || !parts.every(plainName)) return catalogCommand(skill);
  const dir = parts.slice(0, -1).join("/");
  const sha = /^[a-f0-9]{40}$/i.test(skill.repo_commit_sha || "") ? skill.repo_commit_sha.toLowerCase() : "";
  const clone = sha
    ? `git clone -q --filter=blob:none --no-checkout ${url} "$tmp" && git -C "$tmp" checkout -q ${sha}`
    : `git clone -q --depth 1 ${url} "$tmp"`;
  const source = `"$tmp/${dir ? `${dir}/` : ""}."`;
  const target = `~/.claude/skills/${name}`;
  return `tmp="$(mktemp -d)" && { ${clone} && { [ ! -L ${target} ] || rm ${target}; } && mkdir -p ${target} && cp -R ${source} ${target}/; ok=$?; rm -rf "$tmp"; [ "$ok" = 0 ]; }`;
}

/** A skill whose description says it is deprecated ("Deprecated.", "DEPRECATED: use x"). */
export function isDeprecatedSkill(skill) {
  return /^\s*\[?deprecated\b/i.test(String(skill.description || ""));
}

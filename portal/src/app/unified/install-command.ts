// A terminal command that installs one public skill into ~/.claude/skills for macOS, Linux or WSL.
// It fetches the pinned commit when the catalog has one, keeps only the skill folder, and never
// overwrites an existing skill. Catalog values are single-quoted, so no catalog text runs as shell.

type InstallSource = {
  github_url?: unknown;
  skill_md_path?: unknown;
  repo_commit_sha?: unknown;
  install_target_name?: unknown;
  pinned_install?: unknown;
  install_status?: unknown;
};

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

function repoUrl(value: unknown) {
  if (typeof value !== "string") return;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(value);
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

function skillFolder(value: unknown) {
  if (typeof value !== "string" || !/(^|\/)SKILL\.md$/i.test(value) || /[\x00-\x1f\x7f]/.test(value)) return;
  const folder = value.replace(/\/?SKILL\.md$/i, "");
  return folder.split("/").some((part) => part === ".." || part === ".") ? undefined : folder;
}

const targetName = (value: string) => /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== ".." ? value : undefined;

export function installCommandFor(skill: InstallSource): string | undefined {
  const url = repoUrl(skill.github_url);
  const folder = skillFolder(skill.skill_md_path);
  if (!url || folder === undefined) return;
  const name = typeof skill.install_target_name === "string" && skill.install_target_name
    ? targetName(skill.install_target_name)
    : targetName(folder.split("/").pop() || url.split("/").pop()!);
  if (!name) return;
  // MCP exposes its pin here, while raw catalog records use repo_commit_sha.
  let commitValue = skill.repo_commit_sha;
  if (skill.pinned_install != null) {
    if (typeof skill.pinned_install !== "object" || Array.isArray(skill.pinned_install)) return;
    commitValue = (skill.pinned_install as Record<string, unknown>).commit_sha;
    if (commitValue == null) return;
  }
  if (commitValue != null && (typeof commitValue !== "string" || !/^[0-9a-f]{40}$/i.test(commitValue))) return;
  const commit = typeof commitValue === "string" ? commitValue.toLowerCase() : undefined;
  if (skill.install_status === "pinned" && !commit) return;
  const target = `~/.claude/skills/${quote(name)}`;
  const fetch = commit
    ? `git -C "$d" init -q && git -C "$d" fetch -q --depth 1 ${quote(url)} ${commit} && git -C "$d" checkout -q FETCH_HEAD`
    : `git clone -q --depth 1 ${quote(url)} "$d"`;
  const place = folder ? `mv "$d"/${quote(folder)} ${target}` : `rm -rf "$d/.git" && mv "$d" ${target}`;
  return `test ! -e ${target} && d=$(mktemp -d) && ${fetch} && mkdir -p ~/.claude/skills && ${place} && rm -rf "$d"`;
}

type DeviceInfo = { platform?: string; userAgent?: string; maxTouchPoints?: number; userAgentData?: { platform?: string } };

/** True on a Mac desktop. iPads also report "MacIntel", so a touch screen rules a Mac out. */
export function isMacDevice(device: DeviceInfo | undefined = typeof navigator === "undefined" ? undefined : navigator as DeviceInfo): boolean {
  if (!device) return true;
  const platform = device.userAgentData?.platform || device.platform || device.userAgent || "";
  return /mac/i.test(platform) && !/iphone|ipad|ipod/i.test(device.userAgent ?? "") && (device.maxTouchPoints ?? 0) <= 1;
}

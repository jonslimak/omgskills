import { createHash } from "node:crypto";
import type { SkillResult } from "./library.js";
import { githubRepo, pinnedInstallFor, safePart, skillMdParts, type PinnedInstall } from "./install-record.mjs";

export { githubRepo, pinnedInstallFor, skillMdParts, type PinnedInstall };
export const installAgents = ["claude_code", "codex"] as const;
export const installScopes = ["user", "project"] as const;
export type InstallAgent = typeof installAgents[number];
export type InstallScope = typeof installScopes[number];

// Where each agent reads skills, matching the Mac app's installer.
const skillRoots: Record<InstallAgent, Record<InstallScope, string>> = {
  claude_code: { user: "~/.claude/skills", project: ".claude/skills" },
  codex: { user: "~/.codex/skills", project: ".codex/skills" },
};

export function installFolderName(skill: SkillResult, pin: PinnedInstall): string | undefined {
  const name = skill.install_target_name ?? pin.path.split("/").at(-1);
  return name && safePart.test(name) && name !== "." && name !== ".." ? name : undefined;
}

/**
 * A POSIX shell script that fetches exactly the pinned commit, checks SKILL.md against the
 * catalog hash, and copies the skill folder into the agent's skills directory. It never
 * overwrites an existing destination and cleans temporary files on failure or exit.
 */
export function installScript(pin: PinnedInstall, name: string, agent: InstallAgent, scope: InstallScope) {
  const destination = `${skillRoots[agent][scope]}/${name}`;
  const root = skillRoots[agent][scope].replace(/^~/, "$HOME");
  const steps = [
    // Run as one script: each step relies on the ones before it succeeding.
    "set -e",
    `destination="${root}/${name}"`,
    `test ! -e "$destination" && test ! -L "$destination" || { echo "$destination already exists; remove it first to reinstall." >&2; exit 1; }`,
    `tmp=""; marker=""`,
    // Only remove an unfinished destination if our unique ownership marker remains.
    `cleanup() {\n  status=$?\n  trap - 0 HUP INT TERM\n  if [ -n "$marker" ] && [ ! -L "$destination" ] && [ -f "$marker" ]; then rm -rf "$destination" || :; fi\n  if [ -n "$tmp" ]; then rm -rf "$tmp" || :; fi\n  exit "$status"\n}`,
    `trap cleanup 0`,
    `trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM`,
    `tmp="$(mktemp -d)"`,
    `git -C "$tmp" init -q`,
    `git -C "$tmp" fetch -q --depth 1 https://github.com/${pin.repo}.git ${pin.commit_sha}`,
    `git -C "$tmp" checkout -q FETCH_HEAD`,
    `test "$(git -C "$tmp" rev-parse HEAD:${pin.path}/SKILL.md)" = ${pin.skill_md_sha} || { echo "SKILL.md does not match the catalog; not installing." >&2; exit 1; }`,
    `mkdir -p "${root}"`,
    `mkdir "$destination" || { echo "$destination already exists; not installing." >&2; exit 1; }`,
    `marker="$destination/.omgskills-install-\${tmp##*/}"`,
    `: > "$marker"`,
    `cp -R "$tmp/${pin.path}/." "$destination/"`,
    `rm "$marker"`,
    `marker=""`
  ];
  return { destination, steps, script: steps.join("\n") };
}

/** User-scope install scripts for each agent, for a single full skill record. */
export function installScripts(skill: SkillResult, pin: PinnedInstall): Record<InstallAgent, string> | undefined {
  const name = installFolderName(skill, pin);
  if (!name) return undefined;
  return Object.fromEntries(installAgents.map(agent => [agent, installScript(pin, name, agent, "user").script])) as Record<InstallAgent, string>;
}

/** Git's blob hash, to check fetched SKILL.md bytes against skill_md_sha. */
export function gitBlobSha(bytes: Uint8Array) {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

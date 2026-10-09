import type { SkillDisplay } from "./model";

export function isF1Preview(development: boolean, enabled: unknown, hostname: string) {
  return development && enabled === "1" && ["127.0.0.1", "localhost"].includes(hostname);
}

const bytes = (value: string) => new TextEncoder().encode(value).length;
const controls = /[\p{Cc}\p{Cf}]/u;

// Constructs the existing Debug-only request; preview eligibility is a separate policy.
export function developmentInstallLink(skill: SkillDisplay, commit?: string): string | null {
  const id = skill.catalogId, path = skill.skillMDPath;
  if (!id || bytes(id) > 500 || controls.test(id) || !path || bytes(path) > 1024
    || controls.test(path) || path.includes("\\") || skill.hasPinnedInstall) return null;
  const parts = path.split("/");
  if (parts.at(-1) !== "SKILL.md" || parts.some(part => !part || [".", "..", ".git"].includes(part.toLowerCase()))) return null;
  if (commit !== undefined && !/^[a-f0-9]{40}$/i.test(commit)) return null;
  const source = /^https:\/\/github\.com\/([a-z0-9-]{1,39})\/([a-z0-9._-]{1,100})\/?$/i.exec(skill.githubUrl || "");
  if (!source || source[1].startsWith("-") || source[1].endsWith("-") || [".", ".."].includes(source[2])) return null;
  const target = parts.length > 1 ? parts.at(-2)! : source[2];
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(target)) return null;
  const link = new URL("omgskills-f1://review");
  link.search = new URLSearchParams({ v: "1", id, repo: `${source[1]}/${source[2]}`.toLowerCase(),
    path, agent: "codex", ...(commit ? { commit: commit.toLowerCase() } : {}) }).toString();
  return bytes(link.href) <= 4096 ? link.href : null;
}

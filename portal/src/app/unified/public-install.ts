import type { SkillDisplay } from "./model";

export function isF1Preview(development: boolean, enabled: unknown, hostname: string) {
  return development && enabled === "1" && ["127.0.0.1", "localhost"].includes(hostname);
}

export const installClients = {
  f1: { scheme: "omgskills-f1", name: "OMGSkills F1 Test" },
  "setup-test": { scheme: "omgskills-setup-test", name: "OMGSkills Setup Test" },
} as const;
export type InstallClient = keyof typeof installClients;
export type InstallAction = { href: string | null; reason: string };

export function normalInstallClient(development: boolean, enabled: unknown, hostname: string, catalogFlag?: unknown): "setup-test" | null {
  if (catalogFlag === "1") return null;
  return isF1Preview(development, enabled, hostname) ? "setup-test" : null;
}

export type CatalogInstallAgent = "claude" | "codex";
export function catalogInstallTestEnabled(development: boolean, enabled: unknown, hostname: string, oldFlag?: unknown) {
  return isF1Preview(development, enabled, hostname) && oldFlag !== "1";
}

export function catalogInstallAction(skill: SkillDisplay, agent: CatalogInstallAgent): InstallAction {
  const id = skill.catalogId;
  if (!id?.trim() || skill.key !== `catalog:${id}` || skill.setItemKind || skill.installed?.isLocalOnly
    || bytes(id) > 500 || controls.test(id) || !["claude", "codex"].includes(agent)) {
    return { href: null, reason: "Select a public catalog skill and an install target." };
  }
  const link = new URL("omgskills-f1://catalog-install");
  link.search = new URLSearchParams({ v: "1", id, agent }).toString();
  return { href: bytes(link.href) <= 4096 ? link.href : null, reason: "" };
}

export function normalInstallAction(skill: SkillDisplay): InstallAction {
  if (!skill.catalogId || skill.key !== `catalog:${skill.catalogId}` || skill.setItemKind || skill.installed?.isLocalOnly) {
    return { href: null, reason: "Open a public catalog skill to review an install." };
  }
  if (skill.hasPinnedInstall) {
    return { href: null, reason: "This catalog version needs pin verification that is not available in this test yet." };
  }
  const href = developmentInstallLink(skill, undefined, "setup-test");
  return { href, reason: href ? "" : "A valid public GitHub source and SKILL.md path are required." };
}

export function previewInstallClient(development: boolean, f1: unknown, setup: unknown, hostname: string): InstallClient | null {
  if (!development || !["127.0.0.1", "localhost"].includes(hostname) || (f1 === "1" && setup === "1")) return null;
  return setup === "1" ? "setup-test" : f1 === "1" ? "f1" : null;
}

const bytes = (value: string) => new TextEncoder().encode(value).length;
const controls = /[\p{Cc}\p{Cf}]/u;

// Only fixed test handlers are supported; preview eligibility is a separate policy.
export function developmentInstallLink(skill: SkillDisplay, commit?: string, client: InstallClient = "f1"): string | null {
  return skill.hasPinnedInstall ? null : sourceInstallLink(skill, commit, client);
}

function sourceInstallLink(skill: SkillDisplay, commit: string | undefined, client: InstallClient): string | null {
  const id = skill.catalogId, path = skill.skillMDPath;
  if (!id || bytes(id) > 500 || controls.test(id) || !path || bytes(path) > 1024
    || controls.test(path) || path.includes("\\")) return null;
  const parts = path.split("/");
  if (parts.at(-1) !== "SKILL.md" || parts.some(part => !part || [".", "..", ".git"].includes(part.toLowerCase()))) return null;
  if (commit !== undefined && !/^[a-f0-9]{40}$/i.test(commit)) return null;
  const source = /^https:\/\/github\.com\/([a-z0-9-]{1,39})\/([a-z0-9._-]{1,100})\/?$/i.exec(skill.githubUrl || "");
  if (!source || source[1].startsWith("-") || source[1].endsWith("-") || [".", ".."].includes(source[2])) return null;
  const target = parts.length > 1 ? parts.at(-2)! : source[2];
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(target)) return null;
  const link = new URL(`${installClients[client].scheme}://review`);
  link.search = new URLSearchParams({ v: "1", id, repo: `${source[1]}/${source[2]}`.toLowerCase(),
    path, agent: "codex", ...(commit ? { commit: commit.toLowerCase() } : {}) }).toString();
  return bytes(link.href) <= 4096 ? link.href : null;
}

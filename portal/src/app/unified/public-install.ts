import type { SkillDisplay } from "./model";

// F1 is a single-source, local-only proof. This is not a production install route.
export const f1Fixture = {
  id: "anthropics/skills:skills/frontend-design",
  repo: "anthropics/skills",
  path: "skills/frontend-design/SKILL.md",
};

export function isF1Preview(development: boolean, enabled: unknown, hostname: string) {
  return development && enabled === "1" && ["127.0.0.1", "localhost"].includes(hostname);
}

export function f1InstallLink(skill: SkillDisplay, commit?: string): string | null {
  if (skill.catalogId !== f1Fixture.id || skill.skillMDPath !== f1Fixture.path || skill.hasPinnedInstall) return null;
  if (commit !== undefined && !/^[a-f0-9]{40}$/i.test(commit)) return null;
  try {
    const source = new URL(skill.githubUrl || "");
    if (source.protocol !== "https:" || source.host !== "github.com" || source.username || source.password
      || source.search || source.hash || source.pathname.replace(/\/$/, "") !== `/${f1Fixture.repo}`) return null;
    const link = new URL("omgskills-f1://review");
    link.search = new URLSearchParams({ v: "1", id: skill.catalogId, repo: f1Fixture.repo,
      path: skill.skillMDPath, agent: "codex", ...(commit ? { commit: commit.toLowerCase() } : {}) }).toString();
    return link.href;
  } catch { return null; }
}

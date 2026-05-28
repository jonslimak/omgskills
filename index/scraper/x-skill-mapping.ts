import type { Skill } from "./types.js";

export type XGitHubSkillRef = {
  repoId: string;
  githubUrl: string;
  skillPath: string;
  sourceUrl: string;
};

export type ValidSkillRepo = {
  id: string;
  github_url: string;
  skill_md_path: string;
  name: string;
  description: string;
  stars: number;
};

const GITHUB_URL_RE = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(\/[^\s)\]}>"']*)?/gi;
const SKILL_REF_RE = /^\/(blob|tree)\/([^/\s?#]+)\/([^?#]+\/SKILL\.md)$/i;

export function extractExactSkillRefs(text: string): XGitHubSkillRef[] {
  const refs = new Map<string, XGitHubSkillRef>();

  for (const match of text.matchAll(GITHUB_URL_RE)) {
    const owner = match[1];
    const repo = match[2];
    const suffix = match[3] ?? "";
    const normalizedSuffix = suffix.replace(/[),.;:!?'"`]+$/g, "");
    const skillMatch = normalizedSuffix.match(SKILL_REF_RE);
    if (!owner || !repo || !skillMatch) continue;

    const repoId = `${owner}/${repo}`;
    const skillPath = decodeURIComponent(skillMatch[3]);
    const githubUrl = `https://github.com/${repoId}`;
    const sourceUrl = `https://github.com/${repoId}${normalizedSuffix}`;
    const key = `${repoId.toLowerCase()}::${skillPath.toLowerCase()}`;
    refs.set(key, { repoId, githubUrl, skillPath, sourceUrl });
  }

  return [...refs.values()];
}

export function repoKey(repoOrUrl: string): string {
  const match = repoOrUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/#?]+)/i);
  if (match?.[1]) return match[1].replace(/\.git$/i, "").toLowerCase();
  return repoOrUrl.replace(/\.git$/i, "").replace(/\/+$/g, "").toLowerCase();
}

export function skillLookupKey(githubUrl: string, skillPath: string): string {
  return `${repoKey(githubUrl)}::${skillPath.trim().toLowerCase()}`;
}

export function buildSkillLookup(skills: Skill[]): Map<string, Skill> {
  return new Map(
    skills
      .filter((skill) => Boolean(skill.skill_md_path))
      .map((skill) => [skillLookupKey(skill.github_url, skill.skill_md_path!), skill] as const),
  );
}

export function matchValidatedRepoToSkill(
  repo: ValidSkillRepo,
  lookup: Map<string, Skill>,
): Skill | null {
  return lookup.get(skillLookupKey(repo.github_url, repo.skill_md_path)) ?? null;
}

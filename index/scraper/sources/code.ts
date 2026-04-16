import { octokit } from "../client.js";

export interface CodeHit {
  id: string;
  path: string;
  github_url: string;
  author_handle: string;
}

// Only accept SKILL.md at repo root or under the `.claude/skills/` convention.
// Filters out SKILL.md files buried in examples/, docs/, test fixtures, etc.
// of unrelated repos — those are the top noise source in raw code search.
function isStandaloneSkillPath(path: string): boolean {
  if (path === "SKILL.md") return true;
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path)) return true;
  return false;
}

export async function searchBySkillMdFilename(): Promise<CodeHit[]> {
  const best = new Map<string, CodeHit>();

  const iter = octokit.paginate.iterator(octokit.rest.search.code, {
    q: "filename:SKILL.md",
    per_page: 100,
  });

  for await (const { data } of iter) {
    for (const hit of data) {
      if (!isStandaloneSkillPath(hit.path)) continue;
      const repoFullName = hit.repository.full_name;
      const existing = best.get(repoFullName);
      if (!existing || hit.path.length < existing.path.length) {
        best.set(repoFullName, {
          id: repoFullName,
          path: hit.path,
          github_url: hit.repository.html_url,
          author_handle: hit.repository.owner?.login ?? "",
        });
      }
    }
  }

  return [...best.values()];
}

export interface OfficialSkillsHit {
  id: string;
  path: string;
  skill_name_hint: string;
  github_url: string;
  author_handle: string;
}

const OFFICIAL_URL = "https://skills.sh/official";
const RESOLVE_PATH = "__RESOLVE__";
const REPO_BLOCK_RE = /\\"repo\\":\\"([^\\]+)\\",\\"totalInstalls\\":[0-9]+,\\"skills\\":\[(.*?)\]\}/gs;
const SKILL_NAME_RE = /\\"name\\":\\"([^\\]+)\\"/g;

function deriveId(repo: string, skillName: string): string {
  return `${repo}:${skillName}`;
}

export async function searchOfficialSkills(): Promise<OfficialSkillsHit[]> {
  const res = await fetch(OFFICIAL_URL);
  if (!res.ok) {
    console.warn(`  official-skills: failed to fetch ${OFFICIAL_URL} (${res.status})`);
    return [];
  }

  const html = await res.text();
  const seen = new Set<string>();
  const results: OfficialSkillsHit[] = [];

  for (const match of html.matchAll(REPO_BLOCK_RE)) {
    const repo = match[1];
    const body = match[2];
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) continue;
    const [owner] = repo.split("/");

    for (const skillMatch of body.matchAll(SKILL_NAME_RE)) {
      const skillName = skillMatch[1].trim();
      if (!skillName) continue;
      const id = deriveId(repo, skillName);
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({
        id,
        path: RESOLVE_PATH,
        skill_name_hint: skillName,
        github_url: `https://github.com/${repo}`,
        author_handle: owner,
      });
    }
  }

  console.log(`  official-skills: found ${results.length} candidates`);
  return results;
}

export interface RegistryHit {
  id: string;
  path: string;
  ref?: string;
  github_url: string;
  author_handle: string;
  stars: number;
  tags: string[];
}

interface RegistrySkill {
  name?: string;
  description?: string;
  repo?: string;
  path?: string;
  category?: string;
  tags?: string[];
  stars?: number;
  source?: string;
  source_url?: string;
  branch?: string;
}

interface RegistryResponse {
  skills?: RegistrySkill[];
}

const REGISTRY_URL = "https://raw.githubusercontent.com/majiayu000/claude-skill-registry-core/main/registry.json";
const REGISTRY_LIMIT = 50_000;
const MIRROR_REPOS = new Set([
  "majiayu000/claude-skill-registry",
  "majiayu000/claude-skill-registry-data",
]);

interface SourceLocation {
  repo: string;
  path: string;
  ref?: string;
}

function isValidRepo(repo: string | undefined): repo is string {
  return Boolean(repo && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo));
}

function isValidSkillPath(path: string | undefined): path is string {
  return Boolean(path && (path === "SKILL.md" || path.endsWith("/SKILL.md")));
}

function parseGitHubBlobUrl(url: string | undefined): SourceLocation | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 5 || parts[2] !== "blob") return null;

    const repo = `${parts[0]}/${parts[1]}`;
    const ref = parts[3];
    const path = parts.slice(4).join("/");
    if (!isValidRepo(repo) || !isValidSkillPath(path)) return null;
    return { repo, path, ref };
  } catch {
    return null;
  }
}

function resolveSourceLocation(skill: RegistrySkill): SourceLocation | null {
  const sourceLocation = parseGitHubBlobUrl(skill.source_url);
  if (sourceLocation && !MIRROR_REPOS.has(sourceLocation.repo)) return sourceLocation;

  if (!isValidRepo(skill.repo) || !isValidSkillPath(skill.path)) return null;
  if (MIRROR_REPOS.has(skill.repo)) return null;
  return { repo: skill.repo, path: skill.path, ref: skill.branch };
}

function deriveId(repo: string, path: string): string {
  if (path === "SKILL.md") return repo;
  return `${repo}:${path.replace(/\/SKILL\.md$/, "")}`;
}

function deriveTags(skill: RegistrySkill): string[] {
  const tags = new Set<string>();
  for (const tag of skill.tags ?? []) {
    const clean = tag.trim();
    if (clean) tags.add(clean);
  }
  const category = skill.category?.trim();
  if (category) tags.add(category);
  return [...tags];
}

export async function searchRegistry(): Promise<RegistryHit[]> {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) {
    console.warn(`  registry: failed to fetch ${REGISTRY_URL} (${res.status})`);
    return [];
  }

  const data = await res.json() as RegistryResponse;
  const skills = data.skills ?? [];
  const seen = new Set<string>();
  let skipped = 0;
  let mirrorsSkipped = 0;

  const results: RegistryHit[] = [];
  for (const skill of skills.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))) {
    if (results.length >= REGISTRY_LIMIT) break;

    const location = resolveSourceLocation(skill);
    if (!location) {
      if (skill.repo && MIRROR_REPOS.has(skill.repo)) mirrorsSkipped++;
      else skipped++;
      continue;
    }

    const { repo, path, ref } = location;
    const id = deriveId(repo, path);
    if (seen.has(id)) continue;
    seen.add(id);

    const [owner] = repo.split("/");
    results.push({
      id,
      path,
      ref,
      github_url: `https://github.com/${repo}`,
      author_handle: owner,
      stars: skill.stars ?? 0,
      tags: deriveTags(skill),
    });
  }

  console.log(`  registry: found ${results.length} top-starred candidates from ${skills.length} registry skills (${skipped} invalid, ${mirrorsSkipped} mirrors skipped)`);
  return results;
}

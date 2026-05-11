export interface AwesomeHit {
  id: string;
  path: string;
  skill_name_hint?: string;
  ref?: string;
  github_url: string;
  author_handle: string;
}

const README_URL = "https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md";
const ENTRY_RE = /^-\s+\*\*\[([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\]\(([^)]+)\)\*\*/gm;
const GITHUB_TREE_URL_RE = /https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/tree\/[^"' )<]+/g;
const OFFICIALSKILLS_CONCURRENCY = 10;

function deriveId(repo: string, path: string): string {
  if (path === "SKILL.md") return repo;
  return `${repo}:${path.replace(/\/SKILL\.md$/, "")}`;
}

function deriveIdFromHint(repo: string, skillNameHint: string): string {
  return `${repo}:${skillNameHint}`;
}

function isOfficialSkillsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "officialskills.sh";
  } catch {
    return false;
  }
}

function parseGitHubRepoUrl(
  url: string,
  label: string,
): { repo: string; path: string; skill_name_hint?: string; ref?: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const repo = `${parts[0]}/${parts[1]}`;
    const skillNameHint = label.split("/")[1];
    if (skillNameHint && repo.endsWith("/skills")) {
      return { repo, path: "__RESOLVE__", skill_name_hint: skillNameHint };
    }
    return { repo, path: "SKILL.md" };
  } catch {
    return null;
  }
}

async function resolveOfficialSkillsUrl(
  url: string,
): Promise<{ repo: string; path: string; skill_name_hint?: string; ref?: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();

    let best: { repo: string; path: string; ref?: string } | null = null;
    for (const treeUrl of html.match(GITHUB_TREE_URL_RE) ?? []) {
      try {
        const tree = new URL(treeUrl);
        const parts = tree.pathname.split("/").filter(Boolean);
        if (parts.length < 5 || parts[2] !== "tree") continue;
        const repo = `${parts[0]}/${parts[1]}`;
        const ref = parts[3];
        const path = parts.slice(4).join("/");
        if (!path) continue;
        if (!best || path.length > best.path.length) {
          best = { repo, path: `${path.replace(/\/+$/, "")}/SKILL.md`, ref };
        }
      } catch {
        continue;
      }
    }
    if (!best) return null;

    return {
      repo: best.repo,
      path: best.path,
      ref: best.ref,
      skill_name_hint: best.path.split("/").at(-2),
    };
  } catch {
    return null;
  }
}

async function resolveEntry(
  label: string,
  url: string,
): Promise<{ repo: string; path: string; skill_name_hint?: string; ref?: string } | null> {
  if (isOfficialSkillsUrl(url)) {
    return resolveOfficialSkillsUrl(url);
  }
  return parseGitHubRepoUrl(url, label);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function searchAwesomeAgentSkills(): Promise<AwesomeHit[]> {
  const res = await fetch(README_URL);
  if (!res.ok) {
    console.warn(`  awesome-agent-skills: failed to fetch README (${res.status})`);
    return [];
  }

  const readme = await res.text();
  const rawEntries = [...readme.matchAll(ENTRY_RE)].map((match) => ({
    label: match[1],
    url: match[2],
  }));
  const resolvedEntries = await mapWithConcurrency(rawEntries, OFFICIALSKILLS_CONCURRENCY, async ({ label, url }) => {
    return { resolved: await resolveEntry(label, url) };
  });

  const results: AwesomeHit[] = [];
  const seen = new Set<string>();
  let unresolved = 0;

  for (const { resolved } of resolvedEntries) {
    if (!resolved) {
      unresolved++;
      continue;
    }
    const { repo, path, skill_name_hint, ref } = resolved;
    const id = path === "__RESOLVE__" && skill_name_hint
      ? deriveIdFromHint(repo, skill_name_hint)
      : deriveId(repo, path);
    if (seen.has(id)) continue;
    seen.add(id);
    const [owner] = repo.split("/");
    results.push({
      id,
      path,
      skill_name_hint,
      ref,
      github_url: `https://github.com/${repo}`,
      author_handle: owner,
    });
  }

  console.log(`  awesome-agent-skills: found ${results.length} candidates (${unresolved} unresolved)`);
  return results;
}

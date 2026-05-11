/**
 * Crawls external "awesome" lists and top-skill articles to find skills
 * that external curators already agree are essential.
 *
 * Output: index/external-essentials.json — a list of repo IDs appearing on 2+ sources
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "..", "external-essentials.json");

const SOURCES: Array<{ name: string; url: string }> = [
  {
    name: "awesome-claude-skills",
    url: "https://raw.githubusercontent.com/travisvn/awesome-claude-skills/main/README.md",
  },
  {
    name: "awesome-agent-skills-voltagent",
    url: "https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md",
  },
  // heilcheng: human-curated, "unlike bulk-generated" philosophy, includes vendor repos
  // (Sentry, better-auth, coderabbitai, Trail of Bits, etc.)
  {
    name: "awesome-agent-skills-heilcheng",
    url: "https://raw.githubusercontent.com/heilcheng/awesome-agent-skills/main/README.md",
  },
  // antigravity sources ledger: machine-readable attribution file listing every upstream
  // repo they aggregate from (40+ orgs including Expo, Google, Hugging Face, Sentry)
  {
    name: "antigravity-sources",
    url: "https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/docs/sources/sources.md",
  },
];

const ARTICLE_URLS: Array<{ name: string; url: string }> = [
  {
    name: "developers-digest-best-skills",
    url: "https://www.developersdigest.tech/blog/best-claude-code-skills-2026",
  },
  {
    name: "blockchain-council-top-50",
    url: "https://www.blockchain-council.org/claude-ai/top-50-claude-skills-and-github-repos/",
  },
  // Firecrawl blog: high-authority developer tool company, current (Apr 2026), links
  // notable repos including Trail of Bits security skills and remotion-dev/skills
  {
    name: "firecrawl-best-skills",
    url: "https://www.firecrawl.dev/blog/best-claude-code-skills",
  },
];

const GITHUB_REPO_RE = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/g;

function extractReposFromText(text: string): Set<string> {
  const repos = new Set<string>();
  for (const match of text.matchAll(GITHUB_REPO_RE)) {
    const owner = match[1];
    const repo = match[2].replace(/[.,;)\]"'`]+$/, "");
    if (owner && repo && !repo.startsWith(".")) {
      repos.add(`${owner}/${repo}`);
    }
  }
  return repos;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "omgskills-content-bot/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`  [warn] ${url} → ${res.status}`);
      return null;
    }
    return res.text();
  } catch (err) {
    console.warn(`  [warn] fetch failed for ${url}: ${err}`);
    return null;
  }
}

export interface ExternalEssential {
  repo: string;
  sources: string[];
  source_count: number;
}

export async function fetchExternalEssentials(): Promise<ExternalEssential[]> {
  const repoSources = new Map<string, Set<string>>();
  let successfulFetches = 0;

  const record = (repo: string, sourceName: string) => {
    if (!repoSources.has(repo)) repoSources.set(repo, new Set());
    repoSources.get(repo)!.add(sourceName);
  };

  for (const source of SOURCES) {
    console.log(`  Fetching ${source.name}...`);
    const text = await fetchText(source.url);
    if (!text) continue;
    successfulFetches++;
    const repos = extractReposFromText(text);
    console.log(`    → ${repos.size} repos`);
    for (const repo of repos) record(repo, source.name);
  }

  for (const article of ARTICLE_URLS) {
    console.log(`  Fetching article: ${article.name}...`);
    const text = await fetchText(article.url);
    if (!text) continue;
    successfulFetches++;
    const repos = extractReposFromText(text);
    console.log(`    → ${repos.size} repos`);
    for (const repo of repos) record(repo, article.name);
  }

  const results: ExternalEssential[] = [];
  for (const [repo, sources] of repoSources) {
    results.push({ repo, sources: [...sources], source_count: sources.size });
  }

  results.sort((a, b) => b.source_count - a.source_count || a.repo.localeCompare(b.repo));

  const validated = results.filter((r) => r.source_count >= 2);
  if (successfulFetches === 0) {
    throw new Error("No external essentials sources were fetched successfully");
  }
  if (results.length === 0) {
    throw new Error("External essentials fetch returned zero repos");
  }
  console.log(`\n  Total repos found: ${results.length}`);
  console.log(`  Appearing on 2+ sources: ${validated.length}`);

  return results;
}

async function main() {
  console.log("Fetching external essentials...");
  const results = await fetchExternalEssentials();

  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nSaved ${results.length} entries to ${outPath}`);
  console.log(`Validated (2+ sources): ${results.filter((r) => r.source_count >= 2).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

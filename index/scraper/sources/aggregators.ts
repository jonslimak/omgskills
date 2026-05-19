import { octokit } from "../client.js";

export interface AggregatorHit {
  id: string;
  github_url: string;
  author_handle: string;
}

interface AggregatorSearchOptions {
  maxRepos?: number;
}

const GITHUB_URL_RE = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/g;

async function extractRepoLinksFromReadme(owner: string, repo: string): Promise<string[]> {
  try {
    const { data } = await octokit.rest.repos.getReadme({ owner, repo });
    if (!("content" in data) || !data.content) return [];
    const text = Buffer.from(data.content, "base64").toString("utf8");
    const ids = new Set<string>();
    for (const match of text.matchAll(GITHUB_URL_RE)) {
      const id = `${match[1]}/${match[2]}`;
      if (id !== `${owner}/${repo}`) ids.add(id);
    }
    return [...ids];
  } catch {
    return [];
  }
}

export async function searchAggregators(options: AggregatorSearchOptions = {}): Promise<AggregatorHit[]> {
  const seen = new Set<string>();
  const results: AggregatorHit[] = [];

  // Find repos that aggregate/list Claude Code skills
  const { data } = await octokit.rest.search.repos({
    q: "awesome-claude in:name stars:>5",
    sort: "stars",
    order: "desc",
    per_page: 50,
  });

  const repos = options.maxRepos ? data.items.slice(0, options.maxRepos) : data.items;

  for (const repo of repos) {
    const [owner, name] = repo.full_name.split("/");
    const linkedIds = await extractRepoLinksFromReadme(owner, name);
    for (const id of linkedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const [linkedOwner] = id.split("/");
      results.push({
        id,
        github_url: `https://github.com/${id}`,
        author_handle: linkedOwner,
      });
    }
  }

  console.log(`  aggregators: found ${results.length} linked repos from ${repos.length} aggregator repos`);
  return results;
}

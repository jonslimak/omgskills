import { octokit } from "../client.js";

export interface TopicHit {
  id: string;
  github_url: string;
  author_handle: string;
  stars: number;
  last_updated: string;
  tags: string[];
  repo_description: string | null;
}

const TOPICS = ["claude-code-skill", "claude-skill", "claude-skills"];

export async function searchByTopics(): Promise<TopicHit[]> {
  const seen = new Map<string, TopicHit>();

  for (const topic of TOPICS) {
    const q = `topic:${topic}`;
    const iter = octokit.paginate.iterator(octokit.rest.search.repos, {
      q,
      per_page: 100,
    });
    for await (const { data } of iter) {
      for (const repo of data) {
        if (seen.has(repo.full_name)) continue;
        seen.set(repo.full_name, {
          id: repo.full_name,
          github_url: repo.html_url,
          author_handle: repo.owner?.login ?? "",
          stars: repo.stargazers_count ?? 0,
          last_updated: repo.pushed_at ?? repo.updated_at ?? new Date().toISOString(),
          tags: repo.topics ?? [],
          repo_description: repo.description ?? null,
        });
      }
    }
  }

  return [...seen.values()];
}

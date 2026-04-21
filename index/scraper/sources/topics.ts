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

const TOPICS = [
  "claude-code-skill",
  "claude-skill",
  "claude-skills",
  "claude-code-plugin",
  "claude-agent",
  "agentic-skill",
  "ai-agent-skills",
  "claude-mcp",
  "claude-commands",
  "claude-code-tools",
  "anthropic-claude",
  "claude-skill-pack",
  "claude-code-agent",
  "agent-skill",
];

// Topics with >1000 repos — split by star ranges to stay under the API cap
const LARGE_TOPICS_STAR_SPLITS = [
  { topic: "agent-skills", stars: ">1000" },
  { topic: "agent-skills", stars: "100..1000" },
  { topic: "agent-skills", stars: "10..99" },
  { topic: "agent-skills", stars: "1..9" },
  { topic: "agent-skills", stars: "0" },
];

// Repo name patterns for ecosystems that don't use GitHub topics
const NAME_QUERIES = [
  '"Agent-Skill" in:name',
];

function toHit(repo: any): TopicHit {
  return {
    id: repo.full_name,
    github_url: repo.html_url,
    author_handle: repo.owner?.login ?? "",
    stars: repo.stargazers_count ?? 0,
    last_updated: repo.pushed_at ?? repo.updated_at ?? new Date().toISOString(),
    tags: repo.topics ?? [],
    repo_description: repo.description ?? null,
  };
}

async function paginateRepoSearch(q: string, seen: Map<string, TopicHit>) {
  const iter = octokit.paginate.iterator(octokit.rest.search.repos, {
    q,
    per_page: 100,
  });
  for await (const { data } of iter) {
    for (const repo of data) {
      if (!seen.has(repo.full_name)) seen.set(repo.full_name, toHit(repo));
    }
  }
}

export async function searchByTopics(): Promise<TopicHit[]> {
  const seen = new Map<string, TopicHit>();

  for (const topic of TOPICS) {
    await paginateRepoSearch(`topic:${topic}`, seen);
  }

  for (const { topic, stars } of LARGE_TOPICS_STAR_SPLITS) {
    await paginateRepoSearch(`topic:${topic} stars:${stars}`, seen);
  }

  for (const q of NAME_QUERIES) {
    await paginateRepoSearch(q, seen);
  }

  return [...seen.values()];
}

// Discovers Claude Code skill repos from Hacker News and Reddit posts.
// Both APIs are free and require no authentication.

export interface SocialHit {
  id: string;
  github_url: string;
  author_handle: string;
}

const GITHUB_URL_RE = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/g;

function extractRepoIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(GITHUB_URL_RE)) {
    ids.add(`${match[1]}/${match[2]}`);
  }
  return [...ids];
}

function toHit(id: string): SocialHit {
  const [owner] = id.split("/");
  return { id, github_url: `https://github.com/${id}`, author_handle: owner };
}

// ── Hacker News (Algolia API, free, no auth) ──────────────────────────────────

const HN_QUERIES = [
  "claude skill",
  "SKILL.md claude",
  "claude code skill",
];

async function searchHN(seen: Set<string>, results: SocialHit[]) {
  for (const query of HN_QUERIES) {
    let page = 0;
    while (page < 3) {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=100&page=${page}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json() as any;
      const hits: any[] = data.hits ?? [];
      if (hits.length === 0) break;

      for (const hit of hits) {
        const blobs = [hit.url ?? "", hit.story_text ?? "", hit.comment_text ?? ""].join(" ");
        for (const id of extractRepoIds(blobs)) {
          if (!seen.has(id)) { seen.add(id); results.push(toHit(id)); }
        }
      }

      if (hits.length < 100) break;
      page++;
    }
  }
}

// ── Reddit (public JSON API, free, no auth) ───────────────────────────────────

const REDDIT_SEARCHES = [
  { subreddit: "ClaudeAI", query: "skill" },
  { subreddit: "ClaudeAI", query: "SKILL.md" },
  { subreddit: "ClaudeAI", query: "claude code skill" },
  { subreddit: "anthropic", query: "skill" },
];

const REDDIT_HEADERS = {
  "User-Agent": "omgskills-scraper/1.0 (github.com/omgskills/scraper)",
};

async function searchReddit(seen: Set<string>, results: SocialHit[]) {
  for (const { subreddit, query } of REDDIT_SEARCHES) {
    let after = "";
    let pages = 0;
    while (pages < 3) {
      const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=100${after ? `&after=${after}` : ""}`;
      const res = await fetch(url, { headers: REDDIT_HEADERS });
      if (!res.ok) break;
      const data = await res.json() as any;
      const children: any[] = data?.data?.children ?? [];
      if (children.length === 0) break;

      for (const child of children) {
        const post = child.data ?? {};
        const blobs = [post.url ?? "", post.selftext ?? "", post.title ?? ""].join(" ");
        for (const id of extractRepoIds(blobs)) {
          if (!seen.has(id)) { seen.add(id); results.push(toHit(id)); }
        }
      }

      after = data?.data?.after ?? "";
      if (!after || children.length < 100) break;
      pages++;
    }
  }
}

// ── Combined export ───────────────────────────────────────────────────────────

export async function searchSocial(): Promise<SocialHit[]> {
  const seen = new Set<string>();
  const results: SocialHit[] = [];

  await Promise.all([
    searchHN(seen, results),
    searchReddit(seen, results),
  ]);

  console.log(`  social: found ${results.length} linked repos (HN + Reddit)`);
  return results;
}

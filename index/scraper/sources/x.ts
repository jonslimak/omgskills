import type { SocialHit } from "./social.js";

const GITHUB_URL_RE = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/g;
const DEFAULT_MIN_LIKES = 50;
const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_TOP_TWEET_LIMIT = 50;

const X_QUERIES = [
  '"SKILL.md" OR "skill" "Claude Code"',
  '"skill" "Codex"',
  '"agent skill" GitHub',
  '"Claude skill" GitHub',
];

const CONTEXT_TERMS = [
  "claude",
  "codex",
  "agent",
  "skill.md",
  "github",
];

interface ScrapedTweet {
  id?: string;
  text?: string;
  urls?: string[];
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
  username?: string;
  name?: string;
  permanentUrl?: string;
  timestamp?: number;
}

export interface XSkillTweetHit {
  tweet_id: string;
  tweet_url: string;
  author_handle: string;
  author_name: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  posted_at: string | null;
  repo_ids: string[];
  repo_urls: string[];
}

function enabled() {
  return process.env.ENABLE_X_SOCIAL === "1";
}

function minLikes() {
  const parsed = Number.parseInt(process.env.X_MIN_LIKES ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_LIKES;
}

function maxResults() {
  const parsed = Number.parseInt(process.env.X_MAX_RESULTS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESULTS;
}

function extractRepoIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(GITHUB_URL_RE)) {
    ids.add(`${match[1]}/${match[2]}`);
  }
  return [...ids];
}

function tweetText(tweet: ScrapedTweet): string {
  return [tweet.text, ...(tweet.urls ?? [])]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function isRelevantSkillTweet(text: string): boolean {
  const lower = text.toLowerCase();
  return CONTEXT_TERMS.some((term) => lower.includes(term));
}

function toHit(id: string): SocialHit {
  const [owner] = id.split("/");
  return { id, github_url: `https://github.com/${id}`, author_handle: owner };
}

function toTweetHit(tweet: ScrapedTweet): XSkillTweetHit | null {
  const text = tweetText(tweet);
  const repoIds = extractRepoIds(text);
  if (repoIds.length === 0) return null;

  const tweetId = tweet.id ?? "";
  const username = tweet.username ?? "";
  return {
    tweet_id: tweetId,
    tweet_url: tweet.permanentUrl ?? (username && tweetId ? `https://x.com/${username}/status/${tweetId}` : ""),
    author_handle: username,
    author_name: tweet.name ?? "",
    text,
    likes: tweet.likes ?? 0,
    retweets: tweet.retweets ?? 0,
    replies: tweet.replies ?? 0,
    views: tweet.views ?? 0,
    posted_at: tweet.timestamp ? new Date(tweet.timestamp * 1000).toISOString() : null,
    repo_ids: repoIds,
    repo_urls: repoIds.map((id) => `https://github.com/${id}`),
  };
}

async function createScraper() {
  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) return null;

  const { ErrorRateLimitStrategy, Scraper, SearchMode } = await import("@the-convocation/twitter-scraper");
  const scraper = new Scraper({ rateLimitStrategy: new ErrorRateLimitStrategy() });
  await scraper.setCookies([
    `auth_token=${authToken}; Domain=x.com; Path=/; Secure; HttpOnly`,
    `ct0=${ct0}; Domain=x.com; Path=/; Secure`,
  ]);
  return { scraper, SearchMode };
}

type XSession = NonNullable<Awaited<ReturnType<typeof createScraper>>>;

async function searchXQuery(
  x: XSession,
  query: string,
  count: number,
): Promise<ScrapedTweet[]> {
  const tweets: ScrapedTweet[] = [];
  for await (const tweet of x.scraper.searchTweets(query, count, x.SearchMode.Top)) {
    tweets.push(tweet);
    if (tweets.length >= count) break;
  }
  return tweets;
}

export async function searchXSocial(): Promise<SocialHit[]> {
  if (!enabled()) return [];

  if (!process.env.X_AUTH_TOKEN || !process.env.X_CT0) {
    console.warn("  x: skipped, missing X_AUTH_TOKEN or X_CT0");
    return [];
  }

  const min = minLikes();
  const perQuery = Math.max(1, Math.ceil(maxResults() / X_QUERIES.length));
  const seen = new Set<string>();
  const results: SocialHit[] = [];

  try {
    const x = await createScraper();
    if (!x) return [];

    for (const query of X_QUERIES) {
      const tweets = await searchXQuery(x, query, perQuery);
      for (const tweet of tweets) {
        if ((tweet.likes ?? 0) < min) continue;

        const text = tweetText(tweet);
        if (!isRelevantSkillTweet(text)) continue;

        for (const id of extractRepoIds(text)) {
          if (seen.has(id)) continue;
          seen.add(id);
          results.push(toHit(id));
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  x: skipped, ${message}`);
    return [];
  }

  console.log(`  x: found ${results.length} linked repos`);
  return results;
}

export async function searchTopXSkillTweets(options: {
  queries?: string[];
  limit?: number;
  minLikes?: number;
  maxResults?: number;
} = {}): Promise<XSkillTweetHit[]> {
  if (!process.env.X_AUTH_TOKEN || !process.env.X_CT0) {
    console.warn("  x: skipped, missing X_AUTH_TOKEN or X_CT0");
    return [];
  }

  const queries = options.queries ?? [
    '"skill" "github.com"',
    '"skills" "github.com"',
    '"SKILL.md"',
    '"skill repo" github',
    '"Claude Code" skill github',
    '"OpenAI skills" github',
  ];
  const limit = options.limit ?? DEFAULT_TOP_TWEET_LIMIT;
  const min = options.minLikes ?? minLikes();
  const max = options.maxResults ?? Math.max(DEFAULT_MAX_RESULTS, limit * 4);
  const perQuery = Math.max(1, Math.ceil(max / queries.length));
  const seenTweets = new Set<string>();
  const hits: XSkillTweetHit[] = [];

  try {
    const x = await createScraper();
    if (!x) return [];

    for (const query of queries) {
      const tweets = await searchXQuery(x, query, perQuery);
      for (const tweet of tweets) {
        if ((tweet.likes ?? 0) < min) continue;

        const text = tweetText(tweet);
        if (!text.toLowerCase().includes("skill")) continue;

        const hit = toTweetHit(tweet);
        if (!hit || !hit.tweet_url) continue;
        if (seenTweets.has(hit.tweet_id || hit.tweet_url)) continue;

        seenTweets.add(hit.tweet_id || hit.tweet_url);
        hits.push(hit);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  x: skipped, ${message}`);
    return [];
  }

  return hits
    .sort((a, b) => b.likes - a.likes)
    .slice(0, limit);
}

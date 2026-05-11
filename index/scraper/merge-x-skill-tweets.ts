import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "./types.js";

interface ValidSkillRepo {
  id: string;
  github_url: string;
  skill_md_path: string;
  name: string;
  description: string;
  stars: number;
}

interface TopSkillTweet {
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
  valid_skill_repos: ValidSkillRepo[];
}

const here = dirname(fileURLToPath(import.meta.url));
const skillsPath = join(here, "..", "skills.json");
const tweetsPath = join(here, "..", "top-x-skill-tweets.json");
const xTrendingPath = join(here, "..", "x-trending.json");
const X_SOURCE_TAG = "x-top-skill-tweet";
const DEFAULT_LIMIT = 50;

function strictMode() {
  return process.env.X_STRICT === "1";
}

function parseLimit() {
  const parsed = Number.parseInt(process.env.X_TOP_TWEET_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeAtomic(path: string, content: string) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function normalizeGitHubUrl(url: string) {
  return url.replace(/\.git$/i, "").replace(/\/+$/g, "").toLowerCase();
}

function repoParts(githubUrl: string) {
  const match = githubUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return { owner: "unknown", repo: "repo" };
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

function cloneCommand(githubUrl: string, skillPath: string, name: string) {
  const { repo } = repoParts(githubUrl);
  const dir = skillPath.replace(/\/SKILL\.md$/i, "");
  return `git clone ${githubUrl} /tmp/${repo} && ln -s /tmp/${repo}/${dir} ~/.claude/skills/${name}`;
}

function synthesizeSkill(repo: ValidSkillRepo, tweet: TopSkillTweet): Skill {
  const { owner } = repoParts(repo.github_url);
  return {
    id: `${repo.id}:${repo.skill_md_path}`,
    name: repo.name,
    description: repo.description,
    github_url: repo.github_url,
    install_cmd: cloneCommand(repo.github_url, repo.skill_md_path, repo.name),
    author_handle: owner,
    tags: ["twitter", "x"],
    stars: repo.stars,
    last_updated: tweet.posted_at ?? new Date().toISOString(),
    first_seen: tweet.posted_at ?? new Date().toISOString(),
  };
}

function toTwitterRow(base: Skill, tweet: TopSkillTweet): Skill {
  return {
    ...base,
    id: `${base.id}:x:${tweet.tweet_id}`,
    source_tag: X_SOURCE_TAG,
    source_url: tweet.tweet_url,
    tweet_url: tweet.tweet_url,
    tweet_likes: tweet.likes ?? 0,
    tweet_retweets: tweet.retweets ?? 0,
    tweet_replies: tweet.replies ?? 0,
    tweet_views: tweet.views ?? 0,
    tweet_author_handle: tweet.author_handle ?? "",
    tweet_author_name: tweet.author_name ?? "",
    tweet_posted_at: tweet.posted_at ?? null,
    tweet_text: tweet.text ?? "",
  };
}

function validate(twitterRows: Skill[]) {
  const ids = new Set<string>();
  for (const row of twitterRows) {
    if (ids.has(row.id)) throw new Error(`duplicate skill id: ${row.id}`);
    ids.add(row.id);
    if (!row.tweet_url || !row.tweet_text || row.source_tag !== X_SOURCE_TAG) {
      throw new Error(`invalid twitter row: ${row.id}`);
    }
  }
}

function main() {
  if (!existsSync(skillsPath)) throw new Error("skills.json missing; run npm run scrape first");
  if (!existsSync(tweetsPath)) {
    const message = "x: skipped merge, top-x-skill-tweets.json missing";
    if (strictMode()) throw new Error(message);
    console.warn(message);
    return;
  }

  const skills = readJson<Skill[]>(skillsPath);
  const tweets = readJson<TopSkillTweet[]>(tweetsPath).slice(0, parseLimit());
  const baseSkills = skills.filter((skill) => skill.source_tag !== X_SOURCE_TAG);
  const byGithub = new Map<string, Skill[]>();

  for (const skill of baseSkills) {
    const key = normalizeGitHubUrl(skill.github_url);
    const bucket = byGithub.get(key) ?? [];
    bucket.push(skill);
    byGithub.set(key, bucket);
  }

  const twitterRows: Skill[] = [];
  let synthesized = 0;

  for (const tweet of tweets) {
    const repos = tweet.valid_skill_repos ?? [];
    if (!tweet.tweet_id || !tweet.tweet_url || repos.length === 0) continue;

    let base: Skill | null = null;
    for (const repo of repos) {
      const matches = byGithub.get(normalizeGitHubUrl(repo.github_url)) ?? [];
      base = matches.find((skill) => skill.name === repo.name) ?? matches[0] ?? null;
      if (base) break;
    }

    if (!base) {
      base = synthesizeSkill(repos[0], tweet);
      synthesized++;
    }

    twitterRows.push(toTwitterRow(base, tweet));
  }

  validate(twitterRows);
  writeAtomic(xTrendingPath, JSON.stringify(twitterRows, null, 2) + "\n");

  console.log(`x: appended ${twitterRows.length} twitter rows (${synthesized} synthesized)`);
  console.log(`x: wrote -> ${xTrendingPath}`);
}

main();

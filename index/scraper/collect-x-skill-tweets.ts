import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { octokit } from "./client.js";
import { searchTopXSkillTweets, type XSkillTweetHit } from "./sources/x.js";

interface ValidSkillRepo {
  id: string;
  github_url: string;
  skill_md_path: string;
  name: string;
  description: string;
  stars: number;
}

interface TopSkillTweet extends XSkillTweetHit {
  valid_skill_repos: ValidSkillRepo[];
}

interface Frontmatter {
  name?: string;
  description?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "top-x-skill-tweets.json");
const DEFAULT_LIMIT = 50;
const VALIDATION_CONCURRENCY = 8;

function strictMode() {
  return process.env.X_STRICT === "1";
}

function hasXCredentials() {
  return Boolean(process.env.X_AUTH_TOKEN && process.env.X_CT0);
}

function parseLimit() {
  const parsed = Number.parseInt(process.env.X_TOP_TWEET_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

function parseFrontmatter(content: string): Frontmatter | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = content.slice(3, end).trim();
  try {
    const parsed = parseYaml(block);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Frontmatter;
  } catch {
    return null;
  }
}

async function fetchRaw(owner: string, repo: string, branch: string, path: string) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

async function validateSkillRepo(id: string): Promise<ValidSkillRepo | null> {
  const [owner, repo] = id.split("/");
  if (!owner || !repo) return null;

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const branch = repoData.default_branch;
    const { data: tree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: "1",
    });

    const skillPaths = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
      .map((entry) => entry.path!)
      .filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"))
      .sort((a, b) => a.length - b.length);

    for (const path of skillPaths) {
      const content = await fetchRaw(owner, repo, branch, path);
      if (!content) continue;

      const fm = parseFrontmatter(content);
      if (!fm?.name || !fm?.description) continue;

      return {
        id,
        github_url: repoData.html_url,
        skill_md_path: path,
        name: fm.name,
        description: fm.description,
        stars: repoData.stargazers_count ?? 0,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function main() {
  if (process.env.ENABLE_X_SOCIAL !== "1") {
    const message = "x: skipped, ENABLE_X_SOCIAL is not 1";
    if (strictMode()) throw new Error(message);
    console.warn(message);
    return;
  }

  if (!hasXCredentials()) {
    const message = "x: skipped, missing X_AUTH_TOKEN or X_CT0";
    if (strictMode()) throw new Error(message);
    console.warn(message);
    return;
  }

  const limit = parseLimit();
  const candidateLimit = Number.parseInt(process.env.X_CANDIDATE_LIMIT ?? "", 10) || Math.max(limit * 4, 200);
  const tweets = await searchTopXSkillTweets({
    limit: candidateLimit,
    minLikes: Number.parseInt(process.env.X_MIN_LIKES ?? "0", 10),
    maxResults: Number.parseInt(process.env.X_MAX_RESULTS ?? "", 10) || Math.max(candidateLimit * 2, 300),
  });

  const repoCache = new Map<string, ValidSkillRepo | null>();
  const uniqueRepoIds = [...new Set(tweets.flatMap((tweet) => tweet.repo_ids))];
  console.log(`found ${tweets.length} candidate tweets, validating ${uniqueRepoIds.length} repos`);

  for (let i = 0; i < uniqueRepoIds.length; i += VALIDATION_CONCURRENCY) {
    const batch = uniqueRepoIds.slice(i, i + VALIDATION_CONCURRENCY);
    const validated = await Promise.all(batch.map(async (repoId) => [repoId, await validateSkillRepo(repoId)] as const));
    for (const [repoId, valid] of validated) {
      repoCache.set(repoId, valid);
    }
    console.log(`validated ${Math.min(i + batch.length, uniqueRepoIds.length)}/${uniqueRepoIds.length} repos`);
  }

  const results: TopSkillTweet[] = [];
  for (const tweet of tweets) {
    const validSkillRepos = tweet.repo_ids
      .map((repoId) => repoCache.get(repoId))
      .filter((repo): repo is ValidSkillRepo => Boolean(repo));
    if (validSkillRepos.length === 0) continue;
    results.push({ ...tweet, valid_skill_repos: validSkillRepos });
    if (results.length >= limit) break;
  }

  if (results.length === 0) {
    const message = "x: skipped, no valid skill tweets found; preserving existing top-x-skill-tweets.json";
    if (strictMode()) throw new Error(message);
    console.warn(message);
    return;
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`wrote ${results.length} tweets -> ${outPath}`);
  console.log(JSON.stringify(results.slice(0, 5), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

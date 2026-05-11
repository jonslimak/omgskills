/**
 * Enriches gold-basket.json with live GitHub signals:
 *   forks, watchers (subscribers), open_issues, last_pushed, days_since_push
 *
 * Reads:  index/gold-basket.json
 * Writes: index/gold-basket.json (in-place, adds github_* fields)
 *
 * Usage: npm run content:enrich-basket
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { octokit } from "../client.js";
import type { GoldSkill } from "./build-gold-basket.js";

const here = dirname(fileURLToPath(import.meta.url));
const basketPath = join(here, "..", "..", "gold-basket.json");

export interface EnrichedGoldSkill extends GoldSkill {
  gh_forks: number;
  gh_watchers: number;
  gh_open_issues: number;
  gh_pushed_at: string;       // ISO date
  gh_days_since_push: number;
  gh_enriched_at: string;     // ISO date of this fetch
}

function ownerRepo(githubUrl: string): [string, string] | null {
  const m = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return [m[1], m[2].replace(/\.git$/, "")];
}

async function fetchRepoData(owner: string, repo: string) {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return {
    gh_forks: data.forks_count ?? 0,
    gh_watchers: data.subscribers_count ?? 0,  // subscribers = watchers (not stargazers)
    gh_open_issues: data.open_issues_count ?? 0,
    gh_pushed_at: data.pushed_at ?? data.updated_at ?? new Date().toISOString(),
  };
}

async function main() {
  const basket: GoldSkill[] = JSON.parse(readFileSync(basketPath, "utf8"));

  // Dedupe by repo so we don't hit the same repo multiple times
  // (multiple skills can share a repo)
  const repoCache = new Map<string, Awaited<ReturnType<typeof fetchRepoData>>>();

  const now = new Date().toISOString();
  const today = Date.now();
  const enriched: EnrichedGoldSkill[] = [];
  let fetched = 0;
  let cached = 0;
  let failed = 0;

  console.log(`Enriching ${basket.length} skills from GitHub...`);

  for (let i = 0; i < basket.length; i++) {
    const skill = basket[i];
    const parsed = ownerRepo(skill.github_url);

    if (!parsed) {
      console.warn(`  [skip] can't parse: ${skill.github_url}`);
      enriched.push({ ...skill, gh_forks: 0, gh_watchers: 0, gh_open_issues: 0, gh_pushed_at: "", gh_days_since_push: 9999, gh_enriched_at: now });
      continue;
    }

    const [owner, repo] = parsed;
    const key = `${owner}/${repo}`;

    let data = repoCache.get(key);
    if (!data) {
      try {
        data = await fetchRepoData(owner, repo);
        repoCache.set(key, data);
        fetched++;
        if (fetched % 50 === 0) console.log(`  ${fetched} repos fetched...`);
      } catch (err: any) {
        console.warn(`  [fail] ${key}: ${err.message}`);
        data = { gh_forks: 0, gh_watchers: 0, gh_open_issues: 0, gh_pushed_at: "" };
        failed++;
      }
    } else {
      cached++;
    }

    const pushedAt = data.gh_pushed_at;
    const daysSince = pushedAt
      ? Math.floor((today - new Date(pushedAt).getTime()) / 86_400_000)
      : 9999;

    enriched.push({
      ...skill,
      ...data,
      gh_days_since_push: daysSince,
      gh_enriched_at: now,
    });
  }

  writeFileSync(basketPath, JSON.stringify(enriched, null, 2) + "\n");

  console.log(`\nDone.`);
  console.log(`  ${fetched} unique repos fetched, ${cached} served from cache, ${failed} failed`);
  console.log(`  → ${basketPath}`);

  // Quick summary stats
  const valid = enriched.filter((s) => s.gh_pushed_at);
  const stale = valid.filter((s) => s.gh_days_since_push > 365);
  const avgForks = Math.round(valid.reduce((sum, s) => sum + s.gh_forks, 0) / valid.length);
  console.log(`\n  Stale (>1 year no push): ${stale.length} / ${valid.length}`);
  console.log(`  Avg forks: ${avgForks}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchHighStarSkillMdRepos, type HighStarSkillMdHit, type HighStarSkillMdSettings } from "../sources/code.js";
import type { Skill } from "../types.js";
import { indexRoot } from "./shadow-path-guard.js";
import type { ShadowRepoIndex } from "./types.js";

type AuditRow = HighStarSkillMdHit & {
  inSkills: boolean;
  inRepoIndex: boolean;
};

type AuditSkill = Skill & {
  upstream_repo?: string | null;
};

type QueryShard = {
  name: string;
  queries: string[];
};

const QUERY_SHARDS: QueryShard[] = [
  { name: "current-core", queries: ["filename:SKILL.md"] },
  { name: "current-claude", queries: ["filename:SKILL.md path:.claude/skills"] },
  { name: "current-agents", queries: ["filename:SKILL.md path:.agents/skills"] },
  { name: "current-skills", queries: ["filename:SKILL.md path:skills"] },
  { name: "size-lt-1000", queries: ["filename:SKILL.md size:<1000"] },
  { name: "size-1000-2000", queries: ["filename:SKILL.md size:1000..2000"] },
  { name: "size-2001-5000", queries: ["filename:SKILL.md size:2001..5000"] },
  { name: "size-5001-15000", queries: ["filename:SKILL.md size:5001..15000"] },
  { name: "size-gt-15000", queries: ["filename:SKILL.md size:>15000"] },
  { name: "fingerprint-preamble", queries: ["preamble-tier filename:SKILL.md"] },
  { name: "fingerprint-use-when", queries: ['"Use when" filename:SKILL.md'] },
];

function repoFromGithubUrl(url: string | null | undefined): string | null {
  const match = String(url ?? "").match(/github\.com\/([^/]+\/[^/#?]+)/i);
  return match ? match[1]!.replace(/\.git$/i, "").toLowerCase() : null;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildCurrentSkillRepoSet(skills: AuditSkill[]): Set<string> {
  const repos = new Set<string>();
  for (const skill of skills) {
    const repo = skill.upstream_repo ?? repoFromGithubUrl(skill.github_url);
    if (repo) repos.add(repo.toLowerCase());
  }
  return repos;
}

function annotateRows(
  hits: HighStarSkillMdHit[],
  skillRepos: Set<string>,
  repoIndexRepos: Set<string>,
): AuditRow[] {
  return hits.map((hit) => ({
    ...hit,
    inSkills: skillRepos.has(hit.repo),
    inRepoIndex: repoIndexRepos.has(hit.repo),
  }));
}

function summarizeRows(rows: AuditRow[], settings: HighStarSkillMdSettings) {
  const validRows = rows.filter((row) => typeof row.stars === "number" && !row.archived && !row.disabled);
  const highValueRows = validRows
    .filter((row) => (row.stars ?? 0) >= settings.minStars)
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.repo.localeCompare(b.repo));
  const covered = highValueRows.filter((row) => row.inSkills || row.inRepoIndex);
  const missing = highValueRows.filter((row) => !row.inSkills && !row.inRepoIndex);

  return {
    sampledRepos: rows.length,
    validRepos: validRows.length,
    highStarRepos: highValueRows.length,
    coveredHighStarRepos: covered.length,
    missingHighStarRepos: missing.length,
    coveragePct: highValueRows.length ? Math.round((covered.length / highValueRows.length) * 1000) / 10 : null,
    missingTop: missing.slice(0, 20).map((row) => ({
      repo: row.repo,
      stars: row.stars,
      path: row.path,
      query: row.query,
      url: row.url,
    })),
  };
}

function parseNumberArg(argv: string[], name: string, fallback: number): number {
  const raw = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split("=", 2)[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}

function parseShardFilter(argv: string[]): Set<string> | null {
  const raw = argv.find((arg) => arg.startsWith("--shards="));
  if (!raw) return null;
  return new Set(
    raw
      .split("=", 2)[1]!
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const minStars = parseNumberArg(argv, "min-stars", 500);
  const maxSampledRepos = parseNumberArg(argv, "max-sampled-repos", 100);
  const maxPagesPerQuery = parseNumberArg(argv, "max-pages-per-query", 5);
  const requestDelayMs = parseNumberArg(argv, "request-delay-ms", 500);
  const shardFilter = parseShardFilter(argv);

  const skills = loadJson<AuditSkill[]>(join(indexRoot, "skills.json"));
  const repoIndex = loadJson<ShadowRepoIndex>(join(indexRoot, "shadow", "repo-index.shadow.json"));
  const skillRepos = buildCurrentSkillRepoSet(skills);
  const repoIndexRepos = new Set(repoIndex.repos.map((repo) => repo.repo.toLowerCase()));
  const selectedShards = QUERY_SHARDS.filter((shard) => !shardFilter || shardFilter.has(shard.name));

  if (selectedShards.length === 0) {
    throw new Error("No matching shards selected");
  }

  const shardResults = [];
  for (const shard of selectedShards) {
    console.error(`audit shard ${shard.name}`);
    const { settings, hits } = await searchHighStarSkillMdRepos({
      minStars,
      maxSampledRepos,
      maxPagesPerQuery,
      requestDelayMs,
      queries: shard.queries,
      onMetaProgress: (completed, total) => {
        if (completed % 25 === 0) console.error(`  repo meta ${completed}/${total}`);
      },
    });
    const rows = annotateRows(hits, skillRepos, repoIndexRepos);
    shardResults.push({
      shard: shard.name,
      queries: shard.queries,
      ...summarizeRows(rows, settings),
    });
  }

  const totals = shardResults.reduce(
    (acc, row) => {
      acc.sampledRepos += row.sampledRepos;
      acc.highStarRepos += row.highStarRepos;
      acc.coveredHighStarRepos += row.coveredHighStarRepos;
      acc.missingHighStarRepos += row.missingHighStarRepos;
      return acc;
    },
    {
      sampledRepos: 0,
      highStarRepos: 0,
      coveredHighStarRepos: 0,
      missingHighStarRepos: 0,
    },
  );

  console.log(JSON.stringify({
    settings: {
      minStars,
      maxSampledRepos,
      maxPagesPerQuery,
      requestDelayMs,
      shardCount: selectedShards.length,
    },
    currentLibrary: {
      skills: skills.length,
      uniqueSkillRepos: skillRepos.size,
      repoIndexRepos: repoIndex.repos.length,
      repoIndexReposAtMinStars: repoIndex.repos.filter((repo) => repo.stars >= minStars).length,
    },
    totals,
    shards: shardResults.sort((a, b) => b.missingHighStarRepos - a.missingHighStarRepos || b.highStarRepos - a.highStarRepos),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

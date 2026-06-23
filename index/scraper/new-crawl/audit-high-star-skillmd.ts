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

function summarize(rows: AuditRow[], skills: AuditSkill[], repoIndex: ShadowRepoIndex, settings: HighStarSkillMdSettings) {
  const validRows = rows.filter((row) => typeof row.stars === "number" && !row.archived && !row.disabled);
  const highValueRows = validRows
    .filter((row) => (row.stars ?? 0) >= settings.minStars)
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.repo.localeCompare(b.repo));
  const covered = highValueRows.filter((row) => row.inSkills || row.inRepoIndex);
  const missing = highValueRows.filter((row) => !row.inSkills && !row.inRepoIndex);

  const byQuery: Record<string, { sampled: number; highStar: number; covered: number; missing: number }> = {};
  for (const row of rows) {
    byQuery[row.query] ??= { sampled: 0, highStar: 0, covered: 0, missing: 0 };
    const bucket = byQuery[row.query]!;
    bucket.sampled += 1;
    if (typeof row.stars === "number" && row.stars >= settings.minStars && !row.archived && !row.disabled) {
      bucket.highStar += 1;
      if (row.inSkills || row.inRepoIndex) bucket.covered += 1;
      else bucket.missing += 1;
    }
  }

  return {
    settings: {
      minStars: settings.minStars,
      maxSampledRepos: settings.maxSampledRepos,
      maxPagesPerQuery: settings.maxPagesPerQuery,
      requestDelayMs: settings.requestDelayMs,
      queries: settings.queries,
    },
    currentLibrary: {
      skills: skills.length,
      uniqueSkillRepos: buildCurrentSkillRepoSet(skills).size,
      repoIndexRepos: repoIndex.repos.length,
      repoIndexReposAtMinStars: repoIndex.repos.filter((repo) => repo.stars >= settings.minStars).length,
    },
    sample: {
      sampledRepos: rows.length,
      validRepos: validRows.length,
      highStarRepos: highValueRows.length,
      coveredHighStarRepos: covered.length,
      missingHighStarRepos: missing.length,
      coveragePct: highValueRows.length ? Math.round((covered.length / highValueRows.length) * 1000) / 10 : null,
    },
    byQuery,
    missingTop: missing.slice(0, 30).map((row) => ({
      repo: row.repo,
      stars: row.stars,
      path: row.path,
      query: row.query,
      url: row.url,
    })),
    coveredTop: covered.slice(0, 15).map((row) => ({
      repo: row.repo,
      stars: row.stars,
      inSkills: row.inSkills,
      inRepoIndex: row.inRepoIndex,
    })),
  };
}

async function main() {
  const skills = loadJson<AuditSkill[]>(join(indexRoot, "skills.json"));
  const repoIndex = loadJson<ShadowRepoIndex>(join(indexRoot, "shadow", "repo-index.shadow.json"));
  const skillRepos = buildCurrentSkillRepoSet(skills);
  const repoIndexRepos = new Set(repoIndex.repos.map((repo) => repo.repo.toLowerCase()));

  const { settings, hits } = await searchHighStarSkillMdRepos({
    onMetaProgress: (completed, total) => {
      if (completed % 25 === 0) console.error(`repo meta ${completed}/${total}`);
    },
  });
  const rows = annotateRows(hits, skillRepos, repoIndexRepos);
  console.log(JSON.stringify(summarize(rows, skills, repoIndex, settings), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

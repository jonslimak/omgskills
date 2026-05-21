import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Skill } from "../types.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";

type RepoState = "library" | "rising" | "core";

type ShadowRepoIndexEntry = {
  repo: string;
  repoUrl: string;
  state: RepoState;
  source: "baseline";
  skillIds: string[];
};

type ShadowRepoIndex = {
  generatedAt: string;
  repoCount: number;
  repos: ShadowRepoIndexEntry[];
};

type ShadowSkillSignals = {
  generatedAt: string;
  signals: Record<string, never>;
};

type StageTimings = Record<string, number>;

type ShadowRunReport = {
  checkedAt: string;
  status: "ok";
  baselineSkillCount: number;
  shadowSkillCount: number;
  carriedForwardCount: number;
  correctedCount: number;
  newlyDiscoveredCount: number;
  staleInvalidCandidateCount: number;
  stageTimings: StageTimings;
  productionWriteGuardPassed: true;
};

function writeShadowFile(path: string, content: string) {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function loadBaselineSkills(path: string): Skill[] {
  return JSON.parse(readFileSync(path, "utf8")) as Skill[];
}

function repoKeyFor(skill: Skill): { repo: string; repoUrl: string } | null {
  try {
    const url = new URL(skill.github_url);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return {
      repo: `${owner}/${repo}`,
      repoUrl: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

function buildRepoIndex(skills: Skill[]): ShadowRepoIndex {
  const byRepo = new Map<string, ShadowRepoIndexEntry>();
  for (const skill of skills) {
    const repoInfo = repoKeyFor(skill);
    if (!repoInfo) continue;
    const existing = byRepo.get(repoInfo.repo);
    if (existing) {
      existing.skillIds.push(skill.id);
      continue;
    }
    byRepo.set(repoInfo.repo, {
      repo: repoInfo.repo,
      repoUrl: repoInfo.repoUrl,
      state: "library",
      source: "baseline",
      skillIds: [skill.id],
    });
  }

  const repos = [...byRepo.values()]
    .map((entry) => ({ ...entry, skillIds: [...new Set(entry.skillIds)].sort() }))
    .sort((a, b) => a.repo.localeCompare(b.repo));

  return {
    generatedAt: new Date().toISOString(),
    repoCount: repos.length,
    repos,
  };
}

function buildSkillSignals(): ShadowSkillSignals {
  return {
    generatedAt: new Date().toISOString(),
    signals: {},
  };
}

function buildSummary(report: ShadowRunReport, repoIndex: ShadowRepoIndex) {
  return [
    "# Shadow Crawl Summary",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Baseline skills: ${report.baselineSkillCount}`,
    `- Shadow skills: ${report.shadowSkillCount}`,
    `- Carried forward: ${report.carriedForwardCount}`,
    `- Corrected: ${report.correctedCount}`,
    `- Newly discovered: ${report.newlyDiscoveredCount}`,
    `- Stale/invalid candidates: ${report.staleInvalidCandidateCount}`,
    `- Repo index entries: ${repoIndex.repoCount}`,
    `- Production write guard: ${report.productionWriteGuardPassed ? "passed" : "failed"}`,
    "",
    "## Stage timings (ms)",
    "",
    ...Object.entries(report.stageTimings).map(([stage, ms]) => `- ${stage}: ${ms}`),
    "",
  ].join("\n");
}

async function main() {
  const timings: StageTimings = {};

  const baselinePath = join(indexRoot, "skills.json");
  const skillsOutPath = join(shadowRoot, "skills.shadow.json");
  const repoIndexOutPath = join(shadowRoot, "repo-index.shadow.json");
  const skillSignalsOutPath = join(shadowRoot, "skill-signals.shadow.json");
  const reportOutPath = join(shadowRoot, "shadow-report.json");
  const summaryOutPath = join(shadowRoot, "shadow-summary.md");

  const baselineStart = performance.now();
  const baselineSkills = loadBaselineSkills(baselinePath);
  timings.loadBaseline = Math.round(performance.now() - baselineStart);

  const repoIndexStart = performance.now();
  const repoIndex = buildRepoIndex(baselineSkills);
  timings.buildRepoIndex = Math.round(performance.now() - repoIndexStart);

  const skillSignalsStart = performance.now();
  const skillSignals = buildSkillSignals();
  timings.buildSkillSignals = Math.round(performance.now() - skillSignalsStart);

  const report: ShadowRunReport = {
    checkedAt: new Date().toISOString(),
    status: "ok",
    baselineSkillCount: baselineSkills.length,
    shadowSkillCount: baselineSkills.length,
    carriedForwardCount: baselineSkills.length,
    correctedCount: 0,
    newlyDiscoveredCount: 0,
    staleInvalidCandidateCount: 0,
    stageTimings: timings,
    productionWriteGuardPassed: true,
  };

  const writeStart = performance.now();
  writeShadowFile(skillsOutPath, JSON.stringify(baselineSkills, null, 2) + "\n");
  writeShadowFile(repoIndexOutPath, JSON.stringify(repoIndex, null, 2) + "\n");
  writeShadowFile(skillSignalsOutPath, JSON.stringify(skillSignals, null, 2) + "\n");
  writeShadowFile(reportOutPath, JSON.stringify(report, null, 2) + "\n");
  writeShadowFile(summaryOutPath, buildSummary(report, repoIndex));
  timings.writeOutputs = Math.round(performance.now() - writeStart);

  const finalReport = { ...report, stageTimings: timings };
  writeShadowFile(reportOutPath, JSON.stringify(finalReport, null, 2) + "\n");
  writeShadowFile(summaryOutPath, buildSummary(finalReport, repoIndex));

  console.log(`shadow crawl complete: ${baselineSkills.length} skills, ${repoIndex.repoCount} repos`);
}

main().catch((error) => {
  console.error(`shadow crawl failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "../types.js";
import { assertGitHubCoreQuotaAvailable } from "./github-quota-guard.js";
import {
  createPinnedPackageMetadataResolver,
  pinnedPackageMetadataFromSkill,
} from "./package-metadata.js";
import {
  applyPinnedPackageMetadataOverlay,
  buildPinnedPackageMetadataOverlay,
  loadPinnedPackageMetadataOverlay,
} from "./package-metadata-overlay.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";

export const PACKAGE_METADATA_BACKFILL_QUOTA_MINIMUM = 3500;
export const PACKAGE_METADATA_BACKFILL_DEFAULT_REPO_LIMIT = 100;
export const PACKAGE_METADATA_BACKFILL_DEFAULT_SKILL_LIMIT = 125;

type Arguments = {
  mode: "plan" | "apply";
  maxRepos: number;
  maxSkills: number;
  afterRepo: string | null;
};

type BackfillResult = {
  generatedAt: string;
  sourcePath: string;
  candidateRepoCount: number;
  candidateSkillCount: number;
  selectedRepoCount: number;
  selectedSkillCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  errorCount: number;
  remainingRepoCount: number;
  remainingSkillCount: number;
  resolvedIds: string[];
  unresolved: Array<{ id: string; reason: string }>;
};

export function parsePackageMetadataBackfillArguments(args: string[]): Arguments {
  const plan = args.includes("--plan");
  const apply = args.includes("--apply");
  if (plan === apply) {
    throw new Error("Usage: npm run crawl4:backfill-package-metadata -- --plan or --apply [--max-repos=100] [--max-skills=125] [--after-repo=owner/repo]");
  }
  const unsupported = args.find((arg) =>
    arg !== "--plan" && arg !== "--apply" && !arg.startsWith("--max-repos=") && !arg.startsWith("--max-skills=") && !arg.startsWith("--after-repo="),
  );
  if (unsupported) throw new Error(`Unsupported package metadata backfill option: ${unsupported}`);
  const maxReposRaw = args.find((arg) => arg.startsWith("--max-repos="))?.slice("--max-repos=".length);
  const maxRepos = maxReposRaw === undefined ? PACKAGE_METADATA_BACKFILL_DEFAULT_REPO_LIMIT : Number(maxReposRaw);
  if (!Number.isInteger(maxRepos) || maxRepos <= 0) throw new Error("--max-repos must be a positive integer");
  const maxSkillsRaw = args.find((arg) => arg.startsWith("--max-skills="))?.slice("--max-skills=".length);
  const maxSkills = maxSkillsRaw === undefined ? PACKAGE_METADATA_BACKFILL_DEFAULT_SKILL_LIMIT : Number(maxSkillsRaw);
  if (!Number.isInteger(maxSkills) || maxSkills <= 0) throw new Error("--max-skills must be a positive integer");
  const afterRepo = args.find((arg) => arg.startsWith("--after-repo="))?.slice("--after-repo=".length).trim().toLowerCase() || null;
  return { mode: plan ? "plan" : "apply", maxRepos, maxSkills, afterRepo };
}

function readSkills(): { path: string; skills: Skill[] } {
  const cutoverPath = join(shadowRoot, "skills.cutover.shadow.json");
  const baselinePath = join(indexRoot, "skills.json");
  const path = existsSync(cutoverPath) ? cutoverPath : baselinePath;
  return { path, skills: JSON.parse(readFileSync(path, "utf8")) as Skill[] };
}

function repoKey(skill: Skill): string | null {
  if (skill.repo_slug) return skill.repo_slug.toLowerCase();
  try {
    const url = new URL(skill.github_url);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
    return owner && repo ? `${owner}/${repo}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function buildPackageMetadataBackfillCandidates(skills: Skill[]): Map<string, Skill[]> {
  const byRepo = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (pinnedPackageMetadataFromSkill(skill)) continue;
    if (!skill.skill_md_sha) continue;
    const repo = repoKey(skill);
    if (!repo) continue;
    const rows = byRepo.get(repo) ?? [];
    rows.push(skill);
    byRepo.set(repo, rows);
  }
  return new Map(
    [...byRepo.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repo, rows]) => [repo, rows.sort((left, right) => left.id.localeCompare(right.id))] as const),
  );
}

function atomicWriteJson(path: string, value: unknown): void {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function atomicWriteText(path: string, value: string): void {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, path);
}

function renderReport(report: BackfillResult): string {
  return [
    "# Pinned Install Metadata Backfill",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Source: ${report.sourcePath}`,
    `- Candidate repos: ${report.candidateRepoCount}`,
    `- Candidate skills: ${report.candidateSkillCount}`,
    `- Selected repos: ${report.selectedRepoCount}`,
    `- Selected skills: ${report.selectedSkillCount}`,
    `- Resolved: ${report.resolvedCount}`,
    `- Unresolved: ${report.unresolvedCount}`,
    `- Errors: ${report.errorCount}`,
    `- Remaining repos: ${report.remainingRepoCount}`,
    `- Remaining skills: ${report.remainingSkillCount}`,
    "",
    "## Unresolved Sample",
    "",
    ...(report.unresolved.slice(0, 25).map((row) => `- ${row.id}: ${row.reason}`)),
    ...(report.unresolved.length === 0 ? ["- none"] : []),
    "",
  ].join("\n");
}

async function run(args: Arguments): Promise<void> {
  const overlayPath = join(shadowRoot, "package-metadata.overlay.json");
  const { path: sourcePath, skills: sourceSkills } = readSkills();
  const existingOverlay = loadPinnedPackageMetadataOverlay(overlayPath);
  const skills = applyPinnedPackageMetadataOverlay("combined", sourceSkills, existingOverlay).skills;
  const candidates = buildPackageMetadataBackfillCandidates(skills);
  const allRepos = [...candidates.keys()];
  const eligibleRepos = args.afterRepo ? allRepos.filter((repo) => repo > args.afterRepo!) : allRepos;
  const selectedRepos: string[] = [];
  const selectedSkills: Skill[] = [];
  for (const repo of eligibleRepos) {
    if (selectedRepos.length >= args.maxRepos || selectedSkills.length >= args.maxSkills) break;
    const rows = candidates.get(repo) ?? [];
    const remaining = args.maxSkills - selectedSkills.length;
    if (remaining <= 0) break;
    selectedRepos.push(repo);
    selectedSkills.push(...rows.slice(0, remaining));
  }
  const eligibleSkillCount = eligibleRepos.reduce((sum, repo) => sum + (candidates.get(repo)?.length ?? 0), 0);
  const lastSelectedRepo = selectedRepos.at(-1);
  const lastSelectedRepoComplete = !lastSelectedRepo || selectedSkills.filter((skill) => repoKey(skill) === lastSelectedRepo).length === candidates.get(lastSelectedRepo)?.length;
  const remainingRepoCount = Math.max(0, eligibleRepos.length - selectedRepos.length + (lastSelectedRepoComplete ? 0 : 1));
  const remainingSkillCount = Math.max(0, eligibleSkillCount - selectedSkills.length);

  if (args.mode === "plan") {
    console.log(JSON.stringify({
      sourcePath,
      candidateRepoCount: allRepos.length,
      candidateSkillCount: [...candidates.values()].reduce((sum, rows) => sum + rows.length, 0),
      selectedRepoCount: selectedRepos.length,
      selectedSkillCount: selectedSkills.length,
      remainingRepoCount,
      remainingSkillCount,
      selectedRepos: selectedRepos.map((repo) => ({
        repo,
        candidateSkillCount: candidates.get(repo)?.length ?? 0,
        selectedSkillCount: selectedSkills.filter((skill) => repoKey(skill) === repo).length,
      })),
    }, null, 2));
    return;
  }

  await assertGitHubCoreQuotaAvailable(
    PACKAGE_METADATA_BACKFILL_QUOTA_MINIMUM,
    "pinned package metadata backfill",
  );
  const { octokit } = await import("../client.js");
  const resolve = createPinnedPackageMetadataResolver(octokit);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const resolvedIds: string[] = [];
  const unresolved: Array<{ id: string; reason: string }> = [];
  let errorCount = 0;

  for (const [index, skill] of selectedSkills.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index === selectedSkills.length - 1) {
      console.log(`  package metadata [${index + 1}/${selectedSkills.length}] ${skill.id}`);
    }
    try {
      const metadata = await resolve(skill);
      if (!metadata) {
        unresolved.push({ id: skill.id, reason: "path/tree/blob could not be proven" });
        continue;
      }
      byId.set(skill.id, { ...skill, ...metadata });
      resolvedIds.push(skill.id);
    } catch (error) {
      errorCount += 1;
      unresolved.push({ id: skill.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const generatedAt = new Date().toISOString();
  const overlay = buildPinnedPackageMetadataOverlay([...byId.values()], generatedAt);
  const report: BackfillResult = {
    generatedAt,
    sourcePath,
    candidateRepoCount: allRepos.length,
    candidateSkillCount: [...candidates.values()].reduce((sum, rows) => sum + rows.length, 0),
    selectedRepoCount: selectedRepos.length,
    selectedSkillCount: selectedSkills.length,
    resolvedCount: resolvedIds.length,
    unresolvedCount: unresolved.length,
    errorCount,
    remainingRepoCount,
    remainingSkillCount,
    resolvedIds: resolvedIds.sort(),
    unresolved: unresolved.sort((left, right) => left.id.localeCompare(right.id)),
  };
  atomicWriteJson(overlayPath, overlay);
  atomicWriteJson(join(shadowRoot, "package-metadata-backfill.json"), report);
  const markdownPath = join(shadowRoot, "package-metadata-backfill.md");
  atomicWriteText(markdownPath, renderReport(report));
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(parsePackageMetadataBackfillArguments(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

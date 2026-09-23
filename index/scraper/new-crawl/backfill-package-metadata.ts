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

export type PackageMetadataBackfillArguments = {
  mode: "plan" | "apply";
  maxRepos: number;
  maxSkills: number;
  afterRepo: string | null;
  skillIds: string[];
  commitRefs: Map<string, string>;
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
  explicitSelection: boolean;
  selectedSkillIds: string[];
  commitRefs: Record<string, string>;
};

function repeatedValues(args: string[], prefix: string): string[] {
  return args.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length).trim());
}

export function parsePackageMetadataBackfillArguments(args: string[]): PackageMetadataBackfillArguments {
  const plan = args.includes("--plan");
  const apply = args.includes("--apply");
  if (plan === apply) {
    throw new Error("Usage: npm run crawl4:backfill-package-metadata -- --plan or --apply [--max-repos=100] [--max-skills=125] [--after-repo=owner/repo] [--skill-id=owner/repo:skill] [--commit-ref=owner/repo:skill=<40-hex-sha>]");
  }
  const unsupported = args.find((arg) =>
    arg !== "--plan" &&
    arg !== "--apply" &&
    !arg.startsWith("--max-repos=") &&
    !arg.startsWith("--max-skills=") &&
    !arg.startsWith("--after-repo=") &&
    !arg.startsWith("--skill-id=") &&
    !arg.startsWith("--commit-ref="),
  );
  if (unsupported) throw new Error(`Unsupported package metadata backfill option: ${unsupported}`);
  const maxReposRaw = args.find((arg) => arg.startsWith("--max-repos="))?.slice("--max-repos=".length);
  const maxRepos = maxReposRaw === undefined ? PACKAGE_METADATA_BACKFILL_DEFAULT_REPO_LIMIT : Number(maxReposRaw);
  if (!Number.isInteger(maxRepos) || maxRepos <= 0) throw new Error("--max-repos must be a positive integer");
  const maxSkillsRaw = args.find((arg) => arg.startsWith("--max-skills="))?.slice("--max-skills=".length);
  const maxSkills = maxSkillsRaw === undefined ? PACKAGE_METADATA_BACKFILL_DEFAULT_SKILL_LIMIT : Number(maxSkillsRaw);
  if (!Number.isInteger(maxSkills) || maxSkills <= 0) throw new Error("--max-skills must be a positive integer");
  const afterRepo = args.find((arg) => arg.startsWith("--after-repo="))?.slice("--after-repo=".length).trim().toLowerCase() || null;
  const skillIds = repeatedValues(args, "--skill-id=");
  if (skillIds.some((id) => !id)) throw new Error("--skill-id must not be empty");
  if (new Set(skillIds).size !== skillIds.length) throw new Error("Duplicate --skill-id values are not allowed");
  if (skillIds.length > maxSkills) throw new Error(`Exact selection has ${skillIds.length} skills, exceeding --max-skills=${maxSkills}`);
  if (skillIds.length > 0 && afterRepo) throw new Error("--after-repo cannot be combined with --skill-id");

  const commitRefs = new Map<string, string>();
  for (const raw of repeatedValues(args, "--commit-ref=")) {
    const separator = raw.lastIndexOf("=");
    const id = separator > 0 ? raw.slice(0, separator).trim() : "";
    const ref = separator > 0 ? raw.slice(separator + 1).trim().toLowerCase() : "";
    if (!id || !/^[0-9a-f]{40}$/.test(ref)) {
      throw new Error("--commit-ref must use --commit-ref=<skill-id>=<40-hex-sha>");
    }
    if (!skillIds.includes(id)) throw new Error(`--commit-ref requires a matching --skill-id: ${id}`);
    if (commitRefs.has(id)) throw new Error(`Duplicate --commit-ref for ${id}`);
    commitRefs.set(id, ref);
  }

  return { mode: plan ? "plan" : "apply", maxRepos, maxSkills, afterRepo, skillIds, commitRefs };
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

type PackageMetadataBackfillSelection = {
  candidates: Map<string, Skill[]>;
  allRepos: string[];
  selectedRepos: string[];
  selectedSkills: Skill[];
  remainingRepoCount: number;
  remainingSkillCount: number;
};

export function selectPackageMetadataBackfillBatch(
  skills: Skill[],
  args: Pick<PackageMetadataBackfillArguments, "maxRepos" | "maxSkills" | "afterRepo" | "skillIds">,
): PackageMetadataBackfillSelection {
  const candidates = buildPackageMetadataBackfillCandidates(skills);
  const allRepos = [...candidates.keys()];

  if (args.skillIds.length > 0) {
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    const selectedSkills = args.skillIds.map((id) => {
      const selected = byId.get(id);
      if (!selected) throw new Error(`Unknown --skill-id: ${id}`);
      if (pinnedPackageMetadataFromSkill(selected)) throw new Error(`Selected skill already has complete pinned metadata: ${id}`);
      if (!selected.skill_md_sha) throw new Error(`Selected skill has no skill_md_sha: ${id}`);
      if (!repoKey(selected)) throw new Error(`Selected skill has no valid GitHub repository: ${id}`);
      return selected;
    }).sort((left, right) => left.id.localeCompare(right.id));
    const selectedRepos = [...new Set(selectedSkills.map(repoKey).filter((repo): repo is string => Boolean(repo)))].sort();
    if (selectedRepos.length > args.maxRepos) {
      throw new Error(`Exact selection has ${selectedRepos.length} repos, exceeding --max-repos=${args.maxRepos}`);
    }
    return {
      candidates,
      allRepos,
      selectedRepos,
      selectedSkills,
      remainingRepoCount: Math.max(0, allRepos.length - selectedRepos.filter((repo) => candidates.has(repo)).length),
      remainingSkillCount: Math.max(
        0,
        [...candidates.values()].reduce((sum, rows) => sum + rows.length, 0) - selectedSkills.length,
      ),
    };
  }

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
  return {
    candidates,
    allRepos,
    selectedRepos,
    selectedSkills,
    remainingRepoCount: Math.max(0, eligibleRepos.length - selectedRepos.length + (lastSelectedRepoComplete ? 0 : 1)),
    remainingSkillCount: Math.max(0, eligibleSkillCount - selectedSkills.length),
  };
}

export function assertExplicitPackageMetadataBatchComplete(
  selectedSkillIds: string[],
  resolvedIds: string[],
  unresolved: Array<{ id: string; reason: string }>,
): void {
  if (selectedSkillIds.length === 0) return;
  const resolved = new Set(resolvedIds);
  const missing = selectedSkillIds.filter((id) => !resolved.has(id));
  if (unresolved.length > 0 || missing.length > 0) {
    const detail = unresolved.map((row) => `${row.id}: ${row.reason}`).join("; ") || missing.join(", ");
    throw new Error(`Exact package metadata batch failed atomically; no files were written: ${detail}`);
  }
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

async function run(args: PackageMetadataBackfillArguments): Promise<void> {
  const overlayPath = join(shadowRoot, "package-metadata.overlay.json");
  const { path: sourcePath, skills: sourceSkills } = readSkills();
  const existingOverlay = loadPinnedPackageMetadataOverlay(overlayPath);
  const skills = applyPinnedPackageMetadataOverlay("combined", sourceSkills, existingOverlay).skills;
  const {
    candidates,
    allRepos,
    selectedRepos,
    selectedSkills,
    remainingRepoCount,
    remainingSkillCount,
  } = selectPackageMetadataBackfillBatch(skills, args);

  if (args.mode === "plan") {
    console.log(JSON.stringify({
      sourcePath,
      candidateRepoCount: allRepos.length,
      candidateSkillCount: [...candidates.values()].reduce((sum, rows) => sum + rows.length, 0),
      selectedRepoCount: selectedRepos.length,
      selectedSkillCount: selectedSkills.length,
      remainingRepoCount,
      remainingSkillCount,
      explicitSelection: args.skillIds.length > 0,
      selectedSkillIds: selectedSkills.map((skill) => skill.id),
      commitRefs: Object.fromEntries([...args.commitRefs.entries()].sort(([left], [right]) => left.localeCompare(right))),
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
      const metadata = await resolve(skill, args.commitRefs.get(skill.id));
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

  assertExplicitPackageMetadataBatchComplete(args.skillIds, resolvedIds, unresolved);

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
    explicitSelection: args.skillIds.length > 0,
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    commitRefs: Object.fromEntries([...args.commitRefs.entries()].sort(([left], [right]) => left.localeCompare(right))),
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

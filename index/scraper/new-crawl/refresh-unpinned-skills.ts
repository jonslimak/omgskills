import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnrichResult } from "../enrich.js";
import type { Skill } from "../types.js";
import { buildCandidateFromSkill } from "./candidate-path.js";
import { pinnedPackageMetadataFromSkill, type PinnedPackageMetadata } from "./package-metadata.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";

// Re-reads unpinned skills the way the scheduled refresh does (which only reaches each repo's
// top skill), then pins the refreshed content. Outcomes accumulate in a shadow state file so
// batches resume where they stopped; nothing outside index/shadow is written. GitHub modules load
// only for --apply, so planning and tests need no token.

export const SKILL_REFRESH_QUOTA_MINIMUM = 3500;
export const SKILL_REFRESH_DEFAULT_REPO_LIMIT = 100;
export const SKILL_REFRESH_DEFAULT_SKILL_LIMIT = 500;
export const skillRefreshStatePath = join(shadowRoot, "skill-refresh.state.json");

export type SkillRefreshOutcome =
  | "refreshed-pinned"
  | "refreshed-unpinned"
  | "repo-missing"
  | "skill-file-missing"
  | "invalid-frontmatter"
  | "repo-moved"
  | "path-changed"
  | "error";

export type SkillRefreshEntry = {
  id: string;
  outcome: SkillRefreshOutcome;
  checkedAt: string;
  /** The refreshed record, for outcomes that publish one. */
  record?: Skill;
  /** owner/repo GitHub now reports, for repo-moved. */
  movedTo?: string;
  /** SKILL.md path the crawler resolved instead, for path-changed. */
  resolvedPath?: string;
  detail?: string;
};

export type SkillRefreshState = { version: 1; updatedAt: string; entries: SkillRefreshEntry[] };

export type SkillRefreshArguments = {
  mode: "plan" | "apply";
  maxRepos: number;
  maxSkills: number;
  retryErrors: boolean;
};

export function parseSkillRefreshArguments(args: string[]): SkillRefreshArguments {
  const plan = args.includes("--plan");
  const apply = args.includes("--apply");
  if (plan === apply) {
    throw new Error("Usage: npm run crawl4:refresh-unpinned -- --plan or --apply [--max-repos=100] [--max-skills=500] [--retry-errors]");
  }
  const unsupported = args.find((arg) =>
    arg !== "--plan" && arg !== "--apply" && arg !== "--retry-errors" &&
    !arg.startsWith("--max-repos=") && !arg.startsWith("--max-skills="),
  );
  if (unsupported) throw new Error(`Unsupported skill refresh option: ${unsupported}`);
  const positive = (name: string, fallback: number) => {
    const raw = args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
    return value;
  };
  return {
    mode: plan ? "plan" : "apply",
    maxRepos: positive("max-repos", SKILL_REFRESH_DEFAULT_REPO_LIMIT),
    maxSkills: positive("max-skills", SKILL_REFRESH_DEFAULT_SKILL_LIMIT),
    retryErrors: args.includes("--retry-errors"),
  };
}

export function repoKeyFromUrl(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
    return owner && repo ? `${owner}/${repo}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function loadSkillRefreshState(path = skillRefreshStatePath): SkillRefreshState {
  if (!existsSync(path)) return { version: 1, updatedAt: "", entries: [] };
  return JSON.parse(readFileSync(path, "utf8")) as SkillRefreshState;
}

/** Later entries replace earlier ones for the same skill. */
export function mergeSkillRefreshState(state: SkillRefreshState, entries: SkillRefreshEntry[], updatedAt: string): SkillRefreshState {
  const byId = new Map(state.entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) byId.set(entry.id, entry);
  return { version: 1, updatedAt, entries: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)) };
}

/** Unpinned skills not yet settled in the state, grouped by repository in sorted order. */
export function selectSkillRefreshBatch(
  skills: Skill[],
  state: SkillRefreshState,
  args: Pick<SkillRefreshArguments, "maxRepos" | "maxSkills" | "retryErrors">,
) {
  const settled = new Set(state.entries.filter((entry) => !(args.retryErrors && entry.outcome === "error")).map((entry) => entry.id));
  const byRepo = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (pinnedPackageMetadataFromSkill(skill) || settled.has(skill.id)) continue;
    const repo = repoKeyFromUrl(skill.github_url);
    if (!repo) continue;
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), skill]);
  }
  const repos = [...byRepo.keys()].sort();
  const selectedRepos: string[] = [];
  const selectedSkills: Skill[] = [];
  for (const repo of repos) {
    if (selectedRepos.length >= args.maxRepos || selectedSkills.length >= args.maxSkills) break;
    selectedRepos.push(repo);
    selectedSkills.push(...byRepo.get(repo)!.sort((left, right) => left.id.localeCompare(right.id)).slice(0, args.maxSkills - selectedSkills.length));
  }
  const candidateSkillCount = [...byRepo.values()].reduce((sum, rows) => sum + rows.length, 0);
  return {
    candidateRepoCount: repos.length,
    candidateSkillCount,
    selectedRepos,
    selectedSkills,
    remainingSkillCount: candidateSkillCount - selectedSkills.length,
  };
}

/**
 * True when the refreshed SKILL.md is the same skill: its stored path is unchanged or, with no
 * stored path, its folder matches the ID (or, for a root-level ID, its name is unchanged).
 */
export function isSameSkillPath(skill: Skill, refreshed: Skill): boolean {
  const path = refreshed.skill_md_path ?? "";
  if (skill.skill_md_path) return skill.skill_md_path === path;
  const leaf = (skill.id.includes(":") ? skill.id.slice(skill.id.indexOf(":") + 1) : "").split("/").pop() ?? "";
  if (!leaf) return refreshed.name === skill.name;
  const folder = path.replace(/\/?SKILL\.md$/i, "").split("/").pop() ?? "";
  return folder.toLowerCase() === leaf.toLowerCase();
}

/** Classifies one refresh: the crawler's enrichment result, then the pin for its content. */
export function classifySkillRefresh(
  skill: Skill,
  result: EnrichResult,
  metadata: PinnedPackageMetadata | null,
  checkedAt: string,
): SkillRefreshEntry {
  const base = { id: skill.id, checkedAt };
  if (!result.skill) {
    const reason = result.failure?.reason ?? "";
    if (reason === "repo-404") return { ...base, outcome: "repo-missing" };
    if (reason === "skill-file-404" || reason === "skill-path-unresolved") return { ...base, outcome: "skill-file-missing", detail: reason };
    if (reason === "missing-frontmatter") return { ...base, outcome: "invalid-frontmatter" };
    return { ...base, outcome: "error", detail: reason || "enrichment failed" };
  }
  // A transferred or renamed repository changes the skill's source; that needs review, not a refresh.
  const movedTo = repoKeyFromUrl(result.skill.github_url);
  if (movedTo !== repoKeyFromUrl(skill.github_url)) return { ...base, outcome: "repo-moved", movedTo: movedTo ?? result.skill.github_url };
  // When the original folder is gone the crawler can resolve another skill in the same repository.
  if (!isSameSkillPath(skill, result.skill)) return { ...base, outcome: "path-changed", resolvedPath: result.skill.skill_md_path };
  return metadata
    ? { ...base, outcome: "refreshed-pinned", record: { ...result.skill, ...metadata } }
    : { ...base, outcome: "refreshed-unpinned", record: result.skill };
}

function writeShadowJson(path: string, value: unknown) {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function countOutcomes(entries: SkillRefreshEntry[]) {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.outcome] = (counts[entry.outcome] ?? 0) + 1;
  return counts;
}

async function run(args: SkillRefreshArguments): Promise<void> {
  const skillsPath = join(indexRoot, "skills.json");
  const skills = JSON.parse(readFileSync(skillsPath, "utf8")) as Skill[];
  const state = loadSkillRefreshState();
  const batch = selectSkillRefreshBatch(skills, state, args);
  const summary = {
    sourcePath: skillsPath,
    candidateRepoCount: batch.candidateRepoCount,
    candidateSkillCount: batch.candidateSkillCount,
    selectedRepoCount: batch.selectedRepos.length,
    selectedSkillCount: batch.selectedSkills.length,
    remainingSkillCount: batch.remainingSkillCount,
    lastSelectedRepo: batch.selectedRepos.at(-1) ?? null,
  };
  if (args.mode === "plan") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const { assertGitHubCoreQuotaAvailable } = await import("./github-quota-guard.js");
  await assertGitHubCoreQuotaAvailable(SKILL_REFRESH_QUOTA_MINIMUM, "unpinned skill refresh");
  const { octokit } = await import("../client.js");
  const { enrichCandidate } = await import("../enrich.js");
  const { createPinnedPackageMetadataResolver } = await import("./package-metadata.js");
  const resolve = createPinnedPackageMetadataResolver(octokit);
  const existingSkills = new Map(skills.map((skill) => [skill.id, skill]));
  const firstSeen = new Map(skills.map((skill) => [skill.id, skill.first_seen]));
  const today = new Date().toISOString().slice(0, 10);
  const entries: SkillRefreshEntry[] = [];

  for (const [index, skill] of batch.selectedSkills.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index === batch.selectedSkills.length - 1) {
      console.log(`  skill refresh [${index + 1}/${batch.selectedSkills.length}] ${skill.id}`);
    }
    const checkedAt = new Date().toISOString();
    try {
      const result = await enrichCandidate(buildCandidateFromSkill(skill), firstSeen, existingSkills, today);
      const metadata = result.skill && repoKeyFromUrl(result.skill.github_url) === repoKeyFromUrl(skill.github_url) &&
        isSameSkillPath(skill, result.skill)
        ? await resolve(result.skill)
        : null;
      entries.push(classifySkillRefresh(skill, result, metadata, checkedAt));
    } catch (error) {
      entries.push({ id: skill.id, outcome: "error", checkedAt, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const generatedAt = new Date().toISOString();
  const next = mergeSkillRefreshState(state, entries, generatedAt);
  writeShadowJson(skillRefreshStatePath, next);
  const report = { generatedAt, ...summary, batchOutcomes: countOutcomes(entries), totalOutcomes: countOutcomes(next.entries) };
  writeShadowJson(join(shadowRoot, "skill-refresh-batch.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(parseSkillRefreshArguments(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

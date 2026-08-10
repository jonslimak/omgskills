import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { octokit } from "../client.js";
import {
  loadCreatorRegistry,
  normalizeCreatorHandle,
  type CreatorRegistryEntry,
} from "../creator-registry.js";
import type { Skill } from "../types.js";
import { effectivePolicyDigest } from "../policy/digest.js";
import { evaluateEffectiveRepoPolicy } from "../policy/effective-policy.js";
import { loadPolicySources, typedPolicySources } from "../policy/loader.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import {
  buildCreatorBackfillPlan,
  CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM,
  CREATOR_BACKFILL_QUOTA_RESERVE,
  executeCreatorBackfillPlan,
  selectCreatorBackfillCoverageEntries,
  type CreatorBackfillPlan,
  type CreatorBackfillRepoScan,
} from "./creator-backfill-plan.js";
import { assertGitHubCoreQuotaAvailable } from "./github-quota-guard.js";
import { loadTrustedSeeds } from "./seeds.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";
import type { ShadowSkillOverlay, TrustedSeeds } from "./types.js";
import { normalizePolicyRepo } from "../../../scripts/policy-identifiers.mjs";

const planPath = join(shadowRoot, "creator-backfill.plan.json");
const quotaRecheckTreeInterval = 25;

type RepoMetadata = {
  repo: string;
  repoFullName: string;
  repoUrl: string;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  aliases: string[];
};

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function atomicWritePlan(path: string, plan: CreatorBackfillPlan): void {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function sourceCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(indexRoot, ".."), encoding: "utf8" }).trim();
}

function parseArguments(args: string[]): { creatorFilters: string[] } {
  if (!args.includes("--plan")) {
    throw new Error("Usage: npm run crawl4:creator-backfill -- --plan [--creators=owner,owner]");
  }
  const unsupported = args.filter((arg) => arg !== "--plan" && !arg.startsWith("--creators="));
  if (unsupported.length) throw new Error(`Unsupported creator backfill option: ${unsupported[0]}`);
  const creatorFilters = args
    .filter((arg) => arg.startsWith("--creators="))
    .flatMap((arg) => arg.slice("--creators=".length).split(","))
    .map(normalizeCreatorHandle)
    .filter(Boolean);
  return { creatorFilters: [...new Set(creatorFilters)].sort() };
}

function toRepoMetadata(repo: {
  full_name?: string | null;
  name: string;
  owner?: { login?: string } | null;
  html_url?: string | null;
  default_branch?: string | null;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
}, fallbackRepo: string): RepoMetadata {
  const repoFullName = repo.full_name ?? `${repo.owner?.login ?? fallbackRepo.split("/")[0]}/${repo.name}`;
  const canonical = normalizePolicyRepo(repoFullName);
  const fallback = normalizePolicyRepo(fallbackRepo);
  return {
    repo: canonical,
    repoFullName,
    repoUrl: repo.html_url ?? `https://github.com/${repoFullName}`,
    defaultBranch: repo.default_branch ?? "main",
    archived: Boolean(repo.archived),
    disabled: Boolean(repo.disabled),
    fork: Boolean(repo.fork),
    aliases: fallback && fallback !== canonical ? [fallback] : [],
  };
}

async function listOwnedRepos(owner: string): Promise<RepoMetadata[]> {
  const repos = await octokit.paginate(octokit.rest.repos.listForUser, {
    username: owner,
    type: "owner",
    sort: "full_name",
    direction: "asc",
    per_page: 100,
  });
  return repos.map((repo) => toRepoMetadata(repo, `${owner}/${repo.name}`));
}

async function getRepo(repo: string): Promise<RepoMetadata> {
  const [owner, repoName] = normalizePolicyRepo(repo).split("/");
  if (!owner || !repoName) throw new Error(`Invalid selected creator repository: ${repo}`);
  const response = await octokit.rest.repos.get({ owner, repo: repoName });
  return toRepoMetadata(response.data, repo);
}

async function getTree(repo: RepoMetadata): Promise<{ paths: string[]; truncated: boolean }> {
  const [owner, repoName] = repo.repo.split("/");
  if (!owner || !repoName) throw new Error(`Invalid canonical creator repository: ${repo.repo}`);
  const response = await octokit.rest.git.getTree({
    owner,
    repo: repoName,
    tree_sha: repo.defaultBranch,
    recursive: "true",
  });
  return {
    paths: response.data.tree.map((entry) => entry.path ?? "").filter(Boolean),
    truncated: Boolean(response.data.truncated),
  };
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

async function collectScans(entries: CreatorRegistryEntry[], seeds: TrustedSeeds): Promise<CreatorBackfillRepoScan[]> {
  const scans: CreatorBackfillRepoScan[] = [];
  let treeRequests = 0;
  for (const entry of entries) {
    const creatorHandle = normalizeCreatorHandle(entry.handle);
    const coverage = entry.skillCoverage;
    if (!coverage) continue;
    const approvedRepos = new Set((entry.skillRepos ?? []).map(normalizePolicyRepo));
    const repos = coverage === "selected"
      ? await Promise.all([...approvedRepos].sort().map(getRepo))
      : await listOwnedRepos(entry.handle);
    await assertGitHubCoreQuotaAvailable(CREATOR_BACKFILL_QUOTA_RESERVE, "creator backfill reserve check");

    const byRepo = new Map<string, RepoMetadata>();
    for (const repo of repos) {
      const existing = byRepo.get(repo.repo);
      byRepo.set(repo.repo, existing ? { ...repo, aliases: [...new Set([...existing.aliases, ...repo.aliases])].sort() } : repo);
    }

    for (const repo of [...byRepo.values()].sort((left, right) => left.repo.localeCompare(right.repo))) {
      const explicitlyApproved = approvedRepos.has(repo.repo) || repo.aliases.some((alias) => approvedRepos.has(alias));
      const repoPolicy = evaluateEffectiveRepoPolicy(repo.repo, seeds);
      const skipTree = repo.archived || repo.disabled || repo.fork || repoPolicy.excluded
        || isKnownCatalogRepo(repo.repo, seeds.catalogRepoRules);
      let paths: string[] = [];
      let treeTruncated = false;
      let treeUnavailableReason: "empty-repository" | undefined;
      if (!skipTree) {
        if (treeRequests > 0 && treeRequests % quotaRecheckTreeInterval === 0) {
          await assertGitHubCoreQuotaAvailable(CREATOR_BACKFILL_QUOTA_RESERVE, "creator backfill reserve check");
        }
        treeRequests += 1;
        try {
          const tree = await getTree(repo);
          paths = tree.paths;
          treeTruncated = tree.truncated;
        } catch (error) {
          if (errorStatus(error) !== 409) throw error;
          treeUnavailableReason = "empty-repository";
        }
      }
      scans.push({
        creatorHandle,
        coverage,
        explicitlyApproved,
        ...repo,
        paths,
        treeTruncated,
        ...(treeUnavailableReason ? { treeUnavailableReason } : {}),
      });
    }
  }
  return scans;
}

function loadExistingSkills(): Skill[] {
  const baseline = readJson<Skill[]>(join(indexRoot, "skills.json"), []);
  const cutover = readJson<Skill[]>(join(shadowRoot, "skills.cutover.shadow.json"), []);
  const overlay = readJson<ShadowSkillOverlay>(join(shadowRoot, "skills.overlay.json"), {
    generatedAt: "",
    skillCount: 0,
    skills: [],
  });
  return [...baseline, ...cutover, ...overlay.skills];
}

async function main(): Promise<void> {
  const { creatorFilters } = parseArguments(process.argv.slice(2));
  const registry = loadCreatorRegistry();
  const entries = selectCreatorBackfillCoverageEntries(registry.entries, creatorFilters, registry.aliasToCanonical);
  if (!entries.length) throw new Error("No creator skill coverage entries are configured.");
  const seeds = loadTrustedSeeds("manual-command");
  const loadedPolicy = loadPolicySources();
  const generatedAt = new Date().toISOString();
  const existingSkills = loadExistingSkills();

  const plan = await executeCreatorBackfillPlan({
    preflight: async () => {
      const quota = await assertGitHubCoreQuotaAvailable(
        CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM,
        "creator backfill planning",
      );
      return quota.remaining;
    },
    collectScans: () => collectScans(entries, seeds),
    build: (initialQuotaRemaining, scans) => buildCreatorBackfillPlan({
      generatedAt,
      sourceCommit: sourceCommit(),
      policyDigest: effectivePolicyDigest(typedPolicySources(loadedPolicy)),
      initialQuotaRemaining,
      scans,
      existingSkills,
      seeds,
    }),
    write: (value) => atomicWritePlan(planPath, value),
  });

  console.log(`creator backfill plan: ${planPath}`);
  console.log(`  creators: ${plan.summary.creatorCount}`);
  console.log(`  repositories: ${plan.summary.repositoryCount}`);
  console.log(`  discovered SKILL.md files: ${plan.summary.discoveredSkillCount}`);
  console.log(`  candidates: ${plan.summary.candidateCount}`);
  console.log(`  excluded/review: ${plan.summary.excludedCount}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { octokit } from "../client.js";
import { enrichCandidate, type Candidate } from "../enrich.js";
import {
  loadCreatorRegistry,
  normalizeCreatorHandle,
  type CreatorRegistryEntry,
} from "../creator-registry.js";
import type { Skill } from "../types.js";
import { effectivePolicyDigest } from "../policy/digest.js";
import {
  evaluateEffectiveRepoPolicy,
  evaluateEffectiveSkillPolicy,
  repoFromGithubUrl,
} from "../policy/effective-policy.js";
import { loadPolicySources, typedPolicySources } from "../policy/loader.js";
import { toShadowSkillRecord } from "./add-curated-skill.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import {
  executeCreatorBackfillApply,
  parseCreatorBackfillApplyLimit,
  type CreatorBackfillApplyProgress,
  type CreatorBackfillPersistResult,
} from "./creator-backfill-apply.js";
import {
  buildCreatorBackfillPlan,
  CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM,
  CREATOR_BACKFILL_PLAN_VERSION,
  CREATOR_BACKFILL_QUOTA_RESERVE,
  executeCreatorBackfillPlan,
  selectCreatorBackfillCoverageEntries,
  type CreatorBackfillPlan,
  type CreatorBackfillRepoScan,
} from "./creator-backfill-plan.js";
import {
  assertGitHubCoreQuotaAvailable,
  getGitHubCoreQuota,
} from "./github-quota-guard.js";
import { loadTrustedSeeds } from "./seeds.js";
import { assertShadowPath, indexRoot, shadowRoot } from "./shadow-path-guard.js";
import type { ShadowSkillOverlay, TrustedSeeds } from "./types.js";
import {
  normalizePolicyRepo,
  normalizePolicySkillId,
} from "../../../scripts/policy-identifiers.mjs";
import { deriveSkillPathFromId } from "./candidate-path.js";
import {
  commitShadowSkillPersistence,
  CREATOR_BACKFILL_SOURCE,
  loadShadowSkillPersistenceSnapshot,
  prepareShadowSkillPersistence,
  type ShadowSkillPersistenceAddition,
} from "./shadow-skill-persistence.js";

const planPath = join(shadowRoot, "creator-backfill.plan.json");
const progressPath = join(shadowRoot, "creator-backfill.apply.json");
const quotaRecheckTreeInterval = 25;
const applyQuotaSafetyBuffer = 100;

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

function atomicWriteShadowJson(path: string, value: unknown): void {
  assertShadowPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function sourceCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(indexRoot, ".."), encoding: "utf8" }).trim();
}

export function parseCreatorBackfillArguments(args: string[]): {
  mode: "plan" | "apply" | "maintain";
  creatorFilters: string[];
  limit: number;
} {
  const plan = args.includes("--plan");
  const apply = args.includes("--apply");
  const maintain = args.includes("--maintain");
  if ([plan, apply, maintain].filter(Boolean).length !== 1) {
    throw new Error(
      "Usage: npm run crawl4:creator-backfill -- --plan [--creators=owner,owner], --apply [--limit=125], or --maintain [--limit=125]",
    );
  }
  const supported = (arg: string) => arg === "--plan" || arg === "--apply" || arg === "--maintain"
    || arg.startsWith("--creators=") || arg.startsWith("--limit=");
  const unsupported = args.filter((arg) => !supported(arg));
  if (unsupported.length) throw new Error(`Unsupported creator backfill option: ${unsupported[0]}`);
  if (plan && args.some((arg) => arg.startsWith("--limit="))) {
    throw new Error("--limit is supported only with --apply or --maintain.");
  }
  if (!plan && args.some((arg) => arg.startsWith("--creators="))) {
    throw new Error("--creators is supported only with --plan; apply and maintain use all reviewed coverage entries.");
  }
  const creatorFilters = args
    .filter((arg) => arg.startsWith("--creators="))
    .flatMap((arg) => arg.slice("--creators=".length).split(","))
    .map(normalizeCreatorHandle)
    .filter(Boolean);
  const limitValue = args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
  return {
    mode: plan ? "plan" : apply ? "apply" : "maintain",
    creatorFilters: [...new Set(creatorFilters)].sort(),
    limit: parseCreatorBackfillApplyLimit(limitValue),
  };
}

export function summarizeCreatorCoverageRegistry(entries: CreatorRegistryEntry[]): {
  approvedCoverageCount: number;
  featuredWithoutCoverage: string[];
} {
  return {
    approvedCoverageCount: entries.filter((entry) => entry.watch && entry.skillCoverage).length,
    featuredWithoutCoverage: entries
      .filter((entry) => entry.featured && !entry.skillCoverage)
      .map((entry) => entry.handle)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
  };
}

export type CreatorCoverageMaintenanceResult =
  | { status: "quota-skipped"; phase: "plan" | "apply"; remaining: number }
  | { status: "complete"; plan: CreatorBackfillPlan; progress: CreatorBackfillApplyProgress | null };

export async function executeCreatorCoverageMaintenance(input: {
  getQuotaRemaining: () => Promise<number>;
  plan: (initialQuotaRemaining: number) => Promise<CreatorBackfillPlan>;
  apply: (initialQuotaRemaining: number) => Promise<CreatorBackfillApplyProgress>;
}): Promise<CreatorCoverageMaintenanceResult> {
  const planningQuota = await input.getQuotaRemaining();
  if (planningQuota < CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM) {
    return { status: "quota-skipped", phase: "plan", remaining: planningQuota };
  }

  const plan = await input.plan(planningQuota);
  if (plan.candidates.length === 0) return { status: "complete", plan, progress: null };

  const applyQuota = await input.getQuotaRemaining();
  if (applyQuota < CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM) {
    return { status: "quota-skipped", phase: "apply", remaining: applyQuota };
  }

  return { status: "complete", plan, progress: await input.apply(applyQuota) };
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

function loadReviewedPlan(): CreatorBackfillPlan {
  if (!existsSync(planPath)) {
    throw new Error(`Missing reviewed creator backfill plan: ${planPath}. Run --plan first.`);
  }
  const plan = readJson<CreatorBackfillPlan | null>(planPath, null);
  if (
    !plan
    || plan.version !== CREATOR_BACKFILL_PLAN_VERSION
    || plan.complete !== true
    || !Array.isArray(plan.candidates)
  ) {
    throw new Error(`Invalid or incomplete creator backfill plan: ${planPath}`);
  }
  return plan;
}

function normalizePath(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^\.\//, "").toLowerCase();
}

function skillPath(skill: Skill): string | null {
  if (skill.skill_md_path) return skill.skill_md_path;
  const derived = deriveSkillPathFromId(skill.id);
  if (derived) return derived;
  return skill.id.includes(":") ? null : "SKILL.md";
}

function findExistingCandidate(
  skills: Skill[],
  candidate: CreatorBackfillPlan["candidates"][number],
): Skill | null {
  const normalizedId = normalizePolicySkillId(candidate.proposedId);
  const repo = normalizePolicyRepo(candidate.repo);
  const path = normalizePath(candidate.path);
  return skills.find((skill) => {
    if (normalizePolicySkillId(skill.id) === normalizedId) return true;
    return repoFromGithubUrl(skill.github_url) === repo && normalizePath(skillPath(skill)) === path;
  }) ?? null;
}

function firstSeenById(skills: Skill[]): Map<string, string> {
  return new Map(skills.map((skill) => [skill.id, skill.first_seen]));
}

function skillsById(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((skill) => [skill.id, skill]));
}

async function runPlan(
  creatorFilters: string[],
  initialQuotaRemaining?: number,
): Promise<CreatorBackfillPlan> {
  const registry = loadCreatorRegistry();
  const entries = selectCreatorBackfillCoverageEntries(registry.entries, creatorFilters, registry.aliasToCanonical);
  if (!entries.length) throw new Error("No creator skill coverage entries are configured.");
  const seeds = loadTrustedSeeds("manual-command");
  const loadedPolicy = loadPolicySources();
  const generatedAt = new Date().toISOString();
  const existingSkills = loadExistingSkills();

  const plan = await executeCreatorBackfillPlan({
    preflight: async () => {
      if (initialQuotaRemaining !== undefined) return initialQuotaRemaining;
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
    write: (value) => atomicWriteShadowJson(planPath, value),
  });

  console.log(`creator backfill plan: ${planPath}`);
  console.log(`  creators: ${plan.summary.creatorCount}`);
  console.log(`  repositories: ${plan.summary.repositoryCount}`);
  console.log(`  discovered SKILL.md files: ${plan.summary.discoveredSkillCount}`);
  console.log(`  candidates: ${plan.summary.candidateCount}`);
  console.log(`  excluded/review: ${plan.summary.excludedCount}`);
  return plan;
}

async function runApply(
  limit: number,
  initialQuotaRemaining?: number,
): Promise<CreatorBackfillApplyProgress> {
  const plan = loadReviewedPlan();
  const registry = loadCreatorRegistry();
  const seeds = loadTrustedSeeds("manual-command");
  const loadedPolicy = loadPolicySources();
  const currentPolicyDigest = effectivePolicyDigest(typedPolicySources(loadedPolicy));
  if (currentPolicyDigest !== plan.policyDigest) {
    console.warn("creator backfill policy changed since planning; candidates will use current policy");
  }

  const coverageCreators = new Set(
    registry.entries
      .filter((entry) => entry.watch && entry.skillCoverage)
      .map((entry) => normalizeCreatorHandle(entry.handle)),
  );
  let currentSkills = loadExistingSkills();
  const priorProgress = readJson<CreatorBackfillApplyProgress | null>(progressPath, null);

  const progress = await executeCreatorBackfillApply({
    plan,
    progress: priorProgress,
    limit,
    now: () => new Date().toISOString(),
    initialQuotaPreflight: async () => {
      if (initialQuotaRemaining !== undefined) return;
      await assertGitHubCoreQuotaAvailable(
        CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM,
        "creator backfill apply",
      );
    },
    reserveQuotaAvailable: async () => {
      const quota = await getGitHubCoreQuota();
      const minimum = CREATOR_BACKFILL_QUOTA_RESERVE + applyQuotaSafetyBuffer;
      console.log(`  GitHub core quota recheck: ${quota.remaining} remaining; stop floor ${minimum}`);
      return quota.remaining >= minimum;
    },
    reconcile: async (candidate) => {
      const creator = registry.aliasToCanonical.get(normalizeCreatorHandle(candidate.creator))
        ?? normalizeCreatorHandle(candidate.creator);
      if (!coverageCreators.has(creator)) {
        return { status: "policy-skipped", reason: "creator-coverage-removed" };
      }
      const repoPolicy = evaluateEffectiveRepoPolicy(candidate.repo, seeds);
      if (repoPolicy.excluded) {
        return { status: "policy-skipped", reason: repoPolicy.reasonCode ?? "repo-policy" };
      }
      if (isKnownCatalogRepo(candidate.repo, seeds.catalogRepoRules)) {
        return { status: "policy-skipped", reason: "catalog-repo" };
      }
      const skillPolicy = evaluateEffectiveSkillPolicy({
        id: candidate.proposedId,
        github_url: candidate.repoUrl,
      }, seeds);
      if (skillPolicy.excluded) {
        return { status: "policy-skipped", reason: skillPolicy.reasonCode ?? "skill-policy" };
      }
      const existing = findExistingCandidate(currentSkills, candidate);
      return existing
        ? { status: "existing", existingId: existing.id, reason: "current-shadow-state" }
        : null;
    },
    enrich: async (candidate) => {
      const enrichInput: Candidate = {
        id: candidate.proposedId,
        skill_md_path: candidate.path,
        skill_name_hint: candidate.path.split("/").at(-2),
        ref: candidate.defaultBranch,
        github_url: candidate.repoUrl,
        author_handle: candidate.creator,
      };
      const result = await enrichCandidate(
        enrichInput,
        firstSeenById(currentSkills),
        skillsById(currentSkills),
        new Date().toISOString().slice(0, 10),
      );
      if (!result.skill) {
        return result.failure
          ? { status: "stable-failed", reason: result.failure.reason }
          : { status: "transient-failed", reason: "enrich-failed" };
      }
      if (repoFromGithubUrl(result.skill.github_url) !== normalizePolicyRepo(candidate.repo)) {
        return { status: "policy-skipped", reason: "canonical-repo-mismatch" };
      }
      const shadowSkill = toShadowSkillRecord(result.skill, seeds);
      if (shadowSkill.provenance_type !== "original") {
        return { status: "policy-skipped", reason: `non-original-${shadowSkill.provenance_type}` };
      }
      return {
        status: "addition",
        addition: {
          skill: shadowSkill,
          repoKey: candidate.repo,
          repoUrl: candidate.repoUrl,
          source: CREATOR_BACKFILL_SOURCE,
          isTrustedCreator: true,
        },
      };
    },
    persist: async (additions: ShadowSkillPersistenceAddition[]): Promise<CreatorBackfillPersistResult[]> => {
      const generatedAt = new Date().toISOString();
      const snapshot = loadShadowSkillPersistenceSnapshot(undefined, generatedAt);
      const prepared = prepareShadowSkillPersistence({
        snapshot,
        additions,
        generatedAt,
        dedupeExactSha: true,
      });
      commitShadowSkillPersistence({ snapshot, prepared });
      currentSkills = loadExistingSkills();
      return prepared.outcomes.map((outcome) => ({
        id: outcome.id,
        status: outcome.status === "added" ? "added" : "existing",
        existingId: outcome.existingId,
        reason: outcome.status === "exact-sha-existing" ? "exact-sha-existing" : outcome.status,
      }));
    },
    writeProgress: (value) => atomicWriteShadowJson(progressPath, value),
  });

  console.log(`creator backfill apply: ${progressPath}`);
  console.log(`  stopped: ${progress.stoppedReason}`);
  console.log(`  added: ${progress.summary.addedCount}`);
  console.log(`  existing: ${progress.summary.existingCount}`);
  console.log(`  policy skipped: ${progress.summary.policySkippedCount}`);
  console.log(`  stable failed: ${progress.summary.stableFailedCount}`);
  console.log(`  transient failed: ${progress.summary.transientFailedCount}`);
  console.log(`  pending: ${progress.summary.pendingCount}`);
  console.log("  publish: not run");
  return progress;
}

async function runMaintain(limit: number): Promise<void> {
  const registry = loadCreatorRegistry();
  const registrySummary = summarizeCreatorCoverageRegistry(registry.entries);
  console.log("creator coverage maintenance:");
  console.log(`  approved coverage creators: ${registrySummary.approvedCoverageCount}`);
  console.log(`  featured creators missing coverage: ${registrySummary.featuredWithoutCoverage.length}`);
  if (registrySummary.featuredWithoutCoverage.length > 0) {
    console.log(`  missing coverage handles: ${registrySummary.featuredWithoutCoverage.join(", ")}`);
  }

  const result = await executeCreatorCoverageMaintenance({
    getQuotaRemaining: async () => (await getGitHubCoreQuota()).remaining,
    plan: (remaining) => runPlan([], remaining),
    apply: (remaining) => runApply(limit, remaining),
  });

  if (result.status === "quota-skipped") {
    console.log(
      `  skipped: GitHub quota below ${CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM} before ${result.phase} (${result.remaining} remaining)`,
    );
    return;
  }
  if (!result.progress) console.log("  result: no new creator coverage candidates");
}

async function main(): Promise<void> {
  const args = parseCreatorBackfillArguments(process.argv.slice(2));
  if (args.mode === "plan") await runPlan(args.creatorFilters);
  else if (args.mode === "apply") await runApply(args.limit);
  else await runMaintain(args.limit);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

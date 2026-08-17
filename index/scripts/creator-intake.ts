import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCreatorRegistry,
  normalizeCreatorHandle,
  type CreatorRegistryEntry,
  type CreatorRegistryRole,
  type CreatorRegistrySource,
} from "../scraper/creator-registry.js";
import type { Skill } from "../scraper/types.js";
import { effectivePolicyDigest } from "../scraper/policy/digest.js";
import { loadPolicySources, replacePolicySource, typedPolicySources } from "../scraper/policy/loader.js";
import { prepareEditoolPolicySave } from "./editool-policy-save.js";
import { editoolFileRevision, runEditoolPolicyTransaction } from "./editool-policy-transaction.js";
import { formatCreatorRegistry } from "./editool-creator-format.js";
import { normalizePolicyRepo } from "../../scripts/policy-identifiers.mjs";
import type { CreatorBackfillPlan } from "../scraper/new-crawl/creator-backfill-plan.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");
const repoRoot = resolve(indexRoot, "..");
const planPath = join(indexRoot, "shadow", "creator-intake.plan.json");
const transactionDir = join(indexRoot, "shadow", "editool-policy-transaction");
const CREATOR_INTAKE_PLAN_VERSION = 1;

export type ParsedCreatorIntakeInput = {
  url: string;
  requestedHandle: string;
  requestedRepo: string | null;
  kind: "profile" | "repository";
};

export type ResolvedCreatorIntakeInput = ParsedCreatorIntakeInput & {
  canonicalHandle: string;
  canonicalRepo: string | null;
  role: CreatorRegistryRole;
};

export type CreatorIntakePlan = {
  version: 1;
  complete: true;
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  creatorRevision: string;
  inputs: ResolvedCreatorIntakeInput[];
  changedHandles: string[];
  proposedRegistry: CreatorRegistrySource;
  backfill: CreatorBackfillPlan;
  planDigest: string;
};

type CreatorIntakeApplyContext = {
  sourceCommit: string;
  policyDigest: string;
  creatorRevision: string;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

export function creatorIntakePlanDigest(plan: Omit<CreatorIntakePlan, "planDigest">): string {
  return sha256(plan);
}

export function parseCreatorIntakeInput(value: string): ParsedCreatorIntakeInput {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Creator intake requires a GitHub URL: ${value}`);
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error(`Creator intake supports only https://github.com URLs: ${value}`);
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) throw new Error(`GitHub URL is missing a creator handle: ${value}`);
  const requestedHandle = normalizeCreatorHandle(parts[0]!);
  const requestedRepo = parts.length >= 2
    ? normalizePolicyRepo(`${parts[0]}/${parts[1]}`)
    : null;
  return {
    url: value,
    requestedHandle,
    requestedRepo,
    kind: requestedRepo ? "repository" : "profile",
  };
}

function mergeRoles(existing: CreatorRegistryRole[] = [], role: CreatorRegistryRole): CreatorRegistryRole[] {
  return [...new Set([...existing, role])].sort() as CreatorRegistryRole[];
}

function mergeAliases(existing: string[] = [], candidates: string[]): string[] | undefined {
  const aliases = [...new Set([...existing, ...candidates].map(normalizeCreatorHandle).filter(Boolean))].sort();
  return aliases.length ? aliases : undefined;
}

export function buildCreatorIntakeRegistry(
  current: CreatorRegistrySource,
  inputs: ResolvedCreatorIntakeInput[],
  date: string,
): { registry: CreatorRegistrySource; changedHandles: string[] } {
  const validated = buildCreatorRegistry(current);
  const entries: CreatorRegistryEntry[] = current.creators.map((entry) => ({
    ...entry,
    aliases: entry.aliases ? [...entry.aliases] : undefined,
    skillRepos: entry.skillRepos ? [...entry.skillRepos] : undefined,
  }));
  const changed = new Set<string>();

  const grouped = new Map<string, ResolvedCreatorIntakeInput[]>();
  for (const input of inputs) {
    const requested = normalizeCreatorHandle(input.requestedHandle);
    const canonical = normalizeCreatorHandle(input.canonicalHandle);
    const registryHandle = validated.aliasToCanonical.get(requested)
      ?? validated.aliasToCanonical.get(canonical)
      ?? (validated.entries.some((entry) => normalizeCreatorHandle(entry.handle) === requested) ? requested : canonical);
    const values = grouped.get(registryHandle) ?? [];
    values.push(input);
    grouped.set(registryHandle, values);
  }

  for (const [handle, creatorInputs] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const index = entries.findIndex((entry) => normalizeCreatorHandle(entry.handle) === handle);
    const existing = index >= 0 ? entries[index]! : null;
    const wantsAll = creatorInputs.some((input) => input.kind === "profile") || existing?.skillCoverage === "all";
    const selectedRepos = [...new Set([
      ...(existing?.skillRepos ?? []),
      ...creatorInputs.map((input) => input.canonicalRepo).filter((repo): repo is string => Boolean(repo)),
    ].map(normalizePolicyRepo))].sort();
    const canonicalHandles = creatorInputs.map((input) => normalizeCreatorHandle(input.canonicalHandle));
    const requestedHandles = creatorInputs.map((input) => normalizeCreatorHandle(input.requestedHandle));
    const aliasCandidates = [...canonicalHandles, ...requestedHandles].filter((candidate) => candidate !== handle);
    const role = creatorInputs.some((input) => input.role === "vendor") ? "vendor" : "creator";
    const next: CreatorRegistryEntry = {
      ...(existing ?? { handle: creatorInputs[0]!.canonicalHandle }),
      roles: mergeRoles(existing?.roles, role),
      watch: true,
      featured: true,
      aliases: mergeAliases(existing?.aliases, aliasCandidates),
      skillCoverage: wantsAll ? "all" : "selected",
      ...(wantsAll ? {} : { skillRepos: selectedRepos }),
      notes: existing?.notes ?? `Added by creator intake ${date}.`,
    };
    if (wantsAll) delete next.skillRepos;
    if (!next.aliases?.length) delete next.aliases;
    if (index >= 0) entries[index] = next;
    else entries.push(next);
    changed.add(normalizeCreatorHandle(next.handle));
  }

  const registry = { creators: entries };
  buildCreatorRegistry(registry);
  return { registry, changedHandles: [...changed].sort() };
}

export function finalizeCreatorIntakePlan(
  plan: Omit<CreatorIntakePlan, "planDigest">,
): CreatorIntakePlan {
  return { ...plan, planDigest: creatorIntakePlanDigest(plan) };
}

export function executeCreatorIntakeApply(input: {
  plan: CreatorIntakePlan;
  expectedDigest: string;
  current: CreatorIntakeApplyContext;
  validate: (registry: CreatorRegistrySource) => void;
  write: (registry: CreatorRegistrySource) => void;
}): void {
  const { plan } = input;
  const { planDigest, ...unsigned } = plan;
  if (plan.version !== CREATOR_INTAKE_PLAN_VERSION || plan.complete !== true) {
    throw new Error("Invalid creator intake plan.");
  }
  if (creatorIntakePlanDigest(unsigned) !== planDigest || input.expectedDigest !== planDigest) {
    throw new Error("Creator intake plan digest does not match the reviewed plan.");
  }
  if (input.current.sourceCommit !== plan.sourceCommit) {
    throw new Error("Source commit changed since creator intake planning; create a new plan.");
  }
  if (input.current.policyDigest !== plan.policyDigest) {
    throw new Error("Policy changed since creator intake planning; create a new plan.");
  }
  if (input.current.creatorRevision !== plan.creatorRevision) {
    throw new Error("Creator registry changed since creator intake planning; create a new plan.");
  }
  input.validate(plan.proposedRegistry);
  input.write(plan.proposedRegistry);
}

function currentSourceCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function resolveInputs(values: string[]): Promise<ResolvedCreatorIntakeInput[]> {
  const parsed = values.map(parseCreatorIntakeInput);
  const { octokit } = await import("../scraper/client.js");
  const resolved: ResolvedCreatorIntakeInput[] = [];
  for (const input of parsed) {
    if (input.kind === "profile") {
      const response = await octokit.rest.users.getByUsername({ username: input.requestedHandle });
      resolved.push({
        ...input,
        canonicalHandle: response.data.login,
        canonicalRepo: null,
        role: response.data.type === "Organization" ? "vendor" : "creator",
      });
      continue;
    }
    const [owner, repo] = input.requestedRepo!.split("/");
    const response = await octokit.rest.repos.get({ owner: owner!, repo: repo! });
    resolved.push({
      ...input,
      canonicalHandle: response.data.owner.login,
      canonicalRepo: normalizePolicyRepo(response.data.full_name),
      role: response.data.owner.type === "Organization" ? "vendor" : "creator",
    });
  }
  return resolved.sort((left, right) =>
    normalizeCreatorHandle(left.canonicalHandle).localeCompare(normalizeCreatorHandle(right.canonicalHandle))
    || (left.canonicalRepo ?? "").localeCompare(right.canonicalRepo ?? "")
    || left.url.localeCompare(right.url)
  );
}

async function runPlan(urls: string[]): Promise<void> {
  if (!urls.length) throw new Error("Creator intake planning requires at least one GitHub profile or repository URL.");
  const loaded = loadPolicySources();
  const sources = typedPolicySources(loaded);
  const resolved = await resolveInputs(urls);
  const generatedAt = new Date().toISOString();
  const proposed = buildCreatorIntakeRegistry(sources.creators, resolved, generatedAt.slice(0, 10));
  const catalogSkills = readJson<Skill[]>(join(indexRoot, "skills.json"));
  const policyCheck = prepareEditoolPolicySave({
    loaded,
    replacements: { creators: proposed.registry },
    catalogContext: catalogContext(catalogSkills),
  });
  if (!policyCheck.ok) {
    throw new Error(`Creator intake policy validation failed: ${policyCheck.errors.join("; ")}`);
  }
  const proposedRegistry = buildCreatorRegistry(proposed.registry);
  const entries = proposedRegistry.entries.filter((entry) =>
    proposed.changedHandles.includes(normalizeCreatorHandle(entry.handle))
  );
  const [{ collectCreatorBackfillScans, loadCreatorBackfillExistingSkills }, { buildCreatorBackfillPlan, CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM }, { loadTrustedSeeds }, { assertGitHubCoreQuotaAvailable }] = await Promise.all([
    import("../scraper/new-crawl/creator-backfill.js"),
    import("../scraper/new-crawl/creator-backfill-plan.js"),
    import("../scraper/new-crawl/seeds.js"),
    import("../scraper/new-crawl/github-quota-guard.js"),
  ]);
  const quota = await assertGitHubCoreQuotaAvailable(
    CREATOR_BACKFILL_INITIAL_QUOTA_MINIMUM,
    "creator intake planning",
  );
  const seeds = loadTrustedSeeds("manual-command");
  const scans = await collectCreatorBackfillScans(entries, seeds);
  const sourceCommit = currentSourceCommit();
  const policyDigest = effectivePolicyDigest(sources);
  const backfill = buildCreatorBackfillPlan({
    generatedAt,
    sourceCommit,
    policyDigest,
    initialQuotaRemaining: quota.remaining,
    scans,
    existingSkills: loadCreatorBackfillExistingSkills(),
    seeds,
  });
  const plan = finalizeCreatorIntakePlan({
    version: CREATOR_INTAKE_PLAN_VERSION,
    complete: true,
    generatedAt,
    sourceCommit,
    policyDigest,
    creatorRevision: editoolFileRevision(loaded.paths.creators),
    inputs: resolved,
    changedHandles: proposed.changedHandles,
    proposedRegistry: proposed.registry,
    backfill,
  });
  atomicWriteJson(planPath, plan);
  console.log(`creator intake plan: ${planPath}`);
  console.log(`  digest: ${plan.planDigest}`);
  console.log(`  creators: ${plan.changedHandles.join(", ")}`);
  console.log(`  discovered SKILL.md files: ${backfill.summary.discoveredSkillCount}`);
  console.log(`  new backfill candidates: ${backfill.summary.candidateCount}`);
  console.log("Review the plan, then apply with --apply --digest=<digest>.");
}

function catalogContext(skills: Skill[]) {
  return {
    publishedSkillIds: new Set(skills.map((skill) => skill.id)),
    publishedAuthorHandles: new Set(skills.map((skill) => skill.author_handle)),
    suppressionCandidateSkillIds: new Set(skills.map((skill) => skill.id)),
  };
}

function runApply(digest: string): void {
  if (!existsSync(planPath)) throw new Error(`Missing creator intake plan: ${planPath}`);
  const plan = readJson<CreatorIntakePlan>(planPath);
  const loaded = loadPolicySources();
  const sources = typedPolicySources(loaded);
  const skills = readJson<Skill[]>(join(indexRoot, "skills.json"));
  const context = catalogContext(skills);
  const validate = (registry: CreatorRegistrySource) => {
    const prepared = prepareEditoolPolicySave({
      loaded,
      replacements: { creators: registry },
      catalogContext: context,
    });
    if (!prepared.ok) throw new Error(`Creator intake policy validation failed: ${prepared.errors.join("; ")}`);
  };
  executeCreatorIntakeApply({
    plan,
    expectedDigest: digest,
    current: {
      sourceCommit: currentSourceCommit(),
      policyDigest: effectivePolicyDigest(sources),
      creatorRevision: editoolFileRevision(loaded.paths.creators),
    },
    validate,
    write: (registry) => runEditoolPolicyTransaction({
      stateDir: transactionDir,
      guards: Object.values(loaded.paths).map((path) => ({ path, expectedRevision: editoolFileRevision(path) })),
      mutations: [{
        path: loaded.paths.creators,
        content: formatCreatorRegistry(registry),
        expectedRevision: plan.creatorRevision,
      }],
      verifyAfterApply: () => {
        const current = loadPolicySources();
        const verified = prepareEditoolPolicySave({
          loaded: current,
          replacements: { creators: registry },
          catalogContext: context,
        });
        if (!verified.ok) throw new Error(`Post-save creator policy validation failed: ${verified.errors.join("; ")}`);
        execFileSync("git", ["diff", "--check", "--", loaded.paths.creators], {
          cwd: repoRoot,
          stdio: "pipe",
        });
      },
    }),
  });
  console.log(`creator intake applied: ${plan.changedHandles.join(", ")}`);
  console.log("No crawl or publication was started.");
}

export function parseCreatorIntakeArguments(args: string[]):
  | { mode: "plan"; urls: string[] }
  | { mode: "apply"; digest: string } {
  const plan = args.includes("--plan");
  const apply = args.includes("--apply");
  if (plan === apply) throw new Error("Usage: creator:intake -- --plan <github URLs...> OR --apply --digest=<digest>");
  if (plan) {
    const urls = args.filter((arg) => arg !== "--plan");
    if (urls.some((arg) => arg.startsWith("--"))) throw new Error(`Unsupported creator intake option: ${urls.find((arg) => arg.startsWith("--"))}`);
    return { mode: "plan", urls };
  }
  const digest = args.find((arg) => arg.startsWith("--digest="))?.slice("--digest=".length) ?? "";
  const unsupported = args.filter((arg) => arg !== "--apply" && !arg.startsWith("--digest="));
  if (unsupported.length) throw new Error(`Unsupported creator intake option: ${unsupported[0]}`);
  if (!digest) throw new Error("Creator intake apply requires --digest=<reviewed plan digest>.");
  return { mode: "apply", digest };
}

async function main(): Promise<void> {
  const args = parseCreatorIntakeArguments(process.argv.slice(2));
  if (args.mode === "plan") await runPlan(args.urls);
  else runApply(args.digest);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

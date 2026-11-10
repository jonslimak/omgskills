import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSourceTrending } from "../../../scripts/source-trending-format.mjs";
import { effectivePolicyDigest } from "../policy/digest.js";
import { loadPolicySources, typedPolicySources } from "../policy/loader.js";
import { createTrendingMvpSnapshot, assertTrendingMvpPreservesBaseline, assertTrendingMvpDirectory } from "./run-trending-mvp.js";
import { executeTrendingMvp } from "./trending-admission-mvp.js";
import { readTrendingIntakeState, selectTrendingIntakeCandidates, updateTrendingIntakeState, type TrendingIntakeState } from "./trending-intake.js";
import { loadTrendingCatalogs, publishTrendingAdditions } from "./trending-intake-publication.js";
import { applyQualityTiers } from "./quality-tier.js";
import { loadTrustedSeeds } from "./seeds.js";
import { indexRoot, shadowRoot } from "./shadow-path-guard.js";
import type { ShadowSkillRecord } from "./types.js";

export function assertTrendingIntakeApplyAllowed(env = process.env): void {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_WORKFLOW !== "trending-intake" || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Trending intake --apply requires the guarded main-branch trending-intake workflow; local runs are report-only");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("Usage: npm run crawl4:trending-intake -- [--apply]");
  }
  const apply = args.includes("--apply");
  if (apply) assertTrendingIntakeApplyAllowed();
  const generatedAt = new Date().toISOString();
  const repoRoot = resolve(indexRoot, "..");
  const catalogs = loadTrendingCatalogs(repoRoot);
  const seeds = loadTrustedSeeds("manual-command");
  const policyDigest = effectivePolicyDigest(typedPolicySources(loadPolicySources()));
  const statePath = join(indexRoot, "trending-intake-state.json");
  const stateBytes = existsSync(statePath) ? readFileSync(statePath) : null;
  const state = stateBytes ? readTrendingIntakeState(JSON.parse(stateBytes.toString()))
    : { version: 1 as const, policyDigest, reviews: [] };
  const feed = validateSourceTrending(JSON.parse(readFileSync(join(indexRoot, "source-trending.json"), "utf8")));
  const entries = selectTrendingIntakeCandidates(feed, catalogs.crawl4.skills, state, policyDigest, Date.parse(generatedAt));
  const initial = createTrendingMvpSnapshot(catalogs.crawl4.skills as ShadowSkillRecord[], generatedAt);
  const { getGitHubCoreQuota } = await import("./github-quota-guard.js");
  const quota = await getGitHubCoreQuota();
  let deferred = entries.length > 0 && quota.remaining < 3500;
  const { createTrendingDependencies } = await import("./trending-runtime.js");
  const deps = await createTrendingDependencies(entries.length, generatedAt);
  let result: Awaited<ReturnType<typeof executeTrendingMvp>> = { snapshot: initial, outcomes: [] };
  if (!deferred) {
    try { result = await executeTrendingMvp({ entries, snapshot: initial, seeds, deps, generatedAt }); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("GitHub core quota too low")) throw error;
      deferred = true;
    }
  }
  assertTrendingMvpPreservesBaseline(initial.cutoverSkills, result.snapshot.cutoverSkills);
  const repeated = await executeTrendingMvp({ entries: deferred ? [] : entries, snapshot: result.snapshot,
    seeds, deps: { ...deps, beforeCandidate: undefined }, generatedAt });
  assert.deepEqual(repeated.snapshot.cutoverSkills, result.snapshot.cutoverSkills, "Trending intake repeat must not change the catalog");
  assert.equal(repeated.outcomes.filter(row => row.status === "added").length, 0);
  let additions = result.snapshot.skillOverlay.skills;
  if (catalogs.crawl4.skills.some(row => row.quality_tier !== undefined)) {
    additions = applyQualityTiers(additions, result.snapshot.repoIndex, seeds, new Set(), true, true);
  }
  const nextState: TrendingIntakeState = updateTrendingIntakeState(state, policyDigest, result.outcomes, generatedAt);
  const root = join(shadowRoot, "trending-mvp");
  assertTrendingMvpDirectory(join(root, "intake-preflight")); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "intake-"));
  const report = { version: 1, generatedAt, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: repoRoot }).trim(),
    mode: apply ? "apply" : "report-only", status: deferred ? "quota-deferred" : "verified", policyDigest,
    sourceFetchedAt: feed.fetchedAt, candidateCount: entries.length, addedCount: additions.length,
    initialQuotaRemaining: quota.remaining, baselineSkillCount: catalogs.crawl4.skills.length,
    baselineHashes: { v2: catalogs.v2.manifest.skills.sha256, crawl4: catalogs.crawl4.manifest.skills.sha256 },
    existingSkillsUnchanged: true, cutoverValidationPassed: true, repeatAddedCount: 0, outcomes: result.outcomes };
  const write = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + "\n");
  write("report.json", report); write("additions.json", additions); write("proposed-state.json", nextState);
  if (apply) {
    assert.equal(effectivePolicyDigest(typedPolicySources(loadPolicySources())), policyDigest, "Policy changed during Trending verification");
    assert.deepEqual(existsSync(statePath) ? readFileSync(statePath) : null, stateBytes, "Trending review state changed during verification");
    publishTrendingAdditions(catalogs, additions, seeds, generatedAt);
    if (!deferred) {
      writeFileSync(`${statePath}.tmp`, JSON.stringify(nextState, null, 2) + "\n");
      renameSync(`${statePath}.tmp`, statePath);
    }
  }
  console.log(JSON.stringify({ directory, ...report }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Trending intake failed"); process.exitCode = 1; });
}

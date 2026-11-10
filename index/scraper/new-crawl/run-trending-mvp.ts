import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { repoFromGithubUrl } from "../policy/effective-policy.js";
import type { ShadowRepoIndexEntry, ShadowSkillRecord } from "./types.js";
import { validateCutoverOutputs } from "./cutover-validation.js";
import { indexRoot, shadowRoot } from "./shadow-path-guard.js";
import { commitShadowSkillPersistence, loadShadowSkillPersistenceSnapshot, upsertRepoEntry,
  type ShadowSkillPersistencePaths, type ShadowSkillPersistenceSnapshot } from "./shadow-skill-persistence.js";
import { executeTrendingMvp, selectTrendingMvpCandidates } from "./trending-admission-mvp.js";
import type { SourceTrendingEntry, SourceTrendingFeed } from "../../../scripts/source-trending-format.mjs";

export function assertTrendingMvpDirectory(directory: string): void {
  const root = join(shadowRoot, "trending-mvp");
  const target = resolve(directory);
  if (!target.startsWith(root + sep)) throw new Error("MVP writes require a dedicated index/shadow/trending-mvp subdirectory");
  let current: string = sep;
  for (const part of target.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("MVP output cannot traverse symlinks");
  }
}

export function createTrendingMvpSnapshot(skills: ShadowSkillRecord[], generatedAt: string): ShadowSkillPersistenceSnapshot {
  // Local validation scaffold only: no discovery, refresh, promotion, or seed mutation.
  const byRepo = new Map<string, ShadowRepoIndexEntry>();
  for (const skill of skills) {
    const repo = repoFromGithubUrl(skill.github_url);
    if (!repo) throw new Error(`Baseline skill has no GitHub repository: ${skill.id}`);
    const entry = byRepo.get(repo);
    if (entry) {
      entry.skillIds.push(skill.id);
      entry.skillCount += 1;
      if (skill.stars > entry.stars) { entry.stars = skill.stars; entry.topSkillStars = skill.stars; entry.topSkillId = skill.id; }
    } else {
      const first = upsertRepoEntry({ generatedAt, repoCount: 0, repos: [] }, skill,
        { repoKey: repo, repoUrl: skill.github_url }, generatedAt).repos[0]!;
      first.discoveredSources = ["baseline"];
      first.promotionReasons = [];
      byRepo.set(repo, first);
    }
  }
  const repos = [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));
  const snapshot: ShadowSkillPersistenceSnapshot = {
    cutoverSkills: skills, signals: [], repoIndex: { generatedAt, repoCount: repos.length, repos },
    skillOverlay: { generatedAt, skillCount: 0, skills: [] }, repoOverlay: { generatedAt, repoCount: 0, repos: [] },
    revisions: { cutoverSkills: "missing", repoIndex: "missing", skillOverlay: "missing", repoOverlay: "missing" },
  };
  assert.deepEqual(validateCutoverOutputs(skills, [], snapshot.repoIndex), [], "Baseline must validate before the MVP starts");
  return snapshot;
}

export function assertTrendingMvpPreservesBaseline(before: ShadowSkillRecord[], after: ShadowSkillRecord[]): void {
  const byId = new Map(after.map(skill => [skill.id, skill]));
  for (const skill of before) assert.deepEqual(byId.get(skill.id), skill, `MVP removed or changed baseline skill ${skill.id}`);
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function loadTrendingMvpReplay(directory: string, skills: ShadowSkillRecord[], baselineSha: string, limit: number) {
  assertTrendingMvpDirectory(directory);
  const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
  if (report.localOnly !== true || report.baseline?.sha256 !== baselineSha) throw new Error("Replay requires the same original catalog baseline");
  const feed: SourceTrendingFeed = JSON.parse(readFileSync(join(directory, "source-trending.json"), "utf8"));
  const entries: SourceTrendingEntry[] = JSON.parse(readFileSync(join(directory, "candidates.json"), "utf8"));
  const excludedSourceIds: string[] = report.excludedSourceIds ?? [];
  if (!Array.isArray(excludedSourceIds) || !excludedSourceIds.every(id => typeof id === "string")) throw new Error("Invalid recorded MVP exclusions");
  // An explicit local replay uses the recorded board, never claims its timestamp is fresh.
  const selected = selectTrendingMvpCandidates(feed, skills, limit, Date.parse(feed.fetchedAt), new Set(excludedSourceIds));
  assert.equal(entries.length, limit, "Replay candidate count changed");
  assert.deepEqual(selected, entries, "Replay candidates differ from the original source snapshot");
  return { feed, entries, excludedSourceIds };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^--limit=\d+$/.test(arg) && !/^--(?:replay|exclude)-batch=.+$/.test(arg))) {
    throw new Error("Usage: npm run crawl4:trending-mvp -- [--limit=20] [--replay-batch=<batch> | --exclude-batch=<batch>]");
  }
  if (new Set(args.map(arg => arg.split("=")[0])).size !== args.length) throw new Error("Duplicate MVP arguments");
  const limit = Number(args.find(arg => arg.startsWith("--limit="))?.split("=")[1] ?? 20);
  const replayBatch = args.find(arg => arg.startsWith("--replay-batch="))?.slice("--replay-batch=".length);
  const excludeBatch = args.find(arg => arg.startsWith("--exclude-batch="))?.slice("--exclude-batch=".length);
  if (replayBatch && excludeBatch) throw new Error("Choose replay or a fresh batch, not both");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("MVP limit must be 1..20");
  const generatedAt = new Date().toISOString();
  const baselinePath = join(indexRoot, "skills.json");
  const baselineBytes = readFileSync(baselinePath);
  const initial = createTrendingMvpSnapshot(JSON.parse(baselineBytes.toString()), generatedAt);
  const { loadTrustedSeeds } = await import("./seeds.js");
  const seeds = loadTrustedSeeds("manual-command");
  const { assertGitHubCoreQuotaAvailable, getGitHubCoreQuota } = await import("./github-quota-guard.js");
  await assertGitHubCoreQuotaAvailable(3500, "local Trending MVP");
  let feed: SourceTrendingFeed;
  let entries: SourceTrendingEntry[];
  let excludedSourceIds: string[] = [];
  if (replayBatch) {
    ({ feed, entries, excludedSourceIds } = loadTrendingMvpReplay(resolve(replayBatch), initial.cutoverSkills, digest(baselineBytes), limit));
  } else {
    if (excludeBatch) {
      const previous = loadTrendingMvpReplay(resolve(excludeBatch), initial.cutoverSkills, digest(baselineBytes), limit);
      excludedSourceIds = [...new Set([...previous.excludedSourceIds,
        ...previous.entries.map(entry => `${entry.source}:${entry.skillId}`.toLowerCase())])].sort();
    }
    const { fetchSkillsShBoard } = await import("../sources/skillssh.js");
    const { buildSourceTrending } = await import("../build-source-trending.js");
    const board = await fetchSkillsShBoard({ board: "trending", topLimit: 500, pageConcurrency: 1 });
    // Preserve raw candidates in the report so policy rejections are visible, not silently lost.
    feed = buildSourceTrending(board.entries, initial.cutoverSkills,
      { blockedRepos: [], blockedOwners: [], catalogRepos: [], suppressedIds: [] }, generatedAt);
    entries = selectTrendingMvpCandidates(feed, initial.cutoverSkills, limit, Date.now(), new Set(excludedSourceIds));
  }
  if (entries.length !== limit) throw new Error(`Only ${entries.length} unindexed GitHub entries available; expected ${limit}`);
  const root = join(shadowRoot, "trending-mvp");
  assertTrendingMvpDirectory(join(root, "preflight"));
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "batch-"));
  const write = (name: string, value: unknown) => {
    assertTrendingMvpDirectory(directory);
    writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  };
  const paths: ShadowSkillPersistencePaths = {
    cutoverSkills: join(directory, "skills.cutover.shadow.json"), repoIndex: join(directory, "repo-index.shadow.json"),
    skillOverlay: join(directory, "skills.overlay.json"), repoOverlay: join(directory, "repo-index.overlay.json"),
    signals: join(directory, "skill-signals.cutover.shadow.json"),
  };
  write("source-trending.json", feed);
  write("candidates.json", entries);
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    write(paths[key].slice(directory.length + 1), initial[key]);
  }
  const snapshot = loadShadowSkillPersistenceSnapshot(paths, generatedAt);
  const { createTrendingDependencies } = await import("./trending-runtime.js");
  const deps = await createTrendingDependencies(entries.length, generatedAt);
  const first = await executeTrendingMvp({ entries, snapshot, seeds, deps, generatedAt });
  assertTrendingMvpPreservesBaseline(initial.cutoverSkills, first.snapshot.cutoverSkills);
  commitShadowSkillPersistence({ snapshot, prepared: { next: first.snapshot, outcomes: [] }, paths,
    transactionStateDir: join(directory, ".transaction"), assertTargetPath: path => assertTrendingMvpDirectory(resolve(path, "..")) });
  const stored = loadShadowSkillPersistenceSnapshot(paths, generatedAt);
  // Repeat the frozen batch against disk results, reusing responses rather than spending API quota again.
  const second = await executeTrendingMvp({ entries, snapshot: stored, seeds, deps: { ...deps, beforeCandidate: undefined }, generatedAt });
  assert.equal(second.outcomes.filter(row => row.status === "added").length, 0, "Repeat batch added duplicates");
  assert.deepEqual(second.snapshot.cutoverSkills, stored.cutoverSkills, "Repeat batch changed the local catalog");
  assert.deepEqual(second.snapshot.repoIndex, stored.repoIndex, "Repeat batch changed repository state");
  assert.equal(digest(readFileSync(baselinePath)), digest(baselineBytes), "Original catalog changed during MVP");
  const validation = validateCutoverOutputs(stored.cutoverSkills, stored.signals, stored.repoIndex);
  assert.deepEqual(validation, []);
  const quota = await getGitHubCoreQuota();
  const counts = Object.fromEntries([...new Set(first.outcomes.map(row => row.status))].sort()
    .map(status => [status, first.outcomes.filter(row => row.status === status).length]));
  const report = { version: 1, localOnly: true, generatedAt, sourceFetchedAt: feed.fetchedAt,
    replayOf: replayBatch ? resolve(replayBatch) : null, candidateSha256: digest(JSON.stringify(entries)),
    excludesBatch: excludeBatch ? resolve(excludeBatch) : null, excludedSourceIds,
    baseline: { path: baselinePath, sha256: digest(baselineBytes), skillCount: initial.cutoverSkills.length,
      note: "Current catalog copied into a local validation scaffold; no refresh/promotion or signal generation performed" },
    candidateCount: entries.length, counts, finalSkillCount: stored.cutoverSkills.length, outcomes: first.outcomes,
    repeatOutcomes: second.outcomes, repeatAddedCount: 0, baselinePreserved: true, cutoverValidationPassed: true,
    remainingGitHubQuota: quota.remaining };
  write("report.json", report);
  const lines = ["# Local Trending Admission MVP", "", "Local simulation only. Nothing published or deployed.", "",
    `Baseline: ${initial.cutoverSkills.length}; final: ${stored.cutoverSkills.length}.`, `Results: ${JSON.stringify(counts)}.`,
    "Repeat added: 0. Existing skills unchanged. Cutover validation passed.", "", "| Rank | Source skill | Outcome | Reason |", "| --- | --- | --- | --- |",
    ...first.outcomes.map(row => `| ${row.rank} | ${row.sourceId.replaceAll("|", "\\|")} | ${row.status} | ${row.reason} |`)];
  assertTrendingMvpDirectory(directory);
  writeFileSync(join(directory, "report.md"), lines.join("\n") + "\n");
  console.log(JSON.stringify({ directory, counts, baselineSkillCount: initial.cutoverSkills.length,
    finalSkillCount: stored.cutoverSkills.length, repeatAddedCount: 0, cutoverValidationPassed: true, remainingGitHubQuota: quota.remaining }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Trending MVP failed"); process.exitCode = 1; });
}

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { executeTrendingMvp, resolveTrendingMvpPath, selectTrendingMvpCandidates,
  type TrendingMvpDependencies } from "./trending-admission-mvp.js";
import { assertTrendingMvpDirectory, assertTrendingMvpPreservesBaseline, createTrendingMvpSnapshot, loadTrendingMvpReplay } from "./run-trending-mvp.js";
import { buildTrustedSeeds } from "./seeds.js";
import { loadTrustedSeeds } from "./seeds.js";
import { shadowRoot } from "./shadow-path-guard.js";
import type { ShadowSkillRecord, TrustedSeeds } from "./types.js";
import type { SourceTrendingEntry, SourceTrendingFeed } from "../../../scripts/source-trending-format.mjs";
import { sourceTrendingUrl } from "../../../scripts/source-trending-format.mjs";

const date = "2026-11-09T16:00:00.000Z";
const commit = "1".repeat(40), tree = "2".repeat(40), blob = "3".repeat(40);

function seeds(): TrustedSeeds {
  return buildTrustedSeeds({ creatorRegistryJson: { creators: [] }, officialJson: {}, manualIncludeJson: {},
    doNotCrawlJson: {}, overridesJson: [], catalogJson: [], provenanceJson: [] });
}

function skill(id: string, path = "skills/one/SKILL.md"): ShadowSkillRecord {
  const repo = id.split(":")[0]!;
  return { id, name: id.split(":")[1]!, description: "A useful skill.", github_url: `https://github.com/${repo}`,
    author_handle: repo.split("/")[0]!, skill_md_path: path, install_cmd: "git clone", tags: [], stars: 0,
    last_updated: date, first_seen: date.slice(0, 10), skill_md_sha: blob, provenance_type: "original",
    publisher_handle: repo.split("/")[0]!, publisher_repo: repo.toLowerCase(), upstream_repo: null, author_confidence: "high" };
}

function entry(source = "owner/repo", name = "one", rank = 1): SourceTrendingEntry {
  return { source, skillId: name, name, rank, installs24h: 1, sourceUrl: sourceTrendingUrl(source, name) };
}

function feed(entries: SourceTrendingEntry[]): SourceTrendingFeed {
  return { version: 1, source: "skills.sh", board: "trending", fetchedAt: date, entries };
}

function dependencies(overrides: Partial<TrendingMvpDependencies> = {}): TrendingMvpDependencies {
  return {
    canonicalRepo: async repo => repo,
    lookupRepo: async repo => ({ repo, commit, paths: ["skills/one/SKILL.md"],
      meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: `https://github.com/${repo}` } }),
    enrich: async candidate => ({ skill: skill(candidate.id, candidate.skill_md_path) }),
    pin: async row => ({ repo_slug: row.id.split(":")[0]!, repo_commit_sha: commit, skill_tree_sha: tree,
      skill_md_path: row.skill_md_path!, skill_md_sha: row.skill_md_sha!, install_target_name: "one" }),
    inspectAttribution: async () => ({ status: "clear", reason: "no-self-install-conflict" }),
    ...overrides,
  };
}

async function run(options: { entries?: SourceTrendingEntry[]; baseline?: ShadowSkillRecord[];
  seeds?: TrustedSeeds; deps?: Partial<TrendingMvpDependencies> } = {}) {
  return executeTrendingMvp({ entries: options.entries ?? [entry()],
    snapshot: createTrendingMvpSnapshot(options.baseline ?? [], date), seeds: options.seeds ?? seeds(),
    deps: dependencies(options.deps), generatedAt: date });
}

test("selects first 20 missing GitHub skills in rank order, including existing repos; domains remain external", () => {
  const entries = [entry("uizze.sh", "web", 1), entry("owner/repo", "existing", 2),
    ...Array.from({ length: 25 }, (_, i) => entry("owner/repo", `new-${i}`, i + 3))];
  const selected = selectTrendingMvpCandidates(feed(entries), [skill("OWNER/REPO:existing")], 20, Date.parse(date));
  assert.equal(selected.length, 20);
  assert.deepEqual(selected.map(row => row.rank), Array.from({ length: 20 }, (_, i) => i + 3));
  assert.throws(() => selectTrendingMvpCandidates(feed(entries), [], 21), /1..20/);
  assert.throws(() => selectTrendingMvpCandidates(feed(entries), [], 20, Date.parse(date) + 37 * 3600_000), /fresh/);
});

test("rising skills are reviewed first, then the main board, without repeats", () => {
  const rising = [entry("hot/repo", "new", 1), entry("owner/repo", "both", 2)];
  const selected = selectTrendingMvpCandidates({ ...feed([entry("owner/repo", "both", 1), entry("owner/repo", "main", 2)]), hot: rising },
    [], 20, Date.parse(date));
  assert.deepEqual(selected.map(row => row.skillId), ["new", "both", "main"]);
});

test("path resolution supports nonstandard folders without fuzzy guesses, ambiguity, or traversal", () => {
  assert.equal(resolveTrendingMvpPath(["plugins/demo/one/SKILL.md"], "one"), "plugins/demo/one/SKILL.md");
  assert.equal(resolveTrendingMvpPath(["SKILL.md"], "repo-skill"), "SKILL.md");
  assert.equal(resolveTrendingMvpPath(["skills/a/SKILL.md", "skills/one/SKILL.md"], "one"), "skills/one/SKILL.md");
  assert.equal(resolveTrendingMvpPath(["skills/one/SKILL.md", "other/one/SKILL.md"], "one"), null);
  assert.equal(resolveTrendingMvpPath(["skills/someone/SKILL.md"], "one"), null);
  assert.equal(resolveTrendingMvpPath(["../one/SKILL.md", "/one/SKILL.md"], "one"), null);
});

test("identical complete packages prefer the standard path, preserving an existing path when supplied", () => {
  const standard = "skills/one/SKILL.md", bundled = ".github/plugins/demo/skills/one/SKILL.md";
  const packages = { [standard]: { blobSha: blob, treeSha: tree }, [bundled]: { blobSha: blob, treeSha: tree } };
  assert.equal(resolveTrendingMvpPath([bundled, standard], "one", packages), standard);
  assert.equal(resolveTrendingMvpPath([standard, bundled], "one", packages, bundled), bundled);
  assert.equal(resolveTrendingMvpPath([bundled, standard], "one", { ...packages, [bundled]: { blobSha: blob, treeSha: "4".repeat(40) } }), null,
    "identical SKILL.md alone does not prove companion files are identical");
  assert.equal(resolveTrendingMvpPath([bundled, standard], "one", { ...packages, [bundled]: { blobSha: "4".repeat(40), treeSha: tree } }), null);
  assert.equal(resolveTrendingMvpPath([bundled, standard], "one", { [standard]: packages[standard] }), null);
});

test("an existing indexed package and stable ID survive identical plugin packaging", async () => {
  const standard = "skills/one/SKILL.md", bundled = ".github/plugins/demo/skills/one/SKILL.md";
  const existing = skill("owner/repo:historical", bundled);
  const result = await run({ baseline: [existing], deps: {
    lookupRepo: async repo => ({ repo, commit, paths: [standard, bundled],
      packagesByPath: { [standard]: { blobSha: blob, treeSha: tree }, [bundled]: { blobSha: blob, treeSha: tree } },
      meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: `https://github.com/${repo}` } }),
    enrich: async () => { throw new Error("do not re-enrich or rewrite the existing package"); },
  } });
  assert.equal(result.outcomes[0]?.status, "existing");
  assert.equal(result.outcomes[0]?.path, bundled);
  assert.equal(result.outcomes[0]?.existingId, existing.id);
  assert.deepEqual(result.snapshot.cutoverSkills, [existing]);
});

test("a genuinely new skill resolves equivalent package copies without an extra path fetch", async () => {
  const standard = "skills/one/SKILL.md", bundled = ".github/plugins/demo/skills/one/SKILL.md";
  const result = await run({ deps: { lookupRepo: async repo => ({ repo, commit, paths: [bundled, standard],
    packagesByPath: { [standard]: { blobSha: blob, treeSha: tree }, [bundled]: { blobSha: blob, treeSha: tree } },
    meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: `https://github.com/${repo}` } }) } });
  assert.equal(result.outcomes[0]?.status, "added");
  assert.equal(result.outcomes[0]?.path, standard);
});

test("a fresh batch excludes previously reviewed source IDs without changing source ranks or the cap", () => {
  const entries = Array.from({ length: 45 }, (_, i) => entry("owner/repo", `skill-${i}`, i + 1));
  const excluded = new Set(entries.slice(0, 20).map(row => `${row.source}:${row.skillId}`));
  const selected = selectTrendingMvpCandidates(feed(entries), [], 20, Date.parse(date), excluded);
  assert.equal(selected.length, 20);
  assert.deepEqual(selected.map(row => row.rank), Array.from({ length: 20 }, (_, i) => i + 21));
});

test("zero-star, one-install skill enters library with trending source and no creator trust", async () => {
  const result = await run();
  assert.equal(result.outcomes[0]?.status, "added");
  assert.equal(result.snapshot.skillOverlay.skills[0]?.source_tag, "trending");
  assert.equal(result.snapshot.cutoverSkills[0]?.repo_commit_sha, commit);
  const repo = result.snapshot.repoIndex.repos[0]!;
  assert.equal(repo.state, "library");
  assert.equal(repo.isTrustedCreator, false);
  assert.equal(repo.isTrustedVendor, false);
  assert.deepEqual(repo.discoveredSources, ["trending"]);
});

test("adds a new skill in an existing repo; baseline rows and IDs remain byte-equivalent", async () => {
  const existing = { ...skill("owner/repo:existing", "skills/existing/SKILL.md"), skill_md_sha: "4".repeat(40) };
  const baseline = [existing];
  const before = JSON.stringify(baseline);
  const result = await run({ baseline });
  assert.equal(JSON.stringify(baseline), before);
  assertTrendingMvpPreservesBaseline(baseline, result.snapshot.cutoverSkills);
  assert.equal(result.snapshot.cutoverSkills.length, 2);
  assert.equal(result.snapshot.repoIndex.repos[0]?.skillCount, 2);
  assert.throws(() => assertTrendingMvpPreservesBaseline(baseline, []), /removed or changed/);
});

test("canonical redirect aliases preserve existing path identity instead of minting a duplicate", async () => {
  const existing = skill("canonical/repo:historical-id");
  const result = await run({ entries: [entry("old/repo")], baseline: [existing], deps: {
    lookupRepo: async () => ({ repo: "canonical/repo", commit, paths: ["skills/one/SKILL.md"],
      meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: "https://github.com/canonical/repo" } }),
    enrich: async () => { throw new Error("existing path must not be enriched"); },
  } });
  assert.equal(result.outcomes[0]?.status, "existing");
  assert.equal(result.outcomes[0]?.existingId, existing.id);
  assert.deepEqual(result.snapshot.cutoverSkills, [existing]);
});

test("an indexed skill name resolves a different folder name without rewriting its historical ID", async () => {
  const existing = { ...skill("leonxlnx/taste-skill:imagegen-frontend-mobile", "skills/taste-skill/SKILL.md"),
    name: "Design-Taste-Frontend" };
  const result = await run({ entries: [entry("leonxlnx/taste-skill", "design-taste-frontend")], baseline: [existing], deps: {
    lookupRepo: async () => ({ repo: "Leonxlnx/taste-skill", commit, paths: [existing.skill_md_path!],
      meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: "https://github.com/Leonxlnx/taste-skill" } }),
    enrich: async () => { throw new Error("existing name/path must not be enriched"); },
    pin: async () => { throw new Error("existing name/path must not be pinned"); },
    inspectAttribution: async () => { throw new Error("existing name/path needs no attribution fetch"); },
  } });
  assert.equal(result.outcomes[0]?.status, "existing");
  assert.equal(result.outcomes[0]?.path, existing.skill_md_path);
  assert.equal(result.outcomes[0]?.existingId, existing.id);
  assert.deepEqual(result.snapshot, createTrendingMvpSnapshot([existing], date));
});

test("indexed-name lookup ignores missing paths and other repositories, and never chooses an ambiguous match", async () => {
  const named = (id: string, path: string) => ({ ...skill(id, path), name: "one" });
  const first = "skills/first/SKILL.md", second = "skills/second/SKILL.md";
  for (const baseline of [
    [named("owner/repo:historical", "skills/removed/SKILL.md")],
    [named("other/repo:historical", first)],
    [named("owner/repo:first", first), named("owner/repo:second", second)],
    [named("owner/repo:unsafe", "../first/SKILL.md")],
  ]) {
    const result = await run({ baseline, deps: {
      lookupRepo: async repo => ({ repo, commit, paths: [first, second, "../first/SKILL.md"],
        meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: `https://github.com/${repo}` } }),
      enrich: async () => { throw new Error("unverified or ambiguous name/path must not be enriched"); },
    } });
    assert.equal(result.outcomes[0]?.status, "unresolved");
    assert.deepEqual(result.snapshot.cutoverSkills, baseline);
  }
});

test("repo/owner/catalog/suppression exclusions win even for trusted or manual sources", async () => {
  for (const kind of ["repo", "owner", "catalog", "suppression", "override", "provenance"] as const) {
    const policy = seeds();
    policy.manualIncludeRepos.add("owner/repo");
    policy.trustedVendorHandles.add("owner");
    if (kind === "repo") policy.doNotCrawlRepos!.add("owner/repo");
    if (kind === "owner") policy.doNotCrawlOwners!.add("owner");
    if (kind === "catalog") policy.catalogRepoRules.push({ repo: "owner/repo", defaultProvenanceType: "catalog" });
    if (kind === "suppression") policy.suppressedSkillIds!.add("owner/repo:one");
    if (kind === "override") policy.repoOverrides.push({ repo: "owner/repo", exclude: true });
    if (kind === "provenance") policy.provenanceOverrides.push({ repo: "owner/repo", provenanceType: "repackaged" });
    const result = await run({ seeds: policy, deps: { lookupRepo: async () => { throw new Error("blocked source must not fetch"); } } });
    assert.equal(result.outcomes[0]?.status, "blocked", kind);
    assert.equal(result.snapshot.cutoverSkills.length, 0);
  }
});

test("redirect destination and path-derived suppression are checked too", async () => {
  const policy = seeds();
  policy.doNotCrawlRepos!.add("canonical/repo");
  const result = await run({ seeds: policy, deps: { lookupRepo: async () => ({ repo: "canonical/repo", commit,
    paths: ["skills/one/SKILL.md"], meta: { stars: 10, lastUpdated: date, tags: [], githubUrl: "https://github.com/canonical/repo" } }) } });
  assert.equal(result.outcomes[0]?.status, "blocked");
  const suppressed = seeds();
  suppressed.suppressedSkillIds!.add("owner/repo:skills/one");
  assert.equal((await run({ seeds: suppressed })).outcomes[0]?.status, "blocked");
});

test("root and nested skills use the fixed commit; known-invalid root does not block nested skill", async () => {
  for (const path of ["SKILL.md", "custom/one/SKILL.md"]) {
    const result = await run({ deps: {
      lookupRepo: async repo => ({ repo, commit, paths: [path], meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: `https://github.com/${repo}` } }),
      enrich: async candidate => { assert.equal(candidate.ref, commit); assert.equal(candidate.skill_md_path, path); return { skill: skill(candidate.id, path) }; },
    } });
    assert.equal(result.outcomes[0]?.status, "added");
  }
  const policy = seeds(); policy.rootSkillInvalidRepos!.add("owner/repo");
  assert.equal((await run({ seeds: policy })).outcomes[0]?.status, "added");
});

test("invalid content, missing path, and mismatched pinned coordinates cannot enter overlays", async () => {
  const missing = await run({ deps: { lookupRepo: async repo => ({ repo, commit, paths: [],
    meta: { stars: 0, lastUpdated: date, tags: [], githubUrl: `https://github.com/${repo}` } }) } });
  assert.equal(missing.outcomes[0]?.status, "unresolved");
  const invalid = await run({ deps: { enrich: async () => ({ skill: null, failure: { scope: "candidate", key: "one", reason: "missing-frontmatter" } }) } });
  assert.equal(invalid.outcomes[0]?.status, "failed");
  for (const field of ["repo_slug", "skill_md_path", "repo_commit_sha", "skill_tree_sha", "skill_md_sha", "install_target_name"] as const) {
    const result = await run({ deps: { pin: async row => {
      const pinned = await dependencies().pin(row, commit);
      assert.ok(pinned);
      return { ...pinned, [field]: field === "install_target_name" ? "../wrong" : "wrong" };
    } } });
    assert.equal(result.snapshot.cutoverSkills.length, 0, field);
    assert.equal(result.outcomes[0]?.status, "temporary-failure", field);
  }
});

test("exact SHA duplicates stay out without rewriting seed policy", async () => {
  const existing = skill("original/repo:original", "SKILL.md");
  const result = await run({ baseline: [existing] });
  assert.equal(result.outcomes[0]?.status, "duplicate");
  assert.equal(result.outcomes[0]?.existingId, existing.id);
  assert.deepEqual(result.snapshot.cutoverSkills, [existing]);
});

test("temporary failures preserve baseline, but authorization/rate limits stop the batch", async () => {
  const existing = skill("original/repo:original");
  const result = await run({ baseline: [existing], deps: { lookupRepo: async () => { throw Object.assign(new Error("timeout"), { status: 503 }); } } });
  assert.equal(result.outcomes[0]?.status, "temporary-failure");
  assert.deepEqual(result.snapshot.cutoverSkills, [existing]);
  await assert.rejects(run({ deps: { lookupRepo: async () => { throw Object.assign(new Error("unauthorized"), { status: 401 }); } } }), /stopped/);
});

test("replaying the frozen batch adds nothing and does not change state", async () => {
  const first = await run();
  const second = await executeTrendingMvp({ entries: [entry()], snapshot: first.snapshot, seeds: seeds(), deps: dependencies(), generatedAt: date });
  assert.equal(second.outcomes[0]?.status, "existing");
  assert.deepEqual(second.snapshot, first.snapshot);
});

test("an existing stable ID with another path is never silently repointed", async () => {
  const existing = skill("owner/repo:one", "different/one/SKILL.md");
  const result = await run({ baseline: [existing] });
  assert.equal(result.outcomes[0]?.reason, "existing-id-path-conflict");
  assert.deepEqual(result.snapshot.cutoverSkills, [existing]);
});

test("confirmed upstream copies cannot reach pinning or persistence", async () => {
  const result = await run({ deps: {
    inspectAttribution: async () => ({ status: "copy", reason: "confirmed-upstream-copy", upstreamRepo: "original/repo", match: "identical-content" }),
    pin: async () => { throw new Error("must not pin confirmed copies"); },
  } });
  assert.equal(result.outcomes[0]?.status, "blocked");
  assert.equal(result.outcomes[0]?.attribution?.upstreamRepo, "original/repo");
  assert.equal(result.snapshot.cutoverSkills.length, 0);
});

test("a reviewed-content copy under a new ID is blocked without name matching", async () => {
  const policy = seeds();
  policy.provenanceOverrides.push({ id: "reviewed/copy:one", upstreamRepo: "original/repo", provenanceType: "repackaged", reviewedSkillMdSha: blob });
  const result = await run({ seeds: policy, deps: {
    inspectAttribution: async () => { throw new Error("known copy needs no heuristic inspection"); },
    pin: async () => { throw new Error("known copy must not be pinned"); },
  } });
  assert.equal(result.outcomes[0]?.status, "blocked");
  assert.equal(result.outcomes[0]?.reason, "reviewed-copy-content");
  assert.equal(result.snapshot.cutoverSkills.length, 0);
});

test("upstream originals, renamed originals, and changed hashes remain eligible", async () => {
  const policy = seeds();
  policy.provenanceOverrides.push({ id: "reviewed/copy:one", upstreamRepo: "original/repo", provenanceType: "repackaged", reviewedSkillMdSha: blob });
  assert.equal((await run({ seeds: policy, entries: [entry("original/repo")] })).outcomes[0]?.status, "added");
  assert.equal((await run({ seeds: policy, entries: [entry("new-owner/repo")],
    deps: { canonicalRepo: async () => "new-owner/repo" } })).outcomes[0]?.status, "added");
  assert.equal((await run({ seeds: policy, deps: { enrich: async candidate => ({ skill: { ...skill(candidate.id, candidate.skill_md_path), skill_md_sha: "4".repeat(40) } }) } })).outcomes[0]?.status, "added");
});

test("advisory hints do not introduce a new admission threshold; attribution outages defer only that skill", async () => {
  const admitted = await run({ deps: { inspectAttribution: async () => ({ status: "advisory", reason: "unconfirmed-source-hint" }) } });
  assert.equal(admitted.outcomes[0]?.status, "added");
  const deferred = await run({ deps: { inspectAttribution: async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); } } });
  assert.equal(deferred.outcomes[0]?.status, "temporary-failure");
  assert.equal(deferred.snapshot.cutoverSkills.length, 0);
});

test("reviewed mirror rules are skill-specific and cannot promote a sibling copy to keeper", async () => {
  const policy = loadTrustedSeeds("manual-command");
  const reviewed = policy.provenanceOverrides.filter(row => row.notes?.startsWith("Trending review 2026-11-09:"));
  assert.equal(reviewed.length, 18);
  assert.ok(reviewed.every(row => row.id && !row.repo && row.upstreamRepo && row.provenanceType !== "original"));
  for (const rule of reviewed) {
    const [repo, name] = rule.id!.split(":");
    const blocked = await run({ entries: [entry(repo, name)], seeds: policy,
      deps: { lookupRepo: async () => { throw new Error("reviewed copy must be rejected before fetch"); } } });
    assert.equal(blocked.outcomes[0]?.status, "blocked", rule.id);
  }
  const unrelated = await run({ entries: [entry("skills-shell/superpowers", "one")], seeds: policy });
  assert.equal(unrelated.outcomes[0]?.status, "added", "do not block unreviewed skills or the whole creator");
});

test("MVP write guard rejects production, ordinary shadow paths, traversal and symlinks", t => {
  assertTrendingMvpDirectory(join(shadowRoot, "trending-mvp/batch-test"));
  for (const path of [indexPath("skills.json"), shadowRoot, join(shadowRoot, "trending-mvp"), join(shadowRoot, "trending-mvp/../other")]) {
    assert.throws(() => assertTrendingMvpDirectory(path), /dedicated/);
  }
  const temporary = mkdtempSync(join(tmpdir(), "trending-mvp-link-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  symlinkSync(shadowRoot, join(temporary, "redirect"));
  assert.throws(() => assertTrendingMvpDirectory(join(temporary, "redirect/trending-mvp/batch-test")), /dedicated/);
});

test("local replay preserves the original candidates and rejects baseline or candidate drift", t => {
  const root = join(shadowRoot, "trending-mvp");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "test-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entries = [entry()];
  writeFileSync(join(directory, "report.json"), JSON.stringify({ localOnly: true, baseline: { sha256: "original" } }));
  writeFileSync(join(directory, "source-trending.json"), JSON.stringify(feed(entries)));
  writeFileSync(join(directory, "candidates.json"), JSON.stringify(entries));
  assert.deepEqual(loadTrendingMvpReplay(directory, [], "original", 1).entries, entries);
  assert.throws(() => loadTrendingMvpReplay(directory, [], "changed", 1), /same original catalog baseline/);
  writeFileSync(join(directory, "candidates.json"), JSON.stringify([entry("different/repo")]));
  assert.throws(() => loadTrendingMvpReplay(directory, [], "original", 1), /differ/);
  const next = entry("next/repo", "one", 2);
  writeFileSync(join(directory, "source-trending.json"), JSON.stringify(feed([...entries, next])));
  writeFileSync(join(directory, "candidates.json"), JSON.stringify([next]));
  writeFileSync(join(directory, "report.json"), JSON.stringify({ localOnly: true, baseline: { sha256: "original" }, excludedSourceIds: ["owner/repo:one"] }));
  assert.deepEqual(loadTrendingMvpReplay(directory, [], "original", 1).entries, [next]);
});

function indexPath(path: string) { return join(shadowRoot, "..", path); }

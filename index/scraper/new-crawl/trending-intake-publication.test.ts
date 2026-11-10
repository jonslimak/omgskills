import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrendingCatalogs, publishTrendingAdditions, assertTrendingAppendOnly } from "./trending-intake-publication.js";
import { buildTrustedSeeds } from "./seeds.js";
import { prepareSearchCatalog, validateSearchCatalog } from "../../../scripts/search-catalog.mjs";
import type { ShadowSkillRecord } from "./types.js";

const date = "2026-11-10T12:00:00Z";
const seeds = () => buildTrustedSeeds({ officialJson: {}, manualIncludeJson: {}, doNotCrawlJson: {},
  creatorRegistryJson: { creators: [] }, overridesJson: [], catalogJson: [], provenanceJson: [] });
const row = (id = "original/repo:one"): ShadowSkillRecord => ({ id, name: id.split(":")[1]!, author_handle: id.split("/")[0]!,
  github_url: `https://github.com/${id.split(":")[0]}`, description: "Useful original skill", tags: [], stars: 0,
  install_cmd: "git clone", last_updated: date, first_seen: date, provenance_type: "original", skill_md_path: "SKILL.md",
  publisher_handle: id.split("/")[0]!, publisher_repo: id.split(":")[0]!, upstream_repo: null, author_confidence: "high" });
const addition = (): ShadowSkillRecord => ({ ...row("new/repo:two"), source_tag: "trending", repo_slug: "new/repo",
  repo_commit_sha: "1".repeat(40), skill_tree_sha: "2".repeat(40), skill_md_sha: "3".repeat(40),
  install_target_name: "two", quality_tier: "validated" });

function fixture(t: { after: (action: () => void) => void }, search = false) {
  const root = mkdtempSync(join(tmpdir(), "trending-publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "index/seeds"), { recursive: true });
  const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value) + "\n");
  const original = row();
  json(join(root, "index/skills.json"), [original]);
  json(join(root, "index/seeds/do-not-crawl.json"), { repos: [], owners: [] });
  json(join(root, "index/seeds/catalog-repos.json"), []);
  json(join(root, "index/seeds/suppressed-skills.json"), { skills: [] });
  for (const track of ["v2", "crawl4"]) {
    const dir = join(root, "site/data", track); mkdirSync(dir, { recursive: true });
    const bytes = Buffer.from(JSON.stringify([{ ...original, ...(track === "crawl4" ? { quality_tier: "curated" } : {}) }]) + "\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex"), path = `skills-${sha256.slice(0, 12)}.json`;
    writeFileSync(join(dir, path), bytes);
    const manifest = { version: 1, generatedAt: date, skills: { path, sha256, bytes: bytes.length } };
    if (search) prepareSearchCatalog(dir, manifest, {}, true);
    json(join(dir, "manifest.json"), manifest);
  }
  return { root, original, catalogs: loadTrendingCatalogs(root) };
}

test("publishes pinned root additions to both tracks without changing existing records or Crawl 4 tiers", t => {
  const f = fixture(t, true);
  publishTrendingAdditions(f.catalogs, [addition()], seeds(), date);
  const after = loadTrendingCatalogs(f.root);
  for (const track of ["v2", "crawl4"] as const) {
    assert.equal(after[track].skills.length, 2);
    assert.deepEqual(after[track].skills[0], f.catalogs[track].skills[0]);
    assert.ok(validateSearchCatalog(after[track].dataDir, after[track].manifest));
    assert.equal(after[track].skills[1]?.quality_tier, track === "crawl4" ? "validated" : undefined);
  }
});

test("no additions is byte-stable and never rewrites the shared baseline", t => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, "index/skills.json"));
  publishTrendingAdditions(f.catalogs, [], seeds(), date);
  assert.deepEqual(readFileSync(join(f.root, "index/skills.json")), before);
  for (const track of ["v2", "crawl4"] as const) {
    assert.deepEqual(readFileSync(join(f.catalogs[track].dataDir, "manifest.json")), f.catalogs[track].manifestBytes);
  }
});

test("changed baselines, duplicate IDs/content, policy exclusions and invalid pinned metadata fail before activation", t => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, "index/skills.json"));
  const policy = seeds(); policy.doNotCrawlRepos!.add("new/repo");
  assert.throws(() => publishTrendingAdditions(f.catalogs, [addition()], policy, date), /policy-eligible/);
  for (const change of [{ repo_commit_sha: "invalid" }, { source_tag: "manual-curation" }, { author_handle: "wrong" },
    { id: f.original.id }, { provenance_type: "repackaged" as const }]) {
    assert.throws(() => publishTrendingAdditions(f.catalogs, [{ ...addition(), ...change }], seeds(), date));
  }
  assert.throws(() => publishTrendingAdditions(f.catalogs, [addition(), addition()], seeds(), date));
  assert.deepEqual(readFileSync(join(f.root, "index/skills.json")), before);
  const manifest = join(f.catalogs.crawl4.dataDir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ ...f.catalogs.crawl4.manifest, generatedAt: "changed" }));
  assert.throws(() => publishTrendingAdditions(f.catalogs, [addition()], seeds(), date), /manifest changed/);
  assert.deepEqual(readFileSync(join(f.root, "index/skills.json")), before);
});

test("the append-only invariant rejects removals, edits and duplicate additions", () => {
  const original = row(), added = addition();
  assert.throws(() => assertTrendingAppendOnly([original], [], []));
  assert.throws(() => assertTrendingAppendOnly([original], [{ ...original, stars: 10 }], []));
  assert.throws(() => assertTrendingAppendOnly([original], [original, original], [original.id]));
  assert.doesNotThrow(() => assertTrendingAppendOnly([original], [original, added], [added.id]));
});

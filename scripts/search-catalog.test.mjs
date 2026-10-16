import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSearchCatalog, prepareSearchCatalog, validateSearchCatalog } from "./search-catalog.mjs";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";
import { detailBucket, sha256 } from "../mcp/src/search-catalog-format.mjs";

export function fixture(context) {
  const dir = mkdtempSync(join(tmpdir(), "search-catalog-"));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export function sourceAsset(dir, rows) {
  const bytes = Buffer.from(JSON.stringify(rows, null, 2) + "\n");
  const hash = sha256(bytes);
  const ref = { path: `skills-${hash.slice(0, 12)}.json`, sha256: hash, bytes: bytes.length };
  writeFileSync(join(dir, ref.path), bytes);
  return ref;
}
export const records = [
  { id: "Example/skills:root", name: "root", description: "Swift app store design", author_handle: "Example", github_url: "https://github.com/Example/skills", stars: 100, tags: ["swift"], install_cmd: "legacy command", skill_md_path: "SKILL.md", repo_commit_sha: "a".repeat(40), extra: { preserve: [null, 1] }, install_target_name: "old-alias" },
  { id: "example/skills:other", name: "other", description: "UI design 中文", author_handle: "example", github_url: "https://github.com/example/skills", stars: 10, tags: [], skill_md_sha: null },
];

test("deterministic projection and full shards preserve every raw field and source order", context => {
  const dir = fixture(context), source = sourceAsset(dir, records);
  const ref = buildSearchCatalog(dir, source, { generatedAt: "2026-10-16T00:00:00Z" });
  assert.deepEqual(buildSearchCatalog(dir, source, { generatedAt: "2026-10-16T00:00:00Z" }), ref);
  assert.deepEqual(buildSearchCatalog(dir, source, { generatedAt: "2026-10-17T00:00:00Z", previous: ref }), ref);
  const closure = validateSearchCatalog(dir, { skills: source, searchCatalog: ref });
  const search = JSON.parse(readFileSync(join(dir, closure.descriptor.search.path)));
  assert.deepEqual(search.skills.map(skill => skill.id), records.map(skill => skill.id));
  assert.ok(!("install_cmd" in search.skills[0]));
  const index = JSON.parse(readFileSync(join(dir, closure.descriptor.details.path)));
  for (const original of records) {
    const shard = JSON.parse(readFileSync(join(dir, index.shards[detailBucket(original.id)].path)));
    assert.deepEqual(shard.find(row => row.id === original.id), original);
  }
});

test("duplicate source IDs, bad source hashes and mixed snapshots are refused", context => {
  const dir = fixture(context);
  assert.throws(() => buildSearchCatalog(dir, sourceAsset(dir, [records[0], records[0]]), { generatedAt: "2026-10-16" }), /duplicate/);
  const source = sourceAsset(dir, records);
  assert.throws(() => buildSearchCatalog(dir, { ...source, sha256: "0".repeat(64) }, { generatedAt: "2026-10-16" }), /integrity/);
  const ref = buildSearchCatalog(dir, source, { generatedAt: "2026-10-16" });
  assert.throws(() => validateSearchCatalog(dir, { skills: { ...source, bytes: 1 }, searchCatalog: ref }), /source mismatch/);
  assert.throws(() => buildSearchCatalog(dir, { ...source, path: "../skills.json" }, { generatedAt: "2026-10-16" }), /reference/);
});

test("missing, changed or symlinked detail files block publication before manifest activation", context => {
  const dir = fixture(context), source = sourceAsset(dir, records);
  const manifest = { version: 1, generatedAt: "2026-10-16", skills: source };
  prepareSearchCatalog(dir, manifest, {}, true);
  publishCatalogManifest({ dataDir: dir, manifest, previousManifest: {}, prefixes: ["skills"] });
  const original = readFileSync(join(dir, "manifest.json"));
  const closure = validateSearchCatalog(dir, manifest);
  const index = JSON.parse(readFileSync(join(dir, closure.descriptor.details.path)));
  const ref = Object.values(index.shards)[0];
  const saved = readFileSync(join(dir, ref.path));
  const publish = () => publishCatalogManifest({ dataDir: dir, manifest, previousManifest: manifest, prefixes: ["skills"] });
  rmSync(join(dir, ref.path));
  assert.throws(publish);
  symlinkSync(join(dir, source.path), join(dir, ref.path));
  assert.throws(publish, /Invalid catalog file/);
  rmSync(join(dir, ref.path));
  writeFileSync(join(dir, ref.path), Buffer.alloc(saved.length));
  assert.throws(publish, /integrity/);
  assert.deepEqual(readFileSync(join(dir, "manifest.json")), original);
});

test("publication retains the previous closure, recent generations and unknown orphans", context => {
  const dir = fixture(context);
  let previous = {};
  const manifests = [];
  for (let i = 0; i < 4; i++) {
    const manifest = { version: 1, generatedAt: i === 0 ? new Date().toISOString() : "2000-01-01", skills: sourceAsset(dir, [{ ...records[0], name: `version-${i}` }]) };
    prepareSearchCatalog(dir, manifest, previous, true);
    publishCatalogManifest({ dataDir: dir, manifest, previousManifest: previous, prefixes: ["skills"] });
    manifests.push(manifest);
    previous = manifest;
  }
  validateSearchCatalog(dir, manifests[0]); // Recent, despite no longer being the previous version.
  validateSearchCatalog(dir, manifests[2]);
  validateSearchCatalog(dir, manifests[3]);
  assert.ok(!readdirSync(dir).includes(manifests[1].searchCatalog.path));
  const orphan = "skill-details-000000000000.json";
  writeFileSync(join(dir, orphan), "unowned");
  const before = readdirSync(dir);
  publishCatalogManifest({ dataDir: dir, manifest: previous, previousManifest: previous, prefixes: ["skills"] });
  assert.deepEqual(readdirSync(dir), before);
});

test("first publication is opt-in; signal-only and collection-only writers retain the complete bundle", context => {
  const dir = fixture(context), source = sourceAsset(dir, records);
  const first = { version: 1, skills: source, generatedAt: "2026-10-16" };
  prepareSearchCatalog(dir, first, {}, false);
  assert.equal(first.searchCatalog, undefined);
  prepareSearchCatalog(dir, first, {}, true);
  const next = { ...first, generatedAt: "2026-10-17" };
  prepareSearchCatalog(dir, next, first, false);
  assert.deepEqual(next.searchCatalog, first.searchCatalog);
  publishCatalogManifest({ dataDir: dir, manifest: next, previousManifest: first, prefixes: ["collections"] });
  validateSearchCatalog(dir, JSON.parse(readFileSync(join(dir, "manifest.json"))));
});

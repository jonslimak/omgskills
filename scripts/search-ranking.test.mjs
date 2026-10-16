import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildSearchCatalog, prepareSearchCatalog, retainedSearchAssets, validateSearchCatalog } from "./search-catalog.mjs";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";
import { sha256, rankingPayload, searchCatalogLimits } from "../mcp/src/search-catalog-format.mjs";
import { collectionLikeIds } from "../mcp/src/search-ranking-policy.mjs";
import { fixture, records, sourceAsset } from "./search-catalog.test.mjs";

const rows = [{ ...records[0], provenance_type: "repackaged" }, records[1]];
test("optional ranking keeps old projection/shards identical and updates same-source descriptors", context => {
  const dir = fixture(context), skills = sourceAsset(dir, rows), generatedAt = "2026-10-16";
  const old = buildSearchCatalog(dir, skills, { generatedAt });
  const ref = buildSearchCatalog(dir, skills, { generatedAt, previous: old, ranking: true });
  assert.notDeepEqual(ref, old);
  const a = validateSearchCatalog(dir, { skills, searchCatalog: old }), b = validateSearchCatalog(dir, { skills, searchCatalog: ref });
  assert.deepEqual(a.descriptor.search, b.descriptor.search); assert.deepEqual(a.descriptor.details, b.descriptor.details);
  assert.ok(b.paths.includes(b.descriptor.ranking.path));
  assert.deepEqual(buildSearchCatalog(dir, skills, { generatedAt: "2026-10-17", previous: ref }), ref);
  const next = { skills: sourceAsset(dir, [...rows, { ...records[0], id: "new", publisher_repo: "OPENCLAW/SKILLS" }]), generatedAt };
  prepareSearchCatalog(dir, next, { skills, searchCatalog: ref }, false);
  const c = validateSearchCatalog(dir, next), data = JSON.parse(readFileSync(join(dir, c.descriptor.ranking.path)));
  assert.deepEqual(data.collectionLikeIds, [records[0].id, "new"].sort());
  assert.deepEqual(collectionLikeIds([{ id: "a", provenance_type: "mirrored" }, { id: "b" }, { id: "c", publisher_repo: "affaan-m/ecc" }]), ["c"]);
});

test("ranking integrity, source equality and membership are required before publication", context => {
  const dir = fixture(context), skills = sourceAsset(dir, rows);
  const ref = buildSearchCatalog(dir, skills, { generatedAt: "2026-10-16", ranking: true });
  const manifest = { skills, searchCatalog: ref }, closure = validateSearchCatalog(dir, manifest), asset = closure.descriptor.ranking;
  const payload = JSON.parse(readFileSync(join(dir, asset.path))), ids = new Set(rows.map(row => row.id));
  for (const change of [{ policy: "unknown" }, { schemaVersion: 2 }, { sourceSkillsSha256: "0".repeat(64) }, { skillCount: 0 },
    { collectionLikeIds: [rows[0].id, rows[0].id] }, { collectionLikeIds: ["absent"] }, { extra: true }]) assert.throws(() => rankingPayload({ ...payload, ...change }, closure.descriptor, ids));
  publishCatalogManifest({ dataDir: dir, manifest, previousManifest: {}, prefixes: ["skills"] });
  const saved = readFileSync(join(dir, "manifest.json"));
  writeFileSync(join(dir, asset.path), "bad");
  assert.throws(() => publishCatalogManifest({ dataDir: dir, manifest, previousManifest: manifest, prefixes: ["skills"] }));
  assert.deepEqual(readFileSync(join(dir, "manifest.json")), saved);
  const replacement = Buffer.from(JSON.stringify({ ...payload, collectionLikeIds: [] }) + "\n"), hash = sha256(replacement);
  const ranking = { path: `search-ranking-${hash.slice(0, 12)}.json`, sha256: hash, bytes: replacement.length };
  writeFileSync(join(dir, ranking.path), replacement);
  const descriptor = Buffer.from(JSON.stringify({ ...closure.descriptor, ranking }) + "\n"), digest = sha256(descriptor);
  const bad = { path: `search-catalog-${digest.slice(0, 12)}.json`, sha256: digest, bytes: descriptor.length };
  writeFileSync(join(dir, bad.path), descriptor);
  assert.throws(() => validateSearchCatalog(dir, { skills, searchCatalog: bad }), /Ranking\/source/);
  assert.throws(() => validateSearchCatalog(dir, { skills, searchCatalog: { ...bad, bytes: searchCatalogLimits.metadata + 1 } }));
});

test("ranking assets survive current/previous/grace retention and repeated no-op publishing", context => {
  const dir = fixture(context); let previous = {}; const manifests = [];
  for (let i = 0; i < 4; i++) {
    const next = { skills: sourceAsset(dir, [{ ...rows[0], id: `owner/repo:${i}` }]), generatedAt: i === 0 ? new Date().toISOString() : "2000-01-01" };
    prepareSearchCatalog(dir, next, previous, true, i === 0);
    publishCatalogManifest({ dataDir: dir, manifest: next, previousManifest: previous, prefixes: ["skills"] });
    manifests.push({ manifest: next, closure: validateSearchCatalog(dir, next) }); previous = next;
  }
  const retained = retainedSearchAssets(dir, readdirSync(dir));
  assert.ok(retained.has(manifests[0].closure.descriptor.ranking.path));
  for (const i of [0, 2, 3]) validateSearchCatalog(dir, manifests[i].manifest);
  assert.ok(!readdirSync(dir).includes(manifests[1].closure.descriptor.ranking.path));
  const before = readdirSync(dir);
  publishCatalogManifest({ dataDir: dir, manifest: previous, previousManifest: previous, prefixes: ["skills"] });
  assert.deepEqual(readdirSync(dir), before);
});

import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  assetReference, descriptor, detailBucket, detailIndex, encodeInstallable, installablePayload, projectSearchSkill, searchCatalogLimits,
  searchPayload, rankingPayload, sha256, validateShard, verifyBytes,
} from "../mcp/src/search-catalog-format.mjs";
import { pinnedInstallFor } from "../mcp/src/install-record.mjs";
import { collectionLikeIds, collectionOriginPolicy } from "../mcp/src/search-ranking-policy.mjs";

export const searchAssetPattern = /^(?:search-catalog|search-skills|search-ranking|search-installable|skill-detail-index|skill-details)-[a-f0-9]{12}\.json$/;

function readAsset(dataDir, ref, limit = Number.MAX_SAFE_INTEGER) {
  assetReference(ref, limit);
  const path = join(dataDir, ref.path);
  const info = lstatSync(path);
  if (!info.isFile() || info.size !== ref.bytes) throw new Error(`Invalid catalog file: ${ref.path}`);
  const bytes = readFileSync(path);
  verifyBytes(bytes, ref);
  return JSON.parse(bytes.toString("utf8"));
}
function writeAsset(dataDir, prefix, value, limit) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  if (bytes.length > limit) throw new Error(`Search catalog ${prefix} exceeds its byte limit`);
  const hash = sha256(bytes);
  const ref = { path: `${prefix}-${hash.slice(0, 12)}.json`, sha256: hash, bytes: bytes.length };
  try { writeFileSync(join(dataDir, ref.path), bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    readAsset(dataDir, ref, limit);
  }
  return ref;
}

/** Validate the entire closure before publication or deployment, including raw-record equality. */
export function validateSearchCatalog(dataDir, manifest, { fullRecords = true } = {}) {
  if (!manifest.searchCatalog) return null;
  const ref = assetReference(manifest.searchCatalog, searchCatalogLimits.metadata);
  const desc = descriptor(readAsset(dataDir, ref), manifest.skills);
  const search = searchPayload(readAsset(dataDir, desc.search, searchCatalogLimits.search), desc);
  const index = detailIndex(readAsset(dataDir, desc.details, searchCatalogLimits.metadata), desc);
  const buckets = new Map();
  for (const skill of search.skills) {
    const key = detailBucket(skill.id);
    if (!buckets.has(key)) buckets.set(key, new Map());
    buckets.get(key).set(skill.id, skill);
  }
  if (Object.keys(index.shards).length !== buckets.size) throw new Error("Detail index membership mismatch");
  const source = fullRecords ? readAsset(dataDir, desc.sourceSkills) : null;
  if (source && (!Array.isArray(source) || source.length !== search.skillCount
    || source.some((skill, i) => !isDeepStrictEqual(projectSearchSkill(skill), search.skills[i])))) throw new Error("Search projection/source mismatch");
  const byId = source && new Map(source.map(skill => [skill.id, skill]));
  if (desc.ranking) {
    const ranking = rankingPayload(readAsset(dataDir, desc.ranking, searchCatalogLimits.ranking), desc, new Set(search.skills.map(row => row.id)));
    if (source && !isDeepStrictEqual(ranking.collectionLikeIds, collectionLikeIds(source))) throw new Error("Ranking/source mismatch");
  }
  if (desc.installable) {
    const pinned = installablePayload(readAsset(dataDir, desc.installable, searchCatalogLimits.install), desc, search.skills);
    if (source && source.some(skill => !!pinnedInstallFor(skill) !== pinned.has(skill.id))) throw new Error("Installable/source mismatch");
  }
  for (const [key, expected] of buckets) {
    const shardRef = index.shards[key];
    const records = validateShard(readAsset(dataDir, shardRef, searchCatalogLimits.shard), key, expected);
    if (byId) for (const [id, record] of records) {
      if (!isDeepStrictEqual(record, byId.get(id))) throw new Error(`Full catalog record changed: ${id}`);
    }
  }
  return { descriptor: desc, paths: [ref.path, desc.sourceSkills.path, desc.search.path, desc.details.path, ...(desc.ranking ? [desc.ranking.path] : []), ...(desc.installable ? [desc.installable.path] : []), ...Object.values(index.shards).map(asset => asset.path)] };
}

export function buildSearchCatalog(dataDir, sourceRef, { generatedAt, previous, ranking = false } = {}) {
  assetReference(sourceRef);
  if (previous) {
    const raw = readAsset(dataDir, previous, searchCatalogLimits.metadata);
    const old = descriptor(raw, raw.sourceSkills);
    ranking ||= old.ranking !== undefined;
    if (old.sourceSkills.sha256 === sourceRef.sha256 && old.sourceSkills.path === sourceRef.path && old.sourceSkills.bytes === sourceRef.bytes && (!ranking || old.ranking) && old.installable) {
      validateSearchCatalog(dataDir, { skills: sourceRef, searchCatalog: previous });
      return previous;
    }
  }
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Search generation needs a valid publication date");
  const skills = readAsset(dataDir, sourceRef);
  if (!Array.isArray(skills)) throw new Error("Search source must be an array");
  const rows = skills.map(projectSearchSkill);
  const desc = { schemaVersion: 1, generatedAt, sourceSkills: sourceRef, skillCount: skills.length };
  searchPayload({ schemaVersion: 1, sourceSkillsSha256: sourceRef.sha256, skillCount: rows.length, skills: rows }, desc);
  const buckets = new Map();
  for (const record of skills) {
    const bucket = detailBucket(record.id);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(record);
  }
  const shards = Object.fromEntries([...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, records]) =>
    [key, writeAsset(dataDir, "skill-details", records, searchCatalogLimits.shard)]));
  desc.search = writeAsset(dataDir, "search-skills", { schemaVersion: 1, sourceSkillsSha256: sourceRef.sha256, skillCount: rows.length, skills: rows }, searchCatalogLimits.search);
  desc.details = writeAsset(dataDir, "skill-detail-index", { schemaVersion: 1, sourceSkillsSha256: sourceRef.sha256, skillCount: rows.length, partition: "sha256-first-byte", shards }, searchCatalogLimits.metadata);
  if (ranking) desc.ranking = writeAsset(dataDir, "search-ranking", { schemaVersion: 1, policy: collectionOriginPolicy,
    sourceSkillsSha256: sourceRef.sha256, skillCount: skills.length, collectionLikeIds: collectionLikeIds(skills) }, searchCatalogLimits.ranking);
  desc.installable = writeAsset(dataDir, "search-installable", { schemaVersion: 1, sourceSkillsSha256: sourceRef.sha256,
    skillCount: skills.length, pinned: encodeInstallable(skills.map(skill => !!pinnedInstallFor(skill))) }, searchCatalogLimits.install);
  const ref = writeAsset(dataDir, "search-catalog", desc, searchCatalogLimits.metadata);
  validateSearchCatalog(dataDir, { skills: sourceRef, searchCatalog: ref });
  return ref;
}

export function prepareSearchCatalog(dataDir, manifest, previousManifest = {}, enabled = process.env.OMGSKILLS_SEARCH_CATALOG === "1", ranking = false) {
  // Explicit opt-in for first publication; once present, every writer keeps it in sync.
  if (!enabled && !previousManifest.searchCatalog && !manifest.searchCatalog) return;
  manifest.searchCatalog = buildSearchCatalog(dataDir, manifest.skills, {
    generatedAt: manifest.generatedAt, previous: previousManifest.searchCatalog ?? manifest.searchCatalog, ranking,
  });
}

/** Recent/unknown generations are retained conservatively; never prune an invalid closure. */
export function retainedSearchAssets(dataDir, filenames, now = Date.now()) {
  const keep = new Set();
  const owned = new Set();
  for (const filename of filenames.filter(name => /^search-catalog-[a-f0-9]{12}\.json$/.test(name))) {
    const path = join(dataDir, filename);
    if (!lstatSync(path).isFile()) throw new Error("Unsafe retained search descriptor");
    const bytes = readFileSync(path);
    const raw = JSON.parse(bytes.toString("utf8"));
    const ref = { path: filename, bytes: bytes.length, sha256: sha256(bytes) };
    if (!filename.endsWith(`${ref.sha256.slice(0, 12)}.json`)) throw new Error("Invalid retained descriptor hash");
    const closure = validateSearchCatalog(dataDir, { skills: raw.sourceSkills, searchCatalog: ref }, { fullRecords: false });
    for (const name of closure.paths) owned.add(name);
    const age = now - Date.parse(closure.descriptor.generatedAt);
    if (!Number.isFinite(age) || age < 24 * 60 * 60_000) for (const name of closure.paths) keep.add(name);
  }
  for (const name of filenames) if (searchAssetPattern.test(name) && !owned.has(name)) keep.add(name);
  return keep;
}

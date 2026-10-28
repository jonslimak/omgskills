import { createHash } from "node:crypto";
import { collectionOriginPolicy } from "./search-ranking-policy.mjs";

export const searchFields = Object.freeze([
  "id", "name", "description", "github_url", "author_handle", "tags", "stars", "last_updated", "first_seen",
]);
export const searchCatalogLimits = Object.freeze({ metadata: 256 * 1024, search: 64 * 1024 * 1024, shard: 4 * 1024 * 1024, ranking: 4 * 1024 * 1024, install: 256 * 1024 });
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const detailBucket = id => sha256(Buffer.from(id, "utf8")).slice(0, 2);
export const projectSearchSkill = skill => Object.fromEntries(searchFields.filter(key => skill[key] !== undefined).map(key => [key, skill[key]]));
export function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid search catalog object");
  return value;
}
export function assetReference(value, maxBytes = Number.MAX_SAFE_INTEGER) {
  const ref = object(value);
  if (typeof ref.path !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(ref.path)
    || typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256)
    || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > maxBytes) throw new Error("Invalid search catalog asset reference");
  return ref;
}
export function sameAsset(a, b) {
  return a.path === b.path && a.sha256 === b.sha256 && a.bytes === b.bytes;
}
export function verifyBytes(bytes, ref) {
  if (bytes.length !== ref.bytes || sha256(bytes) !== ref.sha256) throw new Error(`Search catalog integrity mismatch: ${ref.path}`);
}
export function descriptor(value, source) {
  const data = object(value);
  if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.skillCount) || data.skillCount < 0
    || typeof data.generatedAt !== "string" || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error("Invalid search catalog descriptor");
  const declaredSource = assetReference(data.sourceSkills);
  if (!sameAsset(declaredSource, assetReference(source))) throw new Error("Search catalog source mismatch");
  assetReference(data.search, searchCatalogLimits.search);
  assetReference(data.details, searchCatalogLimits.metadata);
  if (data.ranking !== undefined) assetReference(data.ranking, searchCatalogLimits.ranking);
  if (data.installable !== undefined) assetReference(data.installable, searchCatalogLimits.install);
  return data;
}
export function rankingPayload(value, source, ids) {
  const data = object(value);
  if (Object.keys(data).sort().join(",") !== "collectionLikeIds,policy,schemaVersion,skillCount,sourceSkillsSha256"
    || data.schemaVersion !== 1 || data.policy !== collectionOriginPolicy
    || data.sourceSkillsSha256 !== source.sourceSkills.sha256 || data.skillCount !== source.skillCount
    || !Array.isArray(data.collectionLikeIds)) throw new Error("Invalid ranking payload");
  let previous;
  for (const id of data.collectionLikeIds) {
    if (typeof id !== "string" || !ids.has(id) || (previous !== undefined && previous >= id)) throw new Error("Invalid ranking membership");
    previous = id;
  }
  return data;
}
/** One bit per search row, in search order: set when the record can be installed at a pinned commit. */
export function encodeInstallable(flags) {
  const bytes = new Uint8Array(Math.ceil(flags.length / 8));
  flags.forEach((flag, i) => { if (flag) bytes[i >> 3] |= 1 << (i & 7); });
  return Buffer.from(bytes).toString("base64");
}
/** Validated installable payload, decoded to the IDs of the given search rows. */
export function installablePayload(value, source, rows) {
  const data = object(value);
  if (Object.keys(data).sort().join(",") !== "pinned,schemaVersion,skillCount,sourceSkillsSha256"
    || data.schemaVersion !== 1 || data.sourceSkillsSha256 !== source.sourceSkills.sha256
    || data.skillCount !== source.skillCount || rows.length !== data.skillCount || typeof data.pinned !== "string") throw new Error("Invalid installable payload");
  const bytes = Buffer.from(data.pinned, "base64");
  if (bytes.toString("base64") !== data.pinned || bytes.length !== Math.ceil(rows.length / 8)
    || (rows.length % 8 && bytes[bytes.length - 1] >> (rows.length % 8))) throw new Error("Invalid installable payload");
  return new Set(rows.filter((_, i) => bytes[i >> 3] & (1 << (i & 7))).map(row => row.id));
}
export function searchPayload(value, source) {
  const data = object(value);
  if (data.schemaVersion !== 1 || data.sourceSkillsSha256 !== source.sourceSkills.sha256
    || data.skillCount !== source.skillCount || !Array.isArray(data.skills) || data.skills.length !== data.skillCount) throw new Error("Invalid search payload");
  const ids = new Set();
  for (const skill of data.skills) {
    object(skill);
    if (typeof skill.id !== "string" || !skill.id.trim() || ids.has(skill.id)
      || Object.keys(skill).some(key => !searchFields.includes(key))) throw new Error("Invalid or duplicate search skill");
    ids.add(skill.id);
  }
  return data;
}
export function detailIndex(value, source) {
  const data = object(value);
  if (data.schemaVersion !== 1 || data.sourceSkillsSha256 !== source.sourceSkills.sha256
    || data.skillCount !== source.skillCount || data.partition !== "sha256-first-byte") throw new Error("Invalid detail index");
  const shards = object(data.shards);
  const paths = new Set();
  for (const [bucket, ref] of Object.entries(shards)) {
    if (!/^[a-f0-9]{2}$/.test(bucket)) throw new Error("Invalid detail bucket");
    const asset = assetReference(ref, searchCatalogLimits.shard);
    if (paths.has(asset.path)) throw new Error("Duplicate detail shard reference");
    paths.add(asset.path);
  }
  return data;
}
export function validateShard(records, bucket, expected) {
  if (!Array.isArray(records) || records.length !== expected.size) throw new Error("Detail shard membership mismatch");
  const found = new Map();
  for (const record of records) {
    object(record);
    if (typeof record.id !== "string" || detailBucket(record.id) !== bucket || !expected.has(record.id) || found.has(record.id)
      || JSON.stringify(projectSearchSkill(record)) !== JSON.stringify(expected.get(record.id))) throw new Error("Detail shard record mismatch");
    found.set(record.id, record);
  }
  return found;
}

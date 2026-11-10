import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assetReference, verifyBytes, type AssetReference } from "../../../mcp/src/search-catalog-format.mjs";
import { prepareSearchCatalog, validateSearchCatalog } from "../../../scripts/search-catalog.mjs";
import { publishCatalogManifest } from "../../../scripts/publish-catalog-manifest.mjs";
import { prepareSourceTrending } from "../../../scripts/prepare-source-trending.mjs";
import { pinnedPackageMetadataFromSkill } from "./package-metadata.js";
import { trendingMvpPolicyReason } from "./trending-admission-mvp.js";
import { repoFromGithubUrl } from "../policy/effective-policy.js";
import type { Skill } from "../types.js";
import type { ShadowSkillRecord, TrustedSeeds } from "./types.js";

type Manifest = Record<string, unknown> & { skills: AssetReference; generatedAt?: string; searchCatalog?: AssetReference };
type Track = { dataDir: string; manifest: Manifest; manifestBytes: Buffer; skills: Skill[]; bytes: Buffer };
export type TrendingCatalogs = { repoRoot: string; v2: Track; crawl4: Track };
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function readTrack(repoRoot: string, track: string): Track {
  const dataDir = join(repoRoot, "site/data", track);
  const manifestBytes = readFileSync(join(dataDir, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString()) as Manifest;
  const ref = assetReference(manifest.skills);
  const path = join(dataDir, ref.path);
  if (!lstatSync(path).isFile()) throw new Error("Trending intake requires regular catalog files");
  const bytes = readFileSync(path);
  verifyBytes(bytes, ref);
  const skills = JSON.parse(bytes.toString()) as Skill[];
  if (!Array.isArray(skills) || !skills.length || new Set(skills.map(row => row.id)).size !== skills.length) {
    throw new Error("Invalid Trending intake baseline catalog");
  }
  return { dataDir, manifest, manifestBytes, bytes, skills };
}

export function loadTrendingCatalogs(repoRoot: string): TrendingCatalogs {
  const v2 = readTrack(repoRoot, "v2"), crawl4 = readTrack(repoRoot, "crawl4");
  assert.deepEqual(readFileSync(join(repoRoot, "index/skills.json")), v2.bytes, "Trending intake requires the current published v2 baseline");
  assert.deepEqual([...v2.skills.map(row => row.id)].sort(), [...crawl4.skills.map(row => row.id)].sort(),
    "Trending intake requires aligned track membership; reconcile through the normal crawler first");
  return { repoRoot, v2, crawl4 };
}

export function assertTrendingAppendOnly(before: Skill[], after: Skill[], addedIds: string[]): void {
  const byId = new Map(after.map(row => [row.id, row]));
  assert.equal(byId.size, after.length, "Trending intake cannot introduce duplicate IDs");
  assert.equal(after.length, before.length + addedIds.length, "Trending intake must only append verified additions");
  for (const row of before) assert.deepEqual(byId.get(row.id), row, `Trending intake cannot remove or modify ${row.id}`);
  const oldIds = new Set(before.map(row => row.id));
  assert.deepEqual(after.filter(row => !oldIds.has(row.id)).map(row => row.id).sort(), [...addedIds].sort());
}

export function publishTrendingAdditions(catalogs: TrendingCatalogs, additions: ShadowSkillRecord[], seeds: TrustedSeeds, generatedAt: string): void {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Trending publication requires a valid timestamp");
  if (additions.length > 20) throw new Error("Trending intake cannot publish more than 20 additions");
  const fresh = loadTrendingCatalogs(catalogs.repoRoot);
  for (const key of ["v2", "crawl4"] as const) {
    assert.deepEqual(fresh[key].manifestBytes, catalogs[key].manifestBytes, "Trending baseline manifest changed during verification");
    assert.deepEqual(fresh[key].bytes, catalogs[key].bytes, "Trending baseline catalog changed during verification");
  }
  if (!additions.length) return;
  const existingIds = new Set(catalogs.crawl4.skills.map(row => row.id.toLowerCase()));
  const existingHashes = new Set(catalogs.crawl4.skills.map(row => row.skill_md_sha?.toLowerCase()).filter(Boolean));
  for (const skill of additions) {
    const pinned = pinnedPackageMetadataFromSkill(skill);
    const repo = repoFromGithubUrl(skill.github_url);
    if (!pinned || pinned.repo_slug.toLowerCase() !== repo || skill.source_tag !== "trending"
      || skill.provenance_type !== "original" || skill.author_handle?.toLowerCase() !== repo.split("/")[0]
      || skill.id.split(":")[0]?.toLowerCase() !== repo || trendingMvpPolicyReason(skill.id, skill.github_url, seeds)
      || existingIds.has(skill.id.toLowerCase()) || existingHashes.has(skill.skill_md_sha!.toLowerCase())) {
      throw new Error(`Trending addition is not a new, policy-eligible pinned original: ${skill.id}`);
    }
    existingIds.add(skill.id.toLowerCase()); existingHashes.add(skill.skill_md_sha!.toLowerCase());
  }
  const sorted = [...additions].sort((a, b) => a.id.localeCompare(b.id));
  const prepared = (["v2", "crawl4"] as const).map(key => {
    const track = catalogs[key];
    const added = key === "v2" ? sorted.map(({ quality_tier: _tier, ...skill }) => skill) : sorted;
    const records = [...track.skills, ...added];
    assertTrendingAppendOnly(track.skills, records, sorted.map(row => row.id));
    const bytes = Buffer.from(JSON.stringify(records) + "\n");
    const sha256 = digest(bytes), path = `skills-${sha256.slice(0, 12)}.json`;
    const file = join(track.dataDir, path);
    if (!existsSync(file)) writeFileSync(file, bytes, { flag: "wx" });
    else assert.deepEqual(readFileSync(file), bytes, "Existing hashed asset differs");
    const manifest: Manifest = { ...track.manifest, generatedAt, skills: { path, sha256, bytes: bytes.length } };
    prepareSearchCatalog(track.dataDir, manifest, track.manifest);
    prepareSourceTrending({ repoRoot: catalogs.repoRoot, dataDir: track.dataDir, manifest, skills: records });
    validateSearchCatalog(track.dataDir, manifest);
    return { ...track, manifest, bytes };
  });
  // Both candidates are prepared before any tracked baseline or manifest is activated.
  const baseline = join(catalogs.repoRoot, "index/skills.json");
  writeFileSync(`${baseline}.tmp`, prepared[0]!.bytes);
  renameSync(`${baseline}.tmp`, baseline);
  for (const [index, key] of (["v2", "crawl4"] as const).entries()) {
    publishCatalogManifest({ dataDir: catalogs[key].dataDir, manifest: prepared[index]!.manifest,
      previousManifest: catalogs[key].manifest, prefixes: ["skills", "source-trending"] });
  }
}

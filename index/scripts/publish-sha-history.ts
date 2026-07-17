import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTrustedSeeds } from "../scraper/new-crawl/seeds.js";
import {
  buildShaCanonicalArtifact,
  shaCanonicalOptionsFromSeeds,
  type ShaCanonicalOptions,
  type ShaCanonicalSkill,
} from "../scraper/new-crawl/sha-canonical.js";
import { validateShaCanonicalArtifact } from "../scraper/new-crawl/validate-canonical-policy.js";

export type ShaHistorySkill = {
  id: string;
  skill_md_sha?: string | null;
};

export type CanonicalShaEntry = {
  skillId: string;
  confidence: "high";
  reason: "same-repo";
};

type Asset = {
  path: string;
  sha256: string;
  bytes: number;
};

type Manifest = Record<string, unknown> & {
  shaHistory?: Asset;
};

export type ShaHistoryAsset = {
  version: number;
  generatedAt: string;
  shaToSkillIds: Record<string, string[]>;
  canonicalBySha?: Record<string, CanonicalShaEntry>;
};

export type BuildShaHistoryResult = {
  asset: ShaHistoryAsset;
  changed: boolean;
  previousCounts: { shaCount: number; pairCount: number };
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");
const repoRoot = resolve(indexRoot, "..");
const skillsPath = join(indexRoot, "skills.json");
const dataRoot = resolve(process.env.OMGSKILLS_DATA_ROOT ?? join(repoRoot, "site", "data"));
const productionOrigin = (process.env.PRODUCTION_ORIGIN ?? "https://omgskills.com").replace(/\/$/, "");
const allowShrink = process.env.OMGSKILLS_ALLOW_SHA_HISTORY_SHRINK === "1";
const dataTrackDirs = [
  { name: "crawl4", dir: join(dataRoot, "crawl4"), manifestURL: `${productionOrigin}/data/crawl4/manifest.json` },
  { name: "v2", dir: join(dataRoot, "v2"), manifestURL: `${productionOrigin}/data/v2/manifest.json` },
];

function fail(message: string): never {
  throw new Error(`publish-sha-history: ${message}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.json() as T;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function shouldPublishCanonicalBySha(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHA_CANONICAL_PUBLISH === "1";
}

export function countShaHistory(asset: ShaHistoryAsset): { shaCount: number; pairCount: number } {
  let pairCount = 0;
  for (const ids of Object.values(asset.shaToSkillIds)) {
    pairCount += ids.length;
  }
  return { shaCount: Object.keys(asset.shaToSkillIds).length, pairCount };
}

function addMapping(map: Map<string, Set<string>>, sha: string, id: string): void {
  const normalizedSha = sha.trim().toLowerCase();
  const normalizedId = id.trim();
  if (!normalizedSha || !normalizedId) return;
  const ids = map.get(normalizedSha) ?? new Set<string>();
  ids.add(normalizedId);
  map.set(normalizedSha, ids);
}

function mergeAsset(map: Map<string, Set<string>>, asset: ShaHistoryAsset): void {
  for (const [sha, ids] of Object.entries(asset.shaToSkillIds ?? {})) {
    for (const id of ids) {
      addMapping(map, sha, id);
    }
  }
}

async function loadExistingShaHistory(track: { name: string; dir: string; manifestURL: string }): Promise<ShaHistoryAsset | null> {
  const manifestPath = join(track.dir, "manifest.json");
  let manifest: Manifest | null = null;
  if (existsSync(manifestPath)) {
    manifest = readJson<Manifest>(manifestPath);
  } else {
    manifest = await fetchJson<Manifest>(track.manifestURL);
  }

  if (!manifest.shaHistory) return null;

  const localAssetPath = join(track.dir, manifest.shaHistory.path);
  if (existsSync(localAssetPath)) {
    return readJson<ShaHistoryAsset>(localAssetPath);
  }

  const remoteAssetURL = new URL(manifest.shaHistory.path, track.manifestURL).toString();
  return await fetchJson<ShaHistoryAsset>(remoteAssetURL);
}

function buildAsset(
  map: Map<string, Set<string>>,
  generatedAt: string,
  canonicalBySha?: Record<string, CanonicalShaEntry>,
): ShaHistoryAsset {
  const shaToSkillIds: Record<string, string[]> = {};
  for (const sha of [...map.keys()].sort()) {
    shaToSkillIds[sha] = [...(map.get(sha) ?? [])].sort();
  }
  const asset: ShaHistoryAsset = {
    version: 1,
    generatedAt,
    shaToSkillIds,
  };
  if (canonicalBySha !== undefined) asset.canonicalBySha = canonicalBySha;
  return asset;
}

function assetContent(asset: ShaHistoryAsset): Omit<ShaHistoryAsset, "generatedAt"> {
  const content: Omit<ShaHistoryAsset, "generatedAt"> = {
    version: asset.version,
    shaToSkillIds: asset.shaToSkillIds,
  };
  if (asset.canonicalBySha !== undefined) content.canonicalBySha = asset.canonicalBySha;
  return content;
}

function sameAssetContent(left: ShaHistoryAsset, right: ShaHistoryAsset): boolean {
  return JSON.stringify(assetContent(left)) === JSON.stringify(assetContent(right));
}

export function buildCanonicalBySha(
  skills: ShaCanonicalSkill[],
  options: ShaCanonicalOptions,
): Record<string, CanonicalShaEntry> {
  const artifact = buildShaCanonicalArtifact(skills, "publish", options);
  const failures = validateShaCanonicalArtifact(artifact, skills);
  if (failures.length > 0) {
    const first = failures[0]!;
    fail(`canonical policy validation failed (${first.code}): ${first.detail}`);
  }

  const canonicalBySha: Record<string, CanonicalShaEntry> = {};
  for (const cluster of artifact.clusters) {
    if (
      cluster.confidence !== "high" ||
      cluster.reason !== "same-repo" ||
      !cluster.canonicalSkillId
    ) {
      continue;
    }
    canonicalBySha[cluster.skillMdSha] = {
      skillId: cluster.canonicalSkillId,
      confidence: "high",
      reason: "same-repo",
    };
  }
  return canonicalBySha;
}

export function buildShaHistoryAsset(
  existingAssets: ShaHistoryAsset[],
  skills: ShaHistorySkill[],
  generatedAt: string,
  canonicalBySha?: Record<string, CanonicalShaEntry>,
): BuildShaHistoryResult {
  const map = new Map<string, Set<string>>();
  for (const asset of existingAssets) mergeAsset(map, asset);

  const mergedExisting = buildAsset(map, generatedAt);
  const previousCounts = countShaHistory(mergedExisting);

  for (const skill of skills) {
    if (skill.skill_md_sha) addMapping(map, skill.skill_md_sha, skill.id);
  }

  const proposed = buildAsset(map, generatedAt, canonicalBySha);
  const matchingExisting = existingAssets
    .filter((asset) => sameAssetContent(asset, proposed))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
  const changed = matchingExisting === undefined;
  return {
    asset: buildAsset(map, matchingExisting?.generatedAt ?? generatedAt, canonicalBySha),
    changed,
    previousCounts,
  };
}

export function assertShaHistoryDoesNotShrink(
  before: { shaCount: number; pairCount: number },
  after: { shaCount: number; pairCount: number },
  allow: boolean,
): void {
  if (!allow && (after.shaCount < before.shaCount || after.pairCount < before.pairCount)) {
    fail(`refusing to shrink sha history: ${before.shaCount}/${before.pairCount} -> ${after.shaCount}/${after.pairCount}`);
  }
}

export function writeShaHistoryAsset(dataDir: string, asset: ShaHistoryAsset): Asset {
  mkdirSync(dataDir, { recursive: true });
  const data = Buffer.from(`${JSON.stringify(asset, null, 2)}\n`);
  const hash = sha256(data);
  const filename = `sha-history-${hash.slice(0, 12)}.json`;
  const outputPath = join(dataDir, filename);
  if (!existsSync(outputPath)) writeFileSync(outputPath, data);
  return { path: filename, sha256: hash, bytes: data.length };
}

export function patchManifest(dataDir: string, asset: Asset): void {
  const manifestPath = join(dataDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`missing manifest: ${manifestPath}`);
  }
  const manifest = readJson<Manifest>(manifestPath);
  if (JSON.stringify(manifest.shaHistory) === JSON.stringify(asset)) return;
  manifest.shaHistory = asset;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function pruneSupersededShaHistoryAssets(dataDir: string, keepPaths: string[]): void {
  const keep = new Set(keepPaths.filter(Boolean));
  for (const file of readdirSync(dataDir)) {
    if (!file.startsWith("sha-history-") || !file.endsWith(".json") || keep.has(file)) continue;
    rmSync(join(dataDir, file), { force: true });
  }
}

export function previousShaHistoryAssetPath(dataDir: string, currentPath: string): string | undefined {
  return readdirSync(dataDir)
    .filter((file) => file.startsWith("sha-history-") && file.endsWith(".json") && file !== currentPath)
    .map((file) => {
      try {
        return { file, generatedAt: readJson<ShaHistoryAsset>(join(dataDir, file)).generatedAt ?? "" };
      } catch {
        return { file, generatedAt: "" };
      }
    })
    .sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt) || right.file.localeCompare(left.file)
    )[0]?.file;
}

async function main() {
  if (!existsSync(skillsPath)) fail(`missing ${skillsPath}`);

  const existingAssets: ShaHistoryAsset[] = [];
  const priorPaths = new Map<string, string>();
  for (const track of dataTrackDirs) {
    const existing = await loadExistingShaHistory(track);
    if (!existing) continue;
    existingAssets.push(existing);
    const manifestPath = join(track.dir, "manifest.json");
    if (existsSync(manifestPath)) {
      const priorPath = readJson<Manifest>(manifestPath).shaHistory?.path;
      if (priorPath) priorPaths.set(track.name, priorPath);
    }
  }

  // shadow-crawl-health runs this after promote:cutover. Keep that ordering: the
  // canonical policy must use the suppression-filtered skills.json being published.
  const skills = readJson<ShaCanonicalSkill[]>(skillsPath);
  const canonicalEnabled = shouldPublishCanonicalBySha();
  const canonicalBySha = canonicalEnabled
    ? buildCanonicalBySha(skills, shaCanonicalOptionsFromSeeds(loadTrustedSeeds()))
    : undefined;
  const result = buildShaHistoryAsset(
    existingAssets,
    skills,
    new Date().toISOString(),
    canonicalBySha,
  );
  assertShaHistoryDoesNotShrink(result.previousCounts, countShaHistory(result.asset), allowShrink);

  for (const track of dataTrackDirs) {
    const written = writeShaHistoryAsset(track.dir, result.asset);
    patchManifest(track.dir, written);
    const priorManifestPath = priorPaths.get(track.name);
    const previousPath = priorManifestPath && priorManifestPath !== written.path && existsSync(join(track.dir, priorManifestPath))
      ? priorManifestPath
      : previousShaHistoryAssetPath(track.dir, written.path);
    pruneSupersededShaHistoryAssets(track.dir, [written.path, previousPath ?? ""]);
    console.log(`wrote ${join(track.dir, written.path)}`);
  }
  const finalCounts = countShaHistory(result.asset);
  const canonicalCount = Object.keys(result.asset.canonicalBySha ?? {}).length;
  console.log(
    `${result.changed ? "published" : "reused"} ${finalCounts.shaCount} shas, ${finalCounts.pairCount} sha/id pairs, and ${canonicalCount} canonical mappings (${canonicalEnabled ? "enabled" : "disabled"})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Skill = {
  id: string;
  skill_md_sha?: string | null;
};

type Asset = {
  path: string;
  sha256: string;
  bytes: number;
};

type Manifest = Record<string, unknown> & {
  shaHistory?: Asset;
};

type ShaHistoryAsset = {
  version: number;
  generatedAt: string;
  shaToSkillIds: Record<string, string[]>;
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
  console.error(`publish-sha-history: ${message}`);
  process.exit(1);
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

function counts(asset: ShaHistoryAsset): { shaCount: number; pairCount: number } {
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

function buildAsset(map: Map<string, Set<string>>): ShaHistoryAsset {
  const shaToSkillIds: Record<string, string[]> = {};
  for (const sha of [...map.keys()].sort()) {
    shaToSkillIds[sha] = [...(map.get(sha) ?? [])].sort();
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    shaToSkillIds,
  };
}

function writeAsset(dataDir: string, asset: ShaHistoryAsset): Asset {
  mkdirSync(dataDir, { recursive: true });
  const data = Buffer.from(`${JSON.stringify(asset, null, 2)}\n`);
  const hash = sha256(data);
  const filename = `sha-history-${hash.slice(0, 12)}.json`;
  writeFileSync(join(dataDir, filename), data);
  return { path: filename, sha256: hash, bytes: data.length };
}

function patchManifest(dataDir: string, asset: Asset): void {
  const manifestPath = join(dataDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`missing manifest: ${manifestPath}`);
  }
  const manifest = readJson<Manifest>(manifestPath);
  manifest.shaHistory = asset;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  if (!existsSync(skillsPath)) fail(`missing ${skillsPath}`);

  const map = new Map<string, Set<string>>();
  for (const track of dataTrackDirs) {
    const existing = await loadExistingShaHistory(track);
    if (!existing) continue;
    mergeAsset(map, existing);
  }
  const previousCounts = { shaCount: map.size, pairCount: [...map.values()].reduce((sum, ids) => sum + ids.size, 0) };

  const skills = readJson<Skill[]>(skillsPath);
  for (const skill of skills) {
    if (skill.skill_md_sha) {
      addMapping(map, skill.skill_md_sha, skill.id);
    }
  }

  const asset = buildAsset(map);
  if ((previousCounts.shaCount > 0 || previousCounts.pairCount > 0) && !allowShrink) {
    const before = previousCounts;
    const after = counts(asset);
    if (after.shaCount < before.shaCount || after.pairCount < before.pairCount) {
      fail(`refusing to shrink sha history: ${before.shaCount}/${before.pairCount} -> ${after.shaCount}/${after.pairCount}`);
    }
  }

  for (const track of dataTrackDirs) {
    const written = writeAsset(track.dir, asset);
    patchManifest(track.dir, written);
    console.log(`wrote ${join(track.dir, written.path)}`);
  }
  const finalCounts = counts(asset);
  console.log(`published ${finalCounts.shaCount} shas and ${finalCounts.pairCount} sha/id pairs`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

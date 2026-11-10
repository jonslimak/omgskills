import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assetReference, verifyBytes } from "../mcp/src/search-catalog-format.mjs";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";
import { prepareSourceTrending } from "./prepare-source-trending.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
const reportAssets = {
  trending: "trending",
  trendingLeaderboard: "trending-leaderboard",
  leaderboardViewData: "leaderboard-view-data",
  xTrending: "x-trending",
  skillSignals: "skill-signals",
  authorSignals: "author-signals",
  authorLeaderboards: "author-leaderboards",
};

export function publishContentData({ repoRoot = defaultRepoRoot, track = "v2", generatedAt = new Date().toISOString() } = {}) {
  if (!["v2", "crawl4"].includes(track)) throw new Error(`Unsupported content publication track: ${track}`);
  const dataDir = join(repoRoot, "site/data", track);
  const previousManifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const source = assetReference(previousManifest.skills);
  const skills = readFileSync(join(dataDir, source.path));
  verifyBytes(skills, source);
  if (track === "v2") {
    const current = readFileSync(join(repoRoot, "index/skills.json"));
    if (source.sha256 !== createHash("sha256").update(current).digest("hex") || source.bytes !== current.length) {
      throw new Error("Content reports require index/skills.json to match the published v2 catalog; run the normal catalog publication separately.");
    }
  }
  const records = JSON.parse(skills.toString("utf8"));
  if (!Array.isArray(records)) throw new Error(`${track} catalog must be an array`);
  const skillIds = new Set(records.map(skill => skill.id));

  // Reports own only these assets; catalog, search, identity and collections stay intact.
  const ownedAssets = track === "crawl4" ? { trending: reportAssets.trending } : reportAssets;
  const manifest = { ...previousManifest };
  const pending = [];
  for (const [key, prefix] of Object.entries(ownedAssets)) {
    const source = join(repoRoot, "index", `${prefix}.json`);
    if (!existsSync(source)) continue;
    const bytes = readFileSync(source);
    const value = JSON.parse(bytes.toString("utf8"));
    if (key === "trending") {
      if (!Array.isArray(value)) throw new Error("Trending report must be an array");
      for (const entry of value) {
        if (!entry?.id || !skillIds.has(entry.id)) {
          throw new Error(`Trending ID is missing from the published ${track} catalog: ${entry?.id ?? "<missing>"}`);
        }
      }
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${prefix}-${sha256.slice(0, 12)}.json`;
    manifest[key] = { path, sha256, bytes: bytes.length };
    pending.push({ path, bytes });
  }
  if (JSON.stringify(manifest) !== JSON.stringify(previousManifest)) manifest.generatedAt = generatedAt;
  for (const { path, bytes } of pending) {
    if (!existsSync(join(dataDir, path))) writeFileSync(join(dataDir, path), bytes, { flag: "wx" });
  }
  prepareSourceTrending({ repoRoot, dataDir, manifest, skills: records });
  if (JSON.stringify(manifest) !== JSON.stringify(previousManifest)) manifest.generatedAt = generatedAt;
  publishCatalogManifest({ dataDir, manifest, previousManifest, prefixes: [...Object.values(ownedAssets), "source-trending"] });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: publish-content-data.mjs [v2|crawl4]");
  const track = process.argv[2] ?? "v2";
  publishContentData({ track });
  console.log(`Published ${track} content reports; catalog unchanged.`);
}

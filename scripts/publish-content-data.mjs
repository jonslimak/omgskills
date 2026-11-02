import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishCatalogManifest } from "./publish-catalog-manifest.mjs";

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

export function publishContentData({ repoRoot = defaultRepoRoot, generatedAt = new Date().toISOString() } = {}) {
  const dataDir = join(repoRoot, "site/data/v2");
  const previousManifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const skills = readFileSync(join(repoRoot, "index/skills.json"));
  const skillsHash = createHash("sha256").update(skills).digest("hex");
  if (previousManifest.skills?.sha256 !== skillsHash || previousManifest.skills?.bytes !== skills.length) {
    throw new Error("Content reports require index/skills.json to match the published v2 catalog; run the normal catalog publication separately.");
  }

  // Reports own only these assets; catalog, search, identity and collections stay intact.
  const manifest = { ...previousManifest };
  const pending = [];
  for (const [key, prefix] of Object.entries(reportAssets)) {
    const source = join(repoRoot, "index", `${prefix}.json`);
    if (!existsSync(source)) continue;
    const bytes = readFileSync(source);
    JSON.parse(bytes.toString("utf8"));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${prefix}-${sha256.slice(0, 12)}.json`;
    manifest[key] = { path, sha256, bytes: bytes.length };
    pending.push({ path, bytes });
  }
  if (JSON.stringify(manifest) !== JSON.stringify(previousManifest)) manifest.generatedAt = generatedAt;
  for (const { path, bytes } of pending) {
    if (!existsSync(join(dataDir, path))) writeFileSync(join(dataDir, path), bytes, { flag: "wx" });
  }
  publishCatalogManifest({ dataDir, manifest, previousManifest, prefixes: Object.values(reportAssets) });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishContentData();
  console.log("Published v2 content reports; catalog unchanged.");
}

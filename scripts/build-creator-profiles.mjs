import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const categories = new Set(["influential", "most-used", "peak", "consistent", "prolific", "efficient"]);
const validHandle = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function profileLink(value, handle, hosts) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password
      || (handle ? ![`/${handle.toLowerCase()}`, `/${handle.toLowerCase()}/`].includes(url.pathname.toLowerCase()) : !/^\/[a-zA-Z0-9_]{1,100}\/?$/.test(url.pathname))
      || url.search || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function creatorProfilesSummary(collections, authors, generatedAt) {
  if (!Array.isArray(collections?.collections) || !Array.isArray(authors)) throw new Error("Invalid creator profile inputs.");
  const byHandle = new Map(authors.filter(row => validHandle(row.authorHandle)).map(row => [row.authorHandle.toLowerCase(), row]));
  const profiles = Object.create(null);
  for (const collection of collections.collections) {
    if (collection.type !== "author") continue;
    const handle = collection.authorHandle;
    if (!validHandle(handle) || Object.hasOwn(profiles, handle.toLowerCase())) throw new Error("Invalid or duplicate creator handle.");
    const row = byHandle.get(handle.toLowerCase());
    const stats = row?.stats;
    const best = stats?.bestSkill;
    profiles[handle.toLowerCase()] = {
      description: typeof collection.description === "string" ? collection.description : "",
      githubUrl: profileLink(collection.githubUrl, handle, ["github.com"]) || `https://github.com/${handle}`,
      xUrl: profileLink(collection.xUrl, undefined, ["x.com", "twitter.com"]),
      skillCount: count(stats?.skillCount),
      totalStars: count(stats?.totalStars),
      totalInstalls: count(stats?.totalInstalls),
      bestSkill: typeof best?.id === "string" && typeof best?.name === "string" ? { id: best.id, name: best.name } : undefined,
      rankings: Object.entries(row?.leaderboardCategories || {}).filter(([category, badge]) =>
        categories.has(category) && Number.isSafeInteger(badge?.rank) && badge.rank > 0 && typeof badge.value === "string"
      ).slice(0, 3).map(([category, badge]) => ({ category, rank: badge.rank, value: badge.value.replace(/\u2b50/g, "stars") })),
    };
  }
  if (Object.keys(profiles).length > 1000) throw new Error("Creator summary exceeds the profile limit.");
  return { version: 1, generatedAt, profiles };
}

async function manifestAt(siteDir, track) {
  const directory = path.join(siteDir, "data", track);
  try { return { directory, manifest: JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) }; }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function asset(source, key) {
  const descriptor = source.manifest[key];
  if (!descriptor || !new RegExp(`^${key === "collections" ? "collections" : "author-leaderboards"}(?:-[a-f0-9]+)?\\.json$`).test(descriptor.path)) {
    throw new Error(`Invalid ${key} asset path.`);
  }
  const bytes = await readFile(path.join(source.directory, descriptor.path));
  if (bytes.length !== descriptor.bytes || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) {
    throw new Error(`Creator summary source failed integrity validation: ${key}.`);
  }
  return JSON.parse(bytes);
}

export async function buildCreatorProfiles({ siteDir, outputPath }) {
  const tracks = (await Promise.all(["crawl4", "v2", ""].map(track => manifestAt(siteDir, track)))).filter(Boolean);
  const collectionSource = tracks.find(source => source.manifest.collections);
  const authorSource = tracks.find(source => source.manifest.authorLeaderboards);
  if (!collectionSource || !authorSource) throw new Error("Published creator profile sources are missing.");
  const [collections, authors] = await Promise.all([asset(collectionSource, "collections"), asset(authorSource, "authorLeaderboards")]);
  const summary = creatorProfilesSummary(collections, authors, authorSource.manifest.generatedAt);
  const json = JSON.stringify(summary) + "\n";
  if (Buffer.byteLength(json) > 1_000_000) throw new Error("Creator summary exceeds its size budget.");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json);
  return { profiles: Object.keys(summary.profiles).length, bytes: Buffer.byteLength(json) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await buildCreatorProfiles({ siteDir: path.join(root, "site"), outputPath: path.join(root, "portal/public/creator-profiles.json") });
  console.log(`Creator summary: ${result.profiles} profiles, ${result.bytes} bytes.`);
}

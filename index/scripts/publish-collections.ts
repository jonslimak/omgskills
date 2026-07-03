import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Skill = {
  id: string;
  name: string;
  description: string;
  author_handle: string;
  stars?: number;
};

type Asset = {
  path: string;
  sha256: string;
  bytes: number;
};

type Manifest = Record<string, unknown> & {
  collections?: Asset;
};

type SourceCollection = {
  id: string;
  type: "topic";
  title: string;
  subtitle: string;
  imageUrl?: string | null;
  featuredSkillIds: string[];
  skillIds: string[];
  description?: string | null;
};

type AuthorOverride = {
  title?: string;
  subtitle?: string;
  imageUrl?: string | null;
  featuredSkillIds?: string[];
  description?: string | null;
};

type CollectionsSource = {
  version?: number;
  featuredAuthors: string[];
  authorOverrides?: Record<string, AuthorOverride>;
  collections: SourceCollection[];
};

type SkillCollection = {
  id: string;
  type: "author" | "topic";
  title: string;
  subtitle: string;
  authorHandle?: string;
  imageUrl?: string | null;
  featuredSkillIds: string[];
  skillIds?: string[];
  description?: string | null;
};

type CollectionsAsset = {
  version: number;
  generatedAt: string;
  collections: SkillCollection[];
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");
const repoRoot = resolve(indexRoot, "..");
const sourcePath = join(indexRoot, "curations", "collections.json");
const skillsPath = join(indexRoot, "skills.json");
const dataTrackDirs = [
  join(repoRoot, "site", "data", "crawl4"),
  join(repoRoot, "site", "data", "v2"),
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fail(message: string): never {
  console.error(`publish-collections: ${message}`);
  process.exit(1);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function titleFromHandle(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function topSkillsForAuthor(skills: Skill[], handle: string, limit: number): string[] {
  return skills
    .filter((skill) => normalizeHandle(skill.author_handle) === normalizeHandle(handle))
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((skill) => skill.id);
}

function validateSkillIds(ids: string[], skillIds: Set<string>, context: string): void {
  for (const id of ids) {
    if (!skillIds.has(id)) {
      fail(`unknown skill id in ${context}: ${id}`);
    }
  }
}

function validateSource(source: CollectionsSource, skills: Skill[]): void {
  const skillIds = new Set(skills.map((skill) => skill.id));
  const authorHandles = new Set(skills.map((skill) => normalizeHandle(skill.author_handle)).filter(Boolean));

  if (!Array.isArray(source.featuredAuthors)) {
    fail("featuredAuthors must be an array");
  }
  if (!Array.isArray(source.collections)) {
    fail("collections must be an array");
  }

  for (const handle of source.featuredAuthors) {
    if (!authorHandles.has(normalizeHandle(handle))) {
      fail(`unknown featured author handle: ${handle}`);
    }
    const override = source.authorOverrides?.[handle];
    if (override?.featuredSkillIds) {
      validateSkillIds(override.featuredSkillIds, skillIds, `authorOverrides.${handle}.featuredSkillIds`);
    }
  }

  const collectionIds = new Set<string>();
  for (const collection of source.collections) {
    if (collectionIds.has(collection.id)) {
      fail(`duplicate collection id: ${collection.id}`);
    }
    collectionIds.add(collection.id);
    validateSkillIds(collection.featuredSkillIds, skillIds, `${collection.id}.featuredSkillIds`);
    validateSkillIds(collection.skillIds, skillIds, `${collection.id}.skillIds`);
  }
}

function buildCollectionsAsset(source: CollectionsSource, skills: Skill[]): CollectionsAsset {
  const authorCollections: SkillCollection[] = source.featuredAuthors.map((handle) => {
    const override = source.authorOverrides?.[handle] ?? {};
    const featuredSkillIds = override.featuredSkillIds ?? topSkillsForAuthor(skills, handle, 5);
    return {
      id: `author-${normalizeHandle(handle)}`,
      type: "author",
      title: override.title ?? titleFromHandle(handle),
      subtitle: override.subtitle ?? `Skills by @${handle}`,
      authorHandle: handle,
      imageUrl: override.imageUrl ?? null,
      featuredSkillIds,
      description: override.description ?? null,
    };
  });

  return {
    version: source.version ?? 1,
    generatedAt: new Date().toISOString(),
    collections: [...authorCollections, ...source.collections],
  };
}

function writeCollectionsAsset(dataDir: string, asset: CollectionsAsset): Asset {
  mkdirSync(dataDir, { recursive: true });
  const data = Buffer.from(`${JSON.stringify(asset, null, 2)}\n`);
  const hash = sha256(data);
  const filename = `collections-${hash.slice(0, 12)}.json`;
  writeFileSync(join(dataDir, filename), data);
  return { path: filename, sha256: hash, bytes: data.length };
}

function patchManifest(dataDir: string, asset: Asset): void {
  const manifestPath = join(dataDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`missing manifest: ${manifestPath}`);
  }
  const manifest = readJson<Manifest>(manifestPath);
  manifest.collections = asset;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function main() {
  if (!existsSync(sourcePath)) fail(`missing ${sourcePath}`);
  if (!existsSync(skillsPath)) fail(`missing ${skillsPath}`);

  const source = readJson<CollectionsSource>(sourcePath);
  const skills = readJson<Skill[]>(skillsPath);
  validateSource(source, skills);
  const asset = buildCollectionsAsset(source, skills);

  for (const dataDir of dataTrackDirs) {
    const written = writeCollectionsAsset(dataDir, asset);
    patchManifest(dataDir, written);
    console.log(`wrote ${join(dataDir, written.path)}`);
  }
  console.log(`published ${asset.collections.length} collections`);
}

main();

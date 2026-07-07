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

type CreatorEntry = {
  handle: string;
  roles?: string[];
  watch?: boolean;
  featured?: boolean;
  aliases?: string[];
  notes?: string;
};

type CreatorRegistrySource = {
  creators: CreatorEntry[];
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
const creatorsPath = join(indexRoot, "seeds", "creators.json");
const skillsPath = join(indexRoot, "skills.json");
const dataTrackDirs = [
  join(repoRoot, "site", "data", "crawl4"),
  join(repoRoot, "site", "data", "v2"),
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fail(message: string): never {
  throw new Error(message);
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

function handleVariants(entry: CreatorEntry): string[] {
  return [entry.handle, ...(entry.aliases ?? [])].map((value) => value.trim()).filter(Boolean);
}

function findCatalogHandle(skills: Skill[], variants: string[]): string | null {
  const wanted = new Set(variants.map(normalizeHandle));
  const match = skills.find((skill) => wanted.has(normalizeHandle(skill.author_handle)));
  return match?.author_handle ?? null;
}

function findAuthorOverride(source: CollectionsSource, variants: string[]): AuthorOverride {
  const overrides = source.authorOverrides ?? {};
  const wanted = new Set(variants.map(normalizeHandle));
  const key = Object.keys(overrides).find((candidate) => wanted.has(normalizeHandle(candidate)));
  return key ? (overrides[key] ?? {}) : {};
}

function topSkillsForAuthor(skills: Skill[], variants: string[], limit: number): string[] {
  const wanted = new Set(variants.map(normalizeHandle));
  return skills
    .filter((skill) => wanted.has(normalizeHandle(skill.author_handle)))
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

export function featuredCreatorEntries(registry: CreatorRegistrySource): CreatorEntry[] {
  return registry.creators.filter((entry) => entry.featured);
}

export function validateSource(source: CollectionsSource, registry: CreatorRegistrySource, skills: Skill[]): void {
  const skillIds = new Set(skills.map((skill) => skill.id));

  if (!Array.isArray(source.featuredAuthors)) {
    fail("featuredAuthors must be an array");
  }
  if (!Array.isArray(source.collections)) {
    fail("collections must be an array");
  }

  const featured = featuredCreatorEntries(registry);
  if (featured.length === 0 && source.featuredAuthors.length > 0) {
    fail("creators.json has zero featured creators while legacy collections.json.featuredAuthors is non-empty");
  }

  for (const entry of featured) {
    if (!entry.watch) {
      fail(`${entry.handle}: featured creator must also be watched`);
    }
    const variants = handleVariants(entry);
    const catalogHandle = findCatalogHandle(skills, variants);
    if (!catalogHandle) {
      fail(`${entry.handle}: featured creator not found as a catalog author`);
    }
    const override = findAuthorOverride(source, variants);
    if (override.featuredSkillIds) {
      validateSkillIds(override.featuredSkillIds, skillIds, `authorOverrides.${entry.handle}.featuredSkillIds`);
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

export function buildCollectionsAsset(source: CollectionsSource, registry: CreatorRegistrySource, skills: Skill[]): CollectionsAsset {
  const authorCollections: SkillCollection[] = featuredCreatorEntries(registry).map((entry) => {
    const variants = handleVariants(entry);
    const catalogHandle = findCatalogHandle(skills, variants) ?? entry.handle;
    const override = findAuthorOverride(source, variants);
    const featuredSkillIds = override.featuredSkillIds ?? topSkillsForAuthor(skills, variants, 5);
    return {
      id: `author-${normalizeHandle(catalogHandle)}`,
      type: "author",
      title: override.title ?? titleFromHandle(catalogHandle),
      subtitle: override.subtitle ?? `Skills by @${catalogHandle}`,
      authorHandle: catalogHandle,
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
  if (!existsSync(creatorsPath)) fail(`missing ${creatorsPath}`);
  if (!existsSync(skillsPath)) fail(`missing ${skillsPath}`);

  const source = readJson<CollectionsSource>(sourcePath);
  const registry = readJson<CreatorRegistrySource>(creatorsPath);
  const skills = readJson<Skill[]>(skillsPath);
  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  for (const dataDir of dataTrackDirs) {
    const written = writeCollectionsAsset(dataDir, asset);
    patchManifest(dataDir, written);
    console.log(`wrote ${join(dataDir, written.path)}`);
  }
  console.log(`published ${asset.collections.length} collections`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`publish-collections: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

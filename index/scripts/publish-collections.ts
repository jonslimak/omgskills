import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCreatorRegistry,
  normalizeCreatorHandle,
  type CreatorRegistryEntry,
  type CreatorRegistrySource,
} from "../scraper/creator-registry.js";
import { loadPolicySources, typedPolicySources } from "../scraper/policy/loader.js";
import { assertPolicyValid, validatePolicy } from "../scraper/policy/validator.js";
import { policyRunMetadata } from "../scraper/policy/metadata.js";
import {
  collectionDelta,
  parsePublicationImpactOverride,
  summarizeCollections,
  type CollectionSummary,
  type PublicationImpactOverride,
} from "./publication-impact.js";
import type {
  AuthorOverride,
  CollectionsPolicySource as CollectionsSource,
  SourceCollection,
} from "../scraper/policy/types.js";

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
const siteRoot = resolve(process.env.SITE_DIR ?? join(repoRoot, "site"));
const sourcePath = join(indexRoot, "curations", "collections.json");
const creatorsPath = join(indexRoot, "seeds", "creators.json");
const skillsPath = join(indexRoot, "skills.json");
const dataTrackDirs = [
  join(siteRoot, "data", "crawl4"),
  join(siteRoot, "data", "v2"),
];
const impactJsonPath = join(indexRoot, "shadow", "publication-impact.collections.json");
const impactMarkdownPath = join(indexRoot, "shadow", "publication-impact.collections.md");
const COLLECTION_MEMBERSHIP_REMOVAL_PERCENT = 0.2;

export type CollectionsPublishMode = "publish" | "remove";

export type CollectionsTrack = {
  name: string;
  dir: string;
};

export type CollectionsImpactTrack = {
  name: string;
  previous: CollectionSummary | null;
  proposed: CollectionSummary | null;
  addedIds: string[];
  removedIds: string[];
  removedMembershipCount: number;
  removedMembershipPercent: number;
  blocked: boolean;
};

export type CollectionsImpactReport = {
  version: 1;
  generatedAt: string;
  sourceCommit: string;
  policyDigest: string;
  mode: CollectionsPublishMode;
  authorizedRemoval: boolean;
  authorizedRemovalReason: string | null;
  override: { enabled: boolean; reason: string | null };
  tracks: CollectionsImpactTrack[];
  errors: string[];
  blocked: boolean;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fail(message: string): never {
  throw new Error(message);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function collectionsPublishMode(
  env: NodeJS.ProcessEnv = process.env,
): CollectionsPublishMode {
  const value = env.COLLECTIONS_PUBLISH?.trim().toLowerCase();
  if (!value || value === "1" || value === "publish") return "publish";
  if (value === "0" || value === "remove") return "remove";
  fail(`invalid COLLECTIONS_PUBLISH value "${value}"; expected 1, publish, 0, remove, or unset`);
}

function titleFromHandle(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function handleVariants(entry: CreatorRegistryEntry): string[] {
  return [entry.handle, ...(entry.aliases ?? [])].map((value) => value.trim()).filter(Boolean);
}

function findCatalogHandle(skills: Skill[], variants: string[]): string | null {
  const wanted = new Set(variants.map(normalizeCreatorHandle));
  const match = skills.find((skill) => wanted.has(normalizeCreatorHandle(skill.author_handle)));
  return match?.author_handle ?? null;
}

function findAuthorOverride(source: CollectionsSource, variants: string[]): AuthorOverride {
  const overrides = source.authorOverrides ?? {};
  const wanted = new Set(variants.map(normalizeCreatorHandle));
  const key = Object.keys(overrides).find((candidate) => wanted.has(normalizeCreatorHandle(candidate)));
  return key ? (overrides[key] ?? {}) : {};
}

function topSkillsForAuthor(skills: Skill[], variants: string[], limit: number): string[] {
  const wanted = new Set(variants.map(normalizeCreatorHandle));
  return skills
    .filter((skill) => wanted.has(normalizeCreatorHandle(skill.author_handle)))
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((skill) => skill.id);
}

function validateSkillIds(ids: string[], skillIds: Set<string>, context: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      fail(`duplicate skill id in ${context}: ${id}`);
    }
    seen.add(id);
    if (!skillIds.has(id)) {
      fail(`unknown skill id in ${context}: ${id}`);
    }
  }
}

export function featuredCreatorEntries(registry: CreatorRegistrySource): CreatorRegistryEntry[] {
  return registry.creators.filter((entry) => entry.featured);
}

export function validateSource(source: CollectionsSource, registry: CreatorRegistrySource, skills: Skill[]): void {
  const skillIds = new Set(skills.map((skill) => skill.id));

  if (!Array.isArray(source.collections)) {
    fail("collections must be an array");
  }

  buildCreatorRegistry(registry);
  const featured = featuredCreatorEntries(registry);
  for (const entry of featured) {
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
      id: `author-${normalizeCreatorHandle(catalogHandle)}`,
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

function collectionsAssetBuffer(asset: CollectionsAsset): Buffer {
  return Buffer.from(`${JSON.stringify(asset, null, 2)}\n`);
}

function collectionsAssetDescriptor(data: Buffer): Asset {
  const hash = sha256(data);
  return {
    path: `collections-${hash.slice(0, 12)}.json`,
    sha256: hash,
    bytes: data.length,
  };
}

function writeCollectionsAsset(dataDir: string, data: Buffer, descriptor: Asset): Asset {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, descriptor.path), data);
  return descriptor;
}

function readManifest(dataDir: string): Manifest {
  const manifestPath = join(dataDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`missing manifest: ${manifestPath}`);
  }
  return readJson<Manifest>(manifestPath);
}

function patchManifest(dataDir: string, asset: Asset | null, generatedAt: string): void {
  const manifestPath = join(dataDir, "manifest.json");
  const manifest = readManifest(dataDir);
  if (asset) manifest.collections = asset;
  else delete manifest.collections;
  manifest.generatedAt = generatedAt;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function loadPublishedCollections(track: CollectionsTrack): CollectionSummary | null {
  const descriptor = readManifest(track.dir).collections;
  if (!descriptor) return null;
  const path = resolve(track.dir, descriptor.path);
  if (!path.startsWith(`${resolve(track.dir)}/`)) {
    fail(`${track.name} collections asset escapes its data directory`);
  }
  if (!existsSync(path)) {
    fail(`${track.name} manifest references missing collections asset: ${descriptor.path}`);
  }
  const data = readFileSync(path);
  if (statSync(path).size !== descriptor.bytes) {
    fail(`${track.name} collections asset byte count mismatch`);
  }
  if (sha256(data) !== descriptor.sha256) {
    fail(`${track.name} collections asset sha256 mismatch`);
  }
  return summarizeCollections(JSON.parse(data.toString("utf8")));
}

export function evaluateCollectionsImpact(input: {
  mode: CollectionsPublishMode;
  tracks: Array<{ name: string; previous: CollectionSummary | null }>;
  proposed: CollectionSummary | null;
  override?: PublicationImpactOverride;
  metadata: { sourceCommit: string; policyDigest: string };
  generatedAt?: string;
}): CollectionsImpactReport {
  const override = input.override ?? parsePublicationImpactOverride({});
  const authorizedRemoval = input.mode === "remove";
  const tracks = input.tracks.map((track): CollectionsImpactTrack => {
    const delta = collectionDelta(track.previous, input.proposed);
    const blocked = !authorizedRemoval
      && !override.enabled
      && (
        delta.removedIds.length > 0
        || (
          delta.removedMembershipCount > 0
          && delta.removedMembershipPercent >= COLLECTION_MEMBERSHIP_REMOVAL_PERCENT
        )
      );
    return {
      name: track.name,
      previous: track.previous,
      proposed: input.proposed,
      ...delta,
      blocked,
    };
  });
  const errors = [...override.errors];
  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ...input.metadata,
    mode: input.mode,
    authorizedRemoval,
    authorizedRemovalReason: authorizedRemoval
      ? "explicit COLLECTIONS_PUBLISH removal mode"
      : null,
    override: { enabled: override.enabled, reason: override.reason },
    tracks,
    errors,
    blocked: errors.length > 0 || tracks.some((track) => track.blocked),
  };
}

function renderCollectionsImpact(report: CollectionsImpactReport): string {
  return `${[
    "# Collections Publication Impact",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Source commit: ${report.sourceCommit}`,
    `- Policy digest: ${report.policyDigest}`,
    `- Mode: ${report.mode}`,
    `- Decision: ${report.blocked ? "BLOCKED" : "PASS"}`,
    `- Authorized removal: ${report.authorizedRemovalReason ?? "no"}`,
    `- Override: ${report.override.enabled ? report.override.reason : "none"}`,
    ...report.errors.map((error) => `- BLOCK invalid-override: ${error}`),
    ...report.tracks.flatMap((track) => [
      `- ${track.name}: ${(track.previous?.ids.length ?? 0)} -> ${(track.proposed?.ids.length ?? 0)} collections`,
      `- ${track.name}: removed ${track.removedMembershipCount} memberships (${(track.removedMembershipPercent * 100).toFixed(1)}%)`,
      ...track.removedIds.map((id) => `- ${track.blocked ? "BLOCK" : "INFO"} ${track.name} removed collection: ${id}`),
    ]),
    "",
  ].join("\n")}\n`;
}

function writeCollectionsImpact(report: CollectionsImpactReport): void {
  mkdirSync(dirname(impactJsonPath), { recursive: true });
  writeFileSync(impactJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(impactMarkdownPath, renderCollectionsImpact(report));
}

function main() {
  const mode = collectionsPublishMode();
  const tracks = dataTrackDirs.map((dir) => ({
    name: dir.endsWith("/crawl4") ? "crawl4" : "v2",
    dir,
  }));
  const previous = tracks.map((track) => ({
    name: track.name,
    previous: loadPublishedCollections(track),
  }));

  if (mode === "remove") {
    const loadedPolicy = typedPolicySources(loadPolicySources());
    const generatedAt = new Date().toISOString();
    const report = evaluateCollectionsImpact({
      mode,
      tracks: previous,
      proposed: null,
      override: parsePublicationImpactOverride(),
      metadata: policyRunMetadata(loadedPolicy),
      generatedAt,
    });
    writeCollectionsImpact(report);
    if (report.blocked) fail("publication impact check blocked collections removal");
    for (const track of tracks) patchManifest(track.dir, null, generatedAt);
    console.log("removed collections manifest entries; asset files retained");
    return;
  }

  if (!existsSync(sourcePath)) fail(`missing ${sourcePath}`);
  if (!existsSync(creatorsPath)) fail(`missing ${creatorsPath}`);
  if (!existsSync(skillsPath)) fail(`missing ${skillsPath}`);

  const skills = readJson<Skill[]>(skillsPath);
  const loadedPolicy = loadPolicySources();
  const policy = typedPolicySources(loadedPolicy);
  const policyIssues = validatePolicy(loadedPolicy, {
    publishedSkillIds: new Set(skills.map((skill) => skill.id)),
    publishedAuthorHandles: new Set(skills.map((skill) => skill.author_handle)),
  });
  assertPolicyValid(policyIssues, "collections-publish");
  const source = policy.collections;
  const registry = policy.creators;
  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);
  const data = collectionsAssetBuffer(asset);
  const descriptor = collectionsAssetDescriptor(data);
  const report = evaluateCollectionsImpact({
    mode,
    tracks: previous,
    proposed: summarizeCollections(asset),
    override: parsePublicationImpactOverride(),
    metadata: policyRunMetadata(policy),
  });
  writeCollectionsImpact(report);
  if (report.blocked) fail("publication impact check blocked collections publish");

  for (const track of tracks) {
    const written = writeCollectionsAsset(track.dir, data, descriptor);
    patchManifest(track.dir, written, asset.generatedAt);
    console.log(`wrote ${join(track.dir, written.path)}`);
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

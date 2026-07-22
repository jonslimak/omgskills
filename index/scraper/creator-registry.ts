import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePolicyHandle } from "../../scripts/policy-identifiers.mjs";

export type CreatorRegistryRole = "vendor" | "creator";

export type CreatorRegistryEntry = {
  handle: string;
  roles?: CreatorRegistryRole[];
  watch?: boolean;
  featured?: boolean;
  aliases?: string[];
  notes?: string;
};

export type CreatorRegistrySource = {
  creators: CreatorRegistryEntry[];
};

export type CreatorRegistry = {
  entries: CreatorRegistryEntry[];
  vendorHandles: Set<string>;
  creatorHandles: Set<string>;
  watchedHandles: Set<string>;
  featuredHandles: Set<string>;
  aliasToCanonical: Map<string, string>;
};

const scraperRoot = dirname(fileURLToPath(import.meta.url));
export const creatorRegistryPath = join(scraperRoot, "..", "seeds", "creators.json");

let cachedRegistry: CreatorRegistry | null = null;

export function normalizeCreatorHandle(value: string): string {
  return normalizePolicyHandle(value);
}

export function buildCreatorRegistry(source: CreatorRegistrySource): CreatorRegistry {
  if (!Array.isArray(source?.creators)) {
    throw new Error("Invalid creators.json: creators must be an array.");
  }

  const vendorHandles = new Set<string>();
  const creatorHandles = new Set<string>();
  const watchedHandles = new Set<string>();
  const featuredHandles = new Set<string>();
  const ownerByHandle = new Map<string, string>();
  const canonicalHandles = new Set<string>();
  const entries: CreatorRegistryEntry[] = [];

  for (const entry of source.creators) {
    const canonical = normalizeCreatorHandle(entry.handle ?? "");
    if (!canonical) {
      throw new Error("Invalid creators.json: creator handle cannot be empty.");
    }
    const existingOwner = ownerByHandle.get(canonical);
    if (existingOwner && existingOwner !== canonical) {
      throw new Error(`Invalid creators.json: handle ${canonical} is already owned by ${existingOwner}.`);
    }
    if (canonicalHandles.has(canonical)) {
      throw new Error(`Invalid creators.json: duplicate creator handle ${canonical}.`);
    }
    canonicalHandles.add(canonical);
    ownerByHandle.set(canonical, canonical);
    entries.push(entry);

    const roles = new Set(entry.roles ?? []);
    for (const role of roles) {
      if (role !== "vendor" && role !== "creator") {
        throw new Error(`Invalid creators.json entry for ${canonical}: unknown role ${String(role)}.`);
      }
    }
    if (roles.has("vendor")) vendorHandles.add(canonical);
    if (roles.has("creator")) creatorHandles.add(canonical);
    if (entry.watch) watchedHandles.add(canonical);
    if (entry.featured) featuredHandles.add(canonical);

    if (entry.featured && !entry.watch) {
      throw new Error(`Invalid creators.json entry for ${canonical}: featured creators must be watched.`);
    }
  }

  for (const entry of entries) {
    const canonical = normalizeCreatorHandle(entry.handle);
    for (const rawAlias of entry.aliases ?? []) {
      const alias = normalizeCreatorHandle(rawAlias);
      if (!alias || alias === canonical) continue;
      const existingOwner = ownerByHandle.get(alias);
      if (existingOwner && existingOwner !== canonical) {
        throw new Error(`Invalid creators.json: handle or alias ${alias} maps to both ${existingOwner} and ${canonical}.`);
      }
      ownerByHandle.set(alias, canonical);
    }
  }

  const aliasToCanonical = new Map(
    [...ownerByHandle].filter(([handle, owner]) => handle !== owner),
  );

  return {
    entries,
    vendorHandles,
    creatorHandles,
    watchedHandles,
    featuredHandles,
    aliasToCanonical,
  };
}

export function loadCreatorRegistry(path = creatorRegistryPath): CreatorRegistry {
  if (path === creatorRegistryPath && cachedRegistry) return cachedRegistry;
  const source = JSON.parse(readFileSync(path, "utf8")) as CreatorRegistrySource;
  const registry = buildCreatorRegistry(source);
  if (path === creatorRegistryPath) cachedRegistry = registry;
  return registry;
}

export function resolveRegistryHandle(handle: string, registry = loadCreatorRegistry()): string {
  const normalized = normalizeCreatorHandle(handle);
  return registry.aliasToCanonical.get(normalized) ?? normalized;
}

export function isTrustedVendor(handle: string, registry = loadCreatorRegistry()): boolean {
  return registry.vendorHandles.has(resolveRegistryHandle(handle, registry));
}

export function vendorHandleVariants(registry = loadCreatorRegistry()): Set<string> {
  return new Set([
    ...registry.vendorHandles,
    ...[...registry.aliasToCanonical]
      .filter(([, canonical]) => registry.vendorHandles.has(canonical))
      .map(([alias]) => alias),
  ]);
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isValidPolicyRepo,
  normalizePolicyHandle,
  normalizePolicyRepo,
} from "../../scripts/policy-identifiers.mjs";

export type CreatorRegistryRole = "vendor" | "creator";
export type CreatorSkillCoverage = "all" | "selected";

export type CreatorRegistryEntry = {
  handle: string;
  roles?: CreatorRegistryRole[];
  watch?: boolean;
  featured?: boolean;
  aliases?: string[];
  skillCoverage?: CreatorSkillCoverage;
  skillRepos?: string[];
  skillPaths?: string[];
  skillPathExclusions?: string[];
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

export function hasApprovedCreatorCoverage(entry: CreatorRegistryEntry): boolean {
  return entry.watch === true && (
    entry.skillCoverage === "all"
    || (entry.skillCoverage === "selected" && Boolean(entry.skillRepos?.length))
  );
}

function parseSkillPath(value: string): { repo: string; path: string } {
  const separator = value.indexOf("#");
  const repo = value.slice(0, separator);
  const path = value.slice(separator + 1);
  if (separator <= 0 || value.indexOf("#", separator + 1) >= 0 || !isValidPolicyRepo(repo)
    || path.includes("\\") || /[\x00-\x1f?#]/.test(path) || path !== path.trim()
    || path.split("/").some(segment => !segment || segment === "." || segment === "..")
    || !(path === "SKILL.md" || path.endsWith("/SKILL.md"))) {
    throw new Error("skillPaths must use owner/repo#exact/path/SKILL.md.");
  }
  return { repo: normalizePolicyRepo(repo), path };
}

export function creatorSkillPathsForRepo(
  entry: CreatorRegistryEntry, repo: string, aliases: string[] = [],
): string[] | undefined {
  if (entry.skillPaths === undefined) return undefined;
  const repos = new Set([repo, ...aliases].map(normalizePolicyRepo));
  return entry.skillPaths.map(parseSkillPath).filter(rule => repos.has(rule.repo)).map(rule => rule.path);
}

export function isCreatorSkillPathApproved(
  entry: CreatorRegistryEntry, repo: string, path: string, aliases: string[] = [],
): boolean {
  if (!hasApprovedCreatorCoverage(entry)) return false;
  const repos = new Set([repo, ...aliases].map(normalizePolicyRepo));
  if (entry.skillCoverage === "selected" && !(entry.skillRepos ?? []).some(value => repos.has(normalizePolicyRepo(value)))) {
    return false;
  }
  const allowed = creatorSkillPathsForRepo(entry, repo, aliases);
  if (allowed !== undefined && !allowed.includes(path)) return false;
  return !(entry.skillPathExclusions ?? []).some(rule => {
    const separator = rule.indexOf("#");
    const prefix = rule.slice(separator + 1).replace(/^\.\//, "").replace(/^\/+|\/+$/g, "").toLowerCase();
    return repos.has(normalizePolicyRepo(rule.slice(0, separator)))
      && (path.toLowerCase() === prefix || path.toLowerCase().startsWith(`${prefix}/`));
  });
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

    const coverage = entry.skillCoverage;
    if (coverage !== undefined && coverage !== "all" && coverage !== "selected") {
      throw new Error(`Invalid creators.json entry for ${canonical}: skillCoverage must be all or selected.`);
    }
    if (coverage && !entry.watch) {
      throw new Error(`Invalid creators.json entry for ${canonical}: skill coverage requires watch=true.`);
    }
    if (entry.skillRepos !== undefined && !coverage) {
      throw new Error(`Invalid creators.json entry for ${canonical}: skillRepos requires skillCoverage.`);
    }
    if (entry.skillRepos !== undefined) {
      if (!Array.isArray(entry.skillRepos) || entry.skillRepos.length === 0) {
        throw new Error(`Invalid creators.json entry for ${canonical}: skillRepos must be a non-empty array.`);
      }
      const repos = new Set<string>();
      for (const rawRepo of entry.skillRepos) {
        if (typeof rawRepo !== "string" || !isValidPolicyRepo(rawRepo)) {
          throw new Error(`Invalid creators.json entry for ${canonical}: skillRepos must use owner/repo.`);
        }
        const repo = normalizePolicyRepo(rawRepo);
        if (repos.has(repo)) {
          throw new Error(`Invalid creators.json entry for ${canonical}: duplicate skill repo ${repo}.`);
        }
        repos.add(repo);
      }
    }
    if (coverage === "selected" && !entry.skillRepos?.length) {
      throw new Error(`Invalid creators.json entry for ${canonical}: selected coverage requires skillRepos.`);
    }
    if (entry.skillPaths !== undefined) {
      if (coverage !== "selected" || !Array.isArray(entry.skillPaths) || !entry.skillPaths.length) {
        throw new Error(`Invalid creators.json entry for ${canonical}: skillPaths requires selected coverage and a non-empty array.`);
      }
      const repos = new Set((entry.skillRepos ?? []).map(normalizePolicyRepo));
      const paths = new Set<string>();
      for (const value of entry.skillPaths) {
        if (typeof value !== "string") throw new Error(`Invalid skillPaths entry for ${canonical}.`);
        const rule = parseSkillPath(value);
        if (!repos.has(rule.repo)) throw new Error(`Invalid skillPaths entry for ${canonical}: ${rule.repo} is not in skillRepos.`);
        const key = `${rule.repo}#${rule.path}`;
        if (paths.has(key)) throw new Error(`Duplicate skillPaths entry for ${canonical}: ${key}.`);
        paths.add(key);
      }
    }
    if (entry.skillPathExclusions !== undefined) {
      if (!coverage) {
        throw new Error(`Invalid creators.json entry for ${canonical}: skillPathExclusions requires skillCoverage.`);
      }
      if (!Array.isArray(entry.skillPathExclusions) || entry.skillPathExclusions.length === 0) {
        throw new Error(`Invalid creators.json entry for ${canonical}: skillPathExclusions must be a non-empty array.`);
      }
      const coveredRepos = new Set((entry.skillRepos ?? []).map(normalizePolicyRepo));
      const exclusions = new Set<string>();
      for (const rawExclusion of entry.skillPathExclusions) {
        if (typeof rawExclusion !== "string") {
          throw new Error(`Invalid creators.json entry for ${canonical}: skillPathExclusions must use owner/repo#path-prefix/.`);
        }
        const separator = rawExclusion.indexOf("#");
        const rawRepo = rawExclusion.slice(0, separator);
        const rawPrefix = rawExclusion.slice(separator + 1);
        if (separator <= 0 || rawExclusion.indexOf("#", separator + 1) >= 0 || !isValidPolicyRepo(rawRepo)) {
          throw new Error(`Invalid creators.json entry for ${canonical}: skillPathExclusions must use owner/repo#path-prefix/.`);
        }
        const repo = normalizePolicyRepo(rawRepo);
        const prefix = rawPrefix.trim().replace(/^\.\//, "").replace(/^\/+|\/+$/g, "").toLowerCase();
        if (!prefix || prefix.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
          throw new Error(`Invalid creators.json entry for ${canonical}: skillPathExclusions must use owner/repo#path-prefix/.`);
        }
        if (coverage === "selected" && !coveredRepos.has(repo)) {
          throw new Error(`Invalid creators.json entry for ${canonical}: excluded path repo ${repo} is not in skillRepos.`);
        }
        const normalized = `${repo}#${prefix}`;
        if (exclusions.has(normalized)) {
          throw new Error(`Invalid creators.json entry for ${canonical}: duplicate skill path exclusion ${normalized}.`);
        }
        exclusions.add(normalized);
      }
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

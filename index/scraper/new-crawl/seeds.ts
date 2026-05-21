import { readFileSync } from "node:fs";
import { join } from "node:path";
import { indexRoot } from "./shadow-path-guard.js";
import type { RepoOverride, TrustedSeeds } from "./types.js";

type HandleList = { handles: string[] };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRepo(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

export function loadTrustedSeeds(): TrustedSeeds {
  const seedsRoot = join(indexRoot, "seeds");
  const vendorJson = readJson<HandleList>(join(seedsRoot, "trusted-vendors.json"));
  const creatorJson = readJson<HandleList>(join(seedsRoot, "trusted-creators.json"));
  const overridesJson = readJson<RepoOverride[]>(join(seedsRoot, "repo-overrides.json"));

  return {
    trustedVendorHandles: new Set(vendorJson.handles.map(normalizeHandle).filter(Boolean)),
    trustedCreatorHandles: new Set(creatorJson.handles.map(normalizeHandle).filter(Boolean)),
    repoOverrides: overridesJson
      .map((override) => ({
        ...override,
        repo: normalizeRepo(override.repo),
      }))
      .filter((override) => override.repo),
  };
}

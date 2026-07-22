import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LoadedPolicySources,
  PolicyRawSources,
  PolicySourceKey,
  PolicySourcePaths,
  PolicySources,
} from "./types.js";

const policyDir = dirname(fileURLToPath(import.meta.url));
export const policyIndexRoot = join(policyDir, "..", "..");

export function defaultPolicySourcePaths(indexRoot = policyIndexRoot): PolicySourcePaths {
  const seeds = join(indexRoot, "seeds");
  return {
    creators: join(seeds, "creators.json"),
    collections: join(indexRoot, "curations", "collections.json"),
    officialRepos: join(seeds, "official-repos.json"),
    manualIncludeRepos: join(seeds, "manual-include-repos.json"),
    doNotCrawl: join(seeds, "do-not-crawl.json"),
    suppressedSkills: join(seeds, "suppressed-skills.json"),
    repoOverrides: join(seeds, "repo-overrides.json"),
    catalogRepos: join(seeds, "catalog-repos.json"),
    provenanceOverrides: join(seeds, "provenance-overrides.json"),
    skillEquivalenceOverrides: join(seeds, "skill-equivalence-overrides.json"),
  };
}

export function loadPolicySources(paths = defaultPolicySourcePaths()): LoadedPolicySources {
  const raw = {} as PolicyRawSources;
  for (const key of Object.keys(paths) as PolicySourceKey[]) {
    raw[key] = JSON.parse(readFileSync(paths[key], "utf8")) as unknown;
  }
  return { raw, paths };
}

export function typedPolicySources(loaded: LoadedPolicySources): PolicySources {
  return loaded.raw as PolicySources;
}

export function replacePolicySource<K extends PolicySourceKey>(
  loaded: LoadedPolicySources,
  key: K,
  value: PolicySources[K],
): LoadedPolicySources {
  return { ...loaded, raw: { ...loaded.raw, [key]: value } };
}

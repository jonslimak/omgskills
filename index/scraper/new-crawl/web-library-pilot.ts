import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  ShadowSkillRecord,
  ShadowStaleInvalidCandidate,
  WebLibraryPilotSnippetCoverage,
  WebLibraryPilotSnippetCoverageEntry,
} from "./types.js";

type WebLibraryCollection = {
  type?: string;
  authorHandle?: string;
  featuredSkillIds?: string[];
  skillIds?: string[];
};

type WebLibraryCollectionsFile = {
  collections?: WebLibraryCollection[];
};

type WebLibraryManifest = {
  skills?: {
    path?: unknown;
    bytes?: unknown;
  };
  collections?: {
    path?: unknown;
  };
};

type WebLibraryTrendingEntry = {
  id?: unknown;
};

type WebLibraryPilotAssets = {
  collections: WebLibraryCollection[];
  trendingSkillIds: string[];
};

const DEFAULT_AUTHOR_SKILL_LIMIT = 3;
const DEFAULT_TRENDING_SKILL_LIMIT = 25;

type WebLibraryPilotOptions = {
  maxAuthorSkills?: number;
  maxTrendingSkills?: number;
  trendingSkillIds?: string[];
};

type WebLibraryPilotCoverageInput = {
  skillIds: string[];
  skills: ShadowSkillRecord[];
  refreshMode: "scheduled" | "notScheduled" | "skipped";
  fetchFailures?: ReadonlyMap<string, ShadowStaleInvalidCandidate["reason"]>;
  refreshedEarlierSkillIds?: ReadonlySet<string>;
  successfulSnippetRefreshSkillIds?: ReadonlySet<string>;
};

function authorSkillLimit(): number {
  const parsed = Number.parseInt(process.env.WEB_LIBRARY_AUTHOR_SKILL_LIMIT || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTHOR_SKILL_LIMIT;
}

function sortAuthorSkills(a: ShadowSkillRecord, b: ShadowSkillRecord): number {
  return (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name);
}

export function buildWebLibraryPilotSkillIds(
  collections: WebLibraryCollection[],
  skills: ShadowSkillRecord[],
  options: WebLibraryPilotOptions = {},
): string[] {
  const maxAuthorSkills = options.maxAuthorSkills ?? authorSkillLimit();
  const maxTrendingSkills = options.maxTrendingSkills ?? DEFAULT_TRENDING_SKILL_LIMIT;
  const skillsByAuthor = new Map<string, ShadowSkillRecord[]>();
  for (const skill of skills) {
    const handle = String(skill.author_handle || "").toLowerCase();
    if (!handle) continue;
    const list = skillsByAuthor.get(handle) || [];
    list.push(skill);
    skillsByAuthor.set(handle, list);
  }
  for (const list of skillsByAuthor.values()) {
    list.sort(sortAuthorSkills);
  }

  const ids = new Set<string>();
  for (const collection of collections) {
    for (const id of collection.featuredSkillIds || []) ids.add(id);
    for (const id of collection.skillIds || []) ids.add(id);
    if (collection.type === "author" && collection.authorHandle) {
      const handle = collection.authorHandle.toLowerCase();
      for (const skill of (skillsByAuthor.get(handle) || []).slice(0, maxAuthorSkills)) {
        ids.add(skill.id);
      }
    }
  }
  for (const id of (options.trendingSkillIds || []).slice(0, maxTrendingSkills)) {
    if (id) ids.add(id);
  }
  return [...ids];
}

export function loadWebLibraryPilotAssets(
  manifestPaths: string[],
  trendingPath: string,
  maxTrendingSkills = DEFAULT_TRENDING_SKILL_LIMIT,
): WebLibraryPilotAssets {
  if (!existsSync(trendingPath)) {
    throw new Error(`Missing web-library trending data: ${trendingPath}`);
  }
  const trendingAsset = JSON.parse(readFileSync(trendingPath, "utf8")) as WebLibraryTrendingEntry[];
  if (!Array.isArray(trendingAsset)) {
    throw new Error(`Web-library trending data must be an array: ${trendingPath}`);
  }
  const trendingSkillIds = trendingAsset
    .slice(0, maxTrendingSkills)
    .map((entry) => entry?.id)
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()));

  let lastError: unknown = null;
  for (const manifestPath of manifestPaths) {
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as WebLibraryManifest;
      const resolveAssetPath = (asset: { path?: unknown } | undefined, label: string): string => {
        if (typeof asset?.path !== "string" || !asset.path.trim()) {
          throw new Error(`Web-library manifest has an invalid ${label} path: ${manifestPath}`);
        }
        return join(dirname(manifestPath), asset.path);
      };
      const skillsPath = resolveAssetPath(manifest.skills, "skills");
      if (!existsSync(skillsPath)) {
        throw new Error(`Web-library skills asset is missing: ${skillsPath}`);
      }
      if (
        typeof manifest.skills?.bytes === "number" &&
        statSync(skillsPath).size !== manifest.skills.bytes
      ) {
        throw new Error(`Web-library skills asset has the wrong size: ${skillsPath}`);
      }
      const readAsset = (asset: { path?: unknown } | undefined, label: string): unknown => {
        if (asset == null) return null;
        return JSON.parse(readFileSync(resolveAssetPath(asset, label), "utf8"));
      };
      const collectionsAsset = readAsset(
        manifest.collections,
        "collections",
      ) as WebLibraryCollectionsFile | null;
      if (manifest.collections != null && (!collectionsAsset || !Array.isArray(collectionsAsset.collections))) {
        throw new Error(`Web-library collections asset has an invalid shape: ${manifestPath}`);
      }
      return {
        collections: collectionsAsset?.collections ?? [],
        trendingSkillIds,
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error(`Missing web-library manifest: ${manifestPaths.join(", ")}`);
}

export function buildWebLibraryPilotSnippetCoverage(
  input: WebLibraryPilotCoverageInput,
): WebLibraryPilotSnippetCoverage {
  const skillById = new Map(input.skills.map((skill) => [skill.id, skill] as const));
  const fetchFailures = input.fetchFailures ?? new Map();
  const refreshedEarlierSkillIds = input.refreshedEarlierSkillIds ?? new Set();
  const successfulSnippetRefreshSkillIds = input.successfulSnippetRefreshSkillIds ?? new Set();
  const entries: WebLibraryPilotSnippetCoverageEntry[] = input.skillIds.map((skillId) => {
    const skill = skillById.get(skillId);
    if (!skill) {
      return {
        skillId,
        status: "intentionalExemption",
        reason: "missingFromCatalog",
      };
    }
    if (skill.readme_snippet) {
      return { skillId, status: "snippetPresent" };
    }

    const fetchFailure = fetchFailures.get(skillId);
    if (fetchFailure) {
      return {
        skillId,
        status: "fetchFailure",
        reason: fetchFailure,
      };
    }
    if (successfulSnippetRefreshSkillIds.has(skillId)) {
      return {
        skillId,
        status: "intentionalExemption",
        reason: "noUsableReadme",
      };
    }
    if (refreshedEarlierSkillIds.has(skillId)) {
      return {
        skillId,
        status: "intentionalExemption",
        reason: "alreadyRefreshedThisRun",
      };
    }
    if (input.refreshMode === "skipped") {
      return {
        skillId,
        status: "intentionalExemption",
        reason: "refreshWorkSkipped",
      };
    }
    if (input.refreshMode === "notScheduled") {
      return {
        skillId,
        status: "intentionalExemption",
        reason: "refreshNotScheduled",
      };
    }
    throw new Error(`Scheduled web-library pilot skill has no refresh outcome: ${skillId}`);
  });

  return {
    selectedSkillCount: entries.length,
    snippetPresentCount: entries.filter((entry) => entry.status === "snippetPresent").length,
    fetchFailureCount: entries.filter((entry) => entry.status === "fetchFailure").length,
    intentionalExemptionCount: entries.filter((entry) => entry.status === "intentionalExemption").length,
    entries,
  };
}

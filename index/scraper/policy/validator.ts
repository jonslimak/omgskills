import {
  isValidPolicyHandle,
  isValidPolicyRepo,
  isValidPolicySkillId,
  normalizePolicyHandle,
  normalizePolicyRepo,
  normalizePolicySkillId,
} from "../../../scripts/policy-identifiers.mjs";
import { buildCreatorRegistry } from "../creator-registry.js";
import { parseSkillEquivalenceOverrides } from "../new-crawl/skill-equivalence.js";
import { parseCollectionImageUrl } from "../../scripts/collection-images.js";
import { typedPolicySources } from "./loader.js";
import {
  DO_NOT_CRAWL_REASONS,
  type LoadedPolicySources,
  type PolicyCatalogContext,
  type PolicyIssue,
  type PolicyIssueScope,
  type PolicyIssueSeverity,
  type PolicyReasonCode,
  type PolicySourceKey,
  type PolicySources,
  type PolicyValidationProfile,
} from "./types.js";

const REPO_STATES = new Set(["library", "rising", "core"]);
const PROVENANCE_TYPES = new Set(["original", "catalog", "repackaged", "mirrored", "unknown"]);
const AUTHOR_CONFIDENCE = new Set(["high", "low"]);
const SUPPRESSION_CONFIDENCE = new Set(["high", "medium", "low"]);
const DO_NOT_CRAWL_REASON_SET = new Set<string>(DO_NOT_CRAWL_REASONS);
const COLLECTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

type MutableIssueInput = {
  code: string;
  severity?: PolicyIssueSeverity;
  scope?: PolicyIssueScope;
  source: PolicySourceKey;
  location: string;
  key?: string;
  message: string;
  reasonCode?: PolicyReasonCode;
};

function issue(loaded: LoadedPolicySources, input: MutableIssueInput): PolicyIssue {
  return {
    code: input.code,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    severity: input.severity ?? "error",
    scope: input.scope ?? "core",
    source: input.source,
    path: `${loaded.paths[input.source]}#${input.location}`,
    ...(input.key ? { key: input.key } : {}),
    message: input.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  value: unknown,
  issues: PolicyIssue[],
): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  issues.push(issue(loaded, {
    code: "invalid-source-shape",
    source,
    location: "/",
    message: `${source} must be a JSON object.`,
  }));
  return false;
}

function requireArray(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  value: unknown,
  location: string,
  issues: PolicyIssue[],
): value is unknown[] {
  if (Array.isArray(value)) return true;
  issues.push(issue(loaded, {
    code: "invalid-array",
    source,
    location,
    message: `${source}${location} must be an array.`,
  }));
  return false;
}

function validateRepoValue(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  value: unknown,
  location: string,
  issues: PolicyIssue[],
): string | null {
  if (typeof value !== "string" || !isValidPolicyRepo(value)) {
    issues.push(issue(loaded, {
      code: "invalid-repo",
      source,
      location,
      message: `${source}${location} must be owner/repo.`,
    }));
    return null;
  }
  return normalizePolicyRepo(value);
}

function validateHandleValue(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  value: unknown,
  location: string,
  issues: PolicyIssue[],
): string | null {
  if (typeof value !== "string" || !isValidPolicyHandle(value)) {
    issues.push(issue(loaded, {
      code: "invalid-handle",
      source,
      location,
      message: `${source}${location} must be a bare creator handle.`,
    }));
    return null;
  }
  return normalizePolicyHandle(value);
}

function validateSkillIdValue(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  value: unknown,
  location: string,
  issues: PolicyIssue[],
): string | null {
  if (typeof value !== "string" || !isValidPolicySkillId(value)) {
    issues.push(issue(loaded, {
      code: "invalid-skill-id",
      source,
      location,
      message: `${source}${location} must be owner/repo or owner/repo:skill-path.`,
    }));
    return null;
  }
  return normalizePolicySkillId(value);
}

function isValidXProfileUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:"
      && (hostname === "x.com" || hostname === "twitter.com")
      && pathParts.length === 1
      && X_HANDLE_PATTERN.test(pathParts[0])
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function addDuplicate(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  location: string,
  key: string,
  issues: PolicyIssue[],
): void {
  issues.push(issue(loaded, {
    code: "duplicate-normalized-key",
    source,
    location,
    key,
    message: `${source} contains duplicate normalized key ${key}.`,
  }));
}

function validateRepoArray(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  values: unknown,
  location: string,
  issues: PolicyIssue[],
  seen = new Set<string>(),
): Set<string> {
  if (!requireArray(loaded, source, values, location, issues)) return seen;
  values.forEach((value, index) => {
    const repo = validateRepoValue(loaded, source, value, `${location}/${index}`, issues);
    if (!repo) return;
    if (seen.has(repo)) addDuplicate(loaded, source, `${location}/${index}`, repo, issues);
    seen.add(repo);
  });
  return seen;
}

function validateSkillIdArray(
  loaded: LoadedPolicySources,
  source: PolicySourceKey,
  values: unknown,
  location: string,
  issues: PolicyIssue[],
): void {
  if (!requireArray(loaded, source, values, location, issues)) return;
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const id = validateSkillIdValue(loaded, source, value, `${location}/${index}`, issues);
    if (!id) return;
    if (seen.has(id)) addDuplicate(loaded, source, `${location}/${index}`, id, issues);
    seen.add(id);
  });
}

function validateCreators(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.creators;
  if (!requireRecord(loaded, "creators", value, issues)) return;
  if (!requireArray(loaded, "creators", value.creators, "/creators", issues)) return;
  value.creators.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-creator-entry",
        source: "creators",
        location: `/creators/${index}`,
        message: "Creator entries must be objects.",
      }));
      return;
    }
    validateHandleValue(loaded, "creators", entry.handle, `/creators/${index}/handle`, issues);
    if (entry.aliases !== undefined) {
      if (requireArray(loaded, "creators", entry.aliases, `/creators/${index}/aliases`, issues)) {
        entry.aliases.forEach((alias, aliasIndex) => {
          validateHandleValue(loaded, "creators", alias, `/creators/${index}/aliases/${aliasIndex}`, issues);
        });
      }
    }
    if (entry.roles !== undefined && !Array.isArray(entry.roles)) {
      issues.push(issue(loaded, {
        code: "invalid-creator-roles",
        source: "creators",
        location: `/creators/${index}/roles`,
        message: "Creator roles must be an array.",
      }));
    }
    if (
      entry.skillCoverage !== undefined
      && entry.skillCoverage !== "all"
      && entry.skillCoverage !== "selected"
    ) {
      issues.push(issue(loaded, {
        code: "invalid-creator-skill-coverage",
        source: "creators",
        location: `/creators/${index}/skillCoverage`,
        message: "Creator skillCoverage must be all or selected.",
      }));
    }
    if (entry.skillRepos !== undefined) {
      if (requireArray(loaded, "creators", entry.skillRepos, `/creators/${index}/skillRepos`, issues)) {
        const seen = new Set<string>();
        entry.skillRepos.forEach((repo, repoIndex) => {
          const normalized = validateRepoValue(
            loaded,
            "creators",
            repo,
            `/creators/${index}/skillRepos/${repoIndex}`,
            issues,
          );
          if (!normalized) return;
          if (seen.has(normalized)) {
            addDuplicate(
              loaded,
              "creators",
              `/creators/${index}/skillRepos/${repoIndex}`,
              normalized,
              issues,
            );
          }
          seen.add(normalized);
        });
      }
    }
    if (entry.skillPathExclusions !== undefined && !Array.isArray(entry.skillPathExclusions)) {
      issues.push(issue(loaded, {
        code: "invalid-creator-skill-path-exclusions",
        source: "creators",
        location: `/creators/${index}/skillPathExclusions`,
        message: "Creator skillPathExclusions must be an array.",
      }));
    }
  });
  try {
    buildCreatorRegistry(value as PolicySources["creators"]);
  } catch (error) {
    issues.push(issue(loaded, {
      code: "invalid-creator-registry",
      source: "creators",
      location: "/creators",
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

function validateCollections(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.collections;
  if (!requireRecord(loaded, "collections", value, issues)) return;
  if (value.authorOverrides !== undefined) {
    if (!isRecord(value.authorOverrides)) {
      issues.push(issue(loaded, {
        code: "invalid-author-overrides",
        source: "collections",
        location: "/authorOverrides",
        scope: "editorial",
        message: "authorOverrides must be an object.",
      }));
    } else {
      for (const [handle, override] of Object.entries(value.authorOverrides)) {
        validateHandleValue(loaded, "collections", handle, `/authorOverrides/${handle}`, issues);
        if (!isRecord(override)) {
          issues.push(issue(loaded, {
            code: "invalid-author-override",
            source: "collections",
            location: `/authorOverrides/${handle}`,
            scope: "editorial",
            message: `Author override ${handle} must be an object.`,
          }));
          continue;
        }
        if (override.featuredSkillIds !== undefined) {
          validateSkillIdArray(
            loaded,
            "collections",
            override.featuredSkillIds,
            `/authorOverrides/${handle}/featuredSkillIds`,
            issues,
          );
        }
        if (override.xUrl !== undefined && override.xUrl !== null && !isValidXProfileUrl(override.xUrl)) {
          issues.push(issue(loaded, {
            code: "invalid-x-profile-url",
            source: "collections",
            location: `/authorOverrides/${handle}/xUrl`,
            scope: "editorial",
            message: `Author override ${handle} xUrl must be an https://x.com/{handle} or https://twitter.com/{handle} profile URL.`,
          }));
        }
      }
    }
  }
  if (!requireArray(loaded, "collections", value.collections, "/collections", issues)) return;
  const collectionIds = new Set<string>();
  value.collections.forEach((entry, index) => {
    const location = `/collections/${index}`;
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-collection-entry",
        source: "collections",
        location,
        scope: "editorial",
        message: "Collection entries must be objects.",
      }));
      return;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!COLLECTION_ID_PATTERN.test(id)) {
      issues.push(issue(loaded, {
        code: "invalid-collection-id",
        source: "collections",
        location: `${location}/id`,
        scope: "editorial",
        message: `Collection id must be kebab-case: ${String(entry.id ?? "")}.`,
      }));
    } else if (collectionIds.has(id)) {
      addDuplicate(loaded, "collections", `${location}/id`, id, issues);
    }
    collectionIds.add(id);
    if (entry.type !== "topic") {
      issues.push(issue(loaded, {
        code: "invalid-collection-type",
        source: "collections",
        location: `${location}/type`,
        scope: "editorial",
        message: `Collection ${id || index} must have type topic.`,
      }));
    }
    for (const field of ["title", "subtitle"] as const) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        issues.push(issue(loaded, {
          code: "missing-collection-copy",
          source: "collections",
          location: `${location}/${field}`,
          scope: "editorial",
          message: `Collection ${id || index} requires ${field}.`,
        }));
      }
    }
    if (entry.imageUrl !== undefined && entry.imageUrl !== null) {
      if (typeof entry.imageUrl !== "string" || !parseCollectionImageUrl(entry.imageUrl, id)) {
        issues.push(issue(loaded, {
          code: "invalid-collection-image-url",
          source: "collections",
          location: `${location}/imageUrl`,
          scope: "editorial",
          message: `Collection ${id || index} imageUrl must reference its versioned omgskills WebP image.`,
        }));
      }
    }
    validateSkillIdArray(loaded, "collections", entry.featuredSkillIds, `${location}/featuredSkillIds`, issues);
    validateSkillIdArray(loaded, "collections", entry.skillIds, `${location}/skillIds`, issues);
  });
}

function validateOfficialAndManual(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const official = loaded.raw.officialRepos;
  if (requireRecord(loaded, "officialRepos", official, issues)) {
    const seen = validateRepoArray(loaded, "officialRepos", official.tier1, "/tier1", issues);
    validateRepoArray(loaded, "officialRepos", official.tier2, "/tier2", issues, seen);
  }
  const manual = loaded.raw.manualIncludeRepos;
  if (requireRecord(loaded, "manualIncludeRepos", manual, issues)) {
    validateRepoArray(loaded, "manualIncludeRepos", manual.include, "/include", issues);
  }
}

function validateDoNotCrawl(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.doNotCrawl;
  if (!requireRecord(loaded, "doNotCrawl", value, issues)) return;
  const repoKeys = new Set<string>();
  const ownerKeys = new Set<string>();
  for (const [field, expected] of [["repos", "repo"], ["owners", "owner"]] as const) {
    const entries = value[field];
    if (!requireArray(loaded, "doNotCrawl", entries, `/${field}`, issues)) continue;
    entries.forEach((entry, index) => {
      const location = `/${field}/${index}`;
      if (!isRecord(entry)) {
        issues.push(issue(loaded, {
          code: "invalid-do-not-crawl-entry",
          source: "doNotCrawl",
          location,
          message: `doNotCrawl.${field} entries must be objects.`,
        }));
        return;
      }
      const key = expected === "repo"
        ? validateRepoValue(loaded, "doNotCrawl", entry.repo, `${location}/repo`, issues)
        : validateHandleValue(loaded, "doNotCrawl", entry.owner, `${location}/owner`, issues);
      const seen = expected === "repo" ? repoKeys : ownerKeys;
      if (key && seen.has(key)) addDuplicate(loaded, "doNotCrawl", location, key, issues);
      if (key) seen.add(key);
      if (typeof entry.reason !== "string" || !DO_NOT_CRAWL_REASON_SET.has(entry.reason)) {
        issues.push(issue(loaded, {
          code: "invalid-do-not-crawl-reason",
          source: "doNotCrawl",
          location: `${location}/reason`,
          message: `Unsupported do-not-crawl reason: ${String(entry.reason ?? "")}.`,
        }));
      }
    });
  }
}

function validateRootSkillInvalid(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.rootSkillInvalid;
  if (!requireRecord(loaded, "rootSkillInvalid", value, issues)) return;
  if (!requireArray(loaded, "rootSkillInvalid", value.repos, "/repos", issues)) return;
  const seen = new Set<string>();
  value.repos.forEach((entry, index) => {
    const location = `/repos/${index}`;
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-root-skill-entry",
        source: "rootSkillInvalid",
        location,
        message: "Root-skill-invalid entries must be objects.",
      }));
      return;
    }
    const repo = validateRepoValue(loaded, "rootSkillInvalid", entry.repo, `${location}/repo`, issues);
    if (repo && seen.has(repo)) addDuplicate(loaded, "rootSkillInvalid", location, repo, issues);
    if (repo) seen.add(repo);
    if (entry.reason !== "root-skill-invalid") {
      issues.push(issue(loaded, {
        code: "invalid-root-skill-reason",
        source: "rootSkillInvalid",
        location: `${location}/reason`,
        reasonCode: "root-skill-invalid",
        message: "Root-skill-invalid entries require reason root-skill-invalid.",
      }));
    }
  });
}

function validateSuppressedSkills(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.suppressedSkills;
  if (!requireRecord(loaded, "suppressedSkills", value, issues)) return;
  if (!requireArray(loaded, "suppressedSkills", value.skills, "/skills", issues)) return;
  const seen = new Set<string>();
  value.skills.forEach((entry, index) => {
    const location = `/skills/${index}`;
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-suppression-entry",
        source: "suppressedSkills",
        location,
        message: "Suppression entries must be objects.",
      }));
      return;
    }
    const id = validateSkillIdValue(loaded, "suppressedSkills", entry.id, `${location}/id`, issues);
    if (id && seen.has(id)) addDuplicate(loaded, "suppressedSkills", location, id, issues);
    if (id) seen.add(id);
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      issues.push(issue(loaded, {
        code: "missing-suppression-reason",
        source: "suppressedSkills",
        location: `${location}/reason`,
        message: `Suppressed skill ${String(entry.id ?? index)} requires a reason.`,
      }));
    }
    if (entry.replacementId !== undefined) {
      validateSkillIdValue(loaded, "suppressedSkills", entry.replacementId, `${location}/replacementId`, issues);
    }
    if (entry.confidence !== undefined && !SUPPRESSION_CONFIDENCE.has(String(entry.confidence))) {
      issues.push(issue(loaded, {
        code: "invalid-suppression-confidence",
        source: "suppressedSkills",
        location: `${location}/confidence`,
        message: `Unsupported suppression confidence: ${String(entry.confidence)}.`,
      }));
    }
  });
}

function validateRepoOverrides(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.repoOverrides;
  if (!requireArray(loaded, "repoOverrides", value, "/", issues)) return;
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-repo-override-entry",
        source: "repoOverrides",
        location: `/${index}`,
        message: "Repo override entries must be objects.",
      }));
      return;
    }
    const repo = validateRepoValue(loaded, "repoOverrides", entry.repo, `/${index}/repo`, issues);
    if (repo && seen.has(repo)) addDuplicate(loaded, "repoOverrides", `/${index}`, repo, issues);
    if (repo) seen.add(repo);
    if (entry.state !== undefined && !REPO_STATES.has(String(entry.state))) {
      issues.push(issue(loaded, {
        code: "invalid-repo-state",
        source: "repoOverrides",
        location: `/${index}/state`,
        message: `Unsupported repo state: ${String(entry.state)}.`,
      }));
    }
    if (entry.exclude !== undefined && typeof entry.exclude !== "boolean") {
      issues.push(issue(loaded, {
        code: "invalid-repo-exclude",
        source: "repoOverrides",
        location: `/${index}/exclude`,
        message: "Repo override exclude must be boolean.",
      }));
    }
  });
}

function validateCatalogRepos(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.catalogRepos;
  if (!requireArray(loaded, "catalogRepos", value, "/", issues)) return;
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-catalog-repo-entry",
        source: "catalogRepos",
        location: `/${index}`,
        message: "Catalog repo entries must be objects.",
      }));
      return;
    }
    const repo = validateRepoValue(loaded, "catalogRepos", entry.repo, `/${index}/repo`, issues);
    if (repo && seen.has(repo)) addDuplicate(loaded, "catalogRepos", `/${index}`, repo, issues);
    if (repo) seen.add(repo);
    if (entry.publisherHandle !== undefined) {
      validateHandleValue(loaded, "catalogRepos", entry.publisherHandle, `/${index}/publisherHandle`, issues);
    }
    if (entry.defaultProvenanceType !== undefined && !PROVENANCE_TYPES.has(String(entry.defaultProvenanceType))) {
      issues.push(issue(loaded, {
        code: "invalid-provenance-type",
        source: "catalogRepos",
        location: `/${index}/defaultProvenanceType`,
        message: `Unsupported provenance type: ${String(entry.defaultProvenanceType)}.`,
      }));
    }
  });
}

function validateProvenanceOverrides(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  const value = loaded.raw.provenanceOverrides;
  if (!requireArray(loaded, "provenanceOverrides", value, "/", issues)) return;
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const location = `/${index}`;
    if (!isRecord(entry)) {
      issues.push(issue(loaded, {
        code: "invalid-provenance-override-entry",
        source: "provenanceOverrides",
        location,
        message: "Provenance override entries must be objects.",
      }));
      return;
    }
    const id = entry.id === undefined
      ? null
      : validateSkillIdValue(loaded, "provenanceOverrides", entry.id, `${location}/id`, issues);
    const repo = entry.repo === undefined
      ? null
      : validateRepoValue(loaded, "provenanceOverrides", entry.repo, `${location}/repo`, issues);
    if (!id && !repo) {
      issues.push(issue(loaded, {
        code: "missing-provenance-target",
        source: "provenanceOverrides",
        location,
        message: "Provenance override requires id or repo.",
      }));
    }
    const key = id ? `id:${id}` : repo ? `repo:${repo}` : "";
    if (key && seen.has(key)) addDuplicate(loaded, "provenanceOverrides", location, key, issues);
    if (key) seen.add(key);
    for (const field of ["authorHandle", "publisherHandle"] as const) {
      if (entry[field] !== undefined && entry[field] !== "") {
        validateHandleValue(loaded, "provenanceOverrides", entry[field], `${location}/${field}`, issues);
      }
    }
    if (entry.upstreamRepo !== undefined) {
      validateRepoValue(loaded, "provenanceOverrides", entry.upstreamRepo, `${location}/upstreamRepo`, issues);
    }
    if (entry.provenanceType !== undefined && !PROVENANCE_TYPES.has(String(entry.provenanceType))) {
      issues.push(issue(loaded, {
        code: "invalid-provenance-type",
        source: "provenanceOverrides",
        location: `${location}/provenanceType`,
        message: `Unsupported provenance type: ${String(entry.provenanceType)}.`,
      }));
    }
    if (entry.authorConfidence !== undefined && !AUTHOR_CONFIDENCE.has(String(entry.authorConfidence))) {
      issues.push(issue(loaded, {
        code: "invalid-author-confidence",
        source: "provenanceOverrides",
        location: `${location}/authorConfidence`,
        message: `Unsupported author confidence: ${String(entry.authorConfidence)}.`,
      }));
    }
  });
}

function validateEquivalenceOverrides(loaded: LoadedPolicySources, issues: PolicyIssue[]): void {
  try {
    parseSkillEquivalenceOverrides(loaded.raw.skillEquivalenceOverrides);
  } catch (error) {
    issues.push(issue(loaded, {
      code: "invalid-equivalence-overrides",
      source: "skillEquivalenceOverrides",
      location: "/",
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function validatePolicyStructure(loaded: LoadedPolicySources): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  validateCreators(loaded, issues);
  validateCollections(loaded, issues);
  validateOfficialAndManual(loaded, issues);
  validateDoNotCrawl(loaded, issues);
  validateRootSkillInvalid(loaded, issues);
  validateSuppressedSkills(loaded, issues);
  validateRepoOverrides(loaded, issues);
  validateCatalogRepos(loaded, issues);
  validateProvenanceOverrides(loaded, issues);
  validateEquivalenceOverrides(loaded, issues);
  return issues;
}

function blockedRepoPredicate(sources: PolicySources): (repo: string) => boolean {
  const repos = new Set(sources.doNotCrawl.repos.map((entry) => normalizePolicyRepo(entry.repo)));
  const owners = new Set(sources.doNotCrawl.owners.map((entry) => normalizePolicyHandle(entry.owner)));
  return (repo) => {
    const normalized = normalizePolicyRepo(repo);
    return repos.has(normalized) || owners.has(normalized.split("/")[0] ?? "");
  };
}

export function validatePolicyConflicts(loaded: LoadedPolicySources): PolicyIssue[] {
  const sources = typedPolicySources(loaded);
  const issues: PolicyIssue[] = [];
  const isBlocked = blockedRepoPredicate(sources);
  const reportRepoConflicts = (source: PolicySourceKey, values: string[], code: string) => {
    for (const value of values) {
      const repo = normalizePolicyRepo(value);
      if (!isBlocked(repo)) continue;
      issues.push(issue(loaded, {
        code,
        reasonCode: "do-not-crawl",
        severity: "warning",
        scope: "conflict",
        source,
        location: "/",
        key: repo,
        message: `${repo} has both an admission/classification signal and a do-not-crawl rule.`,
      }));
    }
  };
  reportRepoConflicts("manualIncludeRepos", sources.manualIncludeRepos.include, "blocked-manual-include");
  reportRepoConflicts("officialRepos", [...sources.officialRepos.tier1, ...sources.officialRepos.tier2], "blocked-official-repo");
  reportRepoConflicts("catalogRepos", sources.catalogRepos.map((entry) => entry.repo), "blocked-catalog-repo");
  reportRepoConflicts(
    "repoOverrides",
    sources.repoOverrides.filter((entry) => entry.exclude !== true).map((entry) => entry.repo),
    "blocked-repo-override",
  );

  const blockedOwners = new Set(sources.doNotCrawl.owners.map((entry) => normalizePolicyHandle(entry.owner)));
  for (const entry of sources.creators.creators) {
    const variants = [entry.handle, ...(entry.aliases ?? [])].map(normalizePolicyHandle);
    if (!variants.some((handle) => blockedOwners.has(handle))) continue;
    issues.push(issue(loaded, {
      code: "blocked-creator",
      reasonCode: "do-not-crawl",
      severity: "warning",
      scope: "conflict",
      source: "creators",
      location: "/creators",
      key: normalizePolicyHandle(entry.handle),
      message: `${entry.handle} is registered as a creator and blocked by owner policy.`,
    }));
  }

  const suppressedIds = new Set(
    sources.suppressedSkills.skills.map((entry) => normalizePolicySkillId(entry.id)),
  );
  const editorialRefs: Array<{ id: string; location: string }> = [];
  for (const [handle, override] of Object.entries(sources.collections.authorOverrides ?? {})) {
    for (const id of override.featuredSkillIds ?? []) {
      editorialRefs.push({ id, location: `/authorOverrides/${handle}/featuredSkillIds` });
    }
  }
  for (const collection of sources.collections.collections) {
    for (const id of [...collection.featuredSkillIds, ...collection.skillIds]) {
      editorialRefs.push({ id, location: `/collections/${collection.id}` });
    }
  }
  for (const ref of editorialRefs) {
    const id = normalizePolicySkillId(ref.id);
    if (!suppressedIds.has(id)) continue;
    issues.push(issue(loaded, {
      code: "suppressed-editorial-skill",
      reasonCode: "suppressed-skill",
      severity: "warning",
      scope: "editorial",
      source: "collections",
      location: ref.location,
      key: id,
      message: `${ref.id} is both suppressed and referenced by editorial policy.`,
    }));
  }
  return issues;
}

function normalizedSet(values: ReadonlySet<string> | undefined): Set<string> {
  return new Set([...(values ?? [])].map(normalizePolicySkillId));
}

export function validatePolicyReferences(
  loaded: LoadedPolicySources,
  context: PolicyCatalogContext,
): PolicyIssue[] {
  const sources = typedPolicySources(loaded);
  const issues: PolicyIssue[] = [];
  const published = normalizedSet(context.publishedSkillIds);
  if (context.publishedSkillIds) {
    const checkRefs = (values: string[], location: string) => {
      for (const value of values) {
        const id = normalizePolicySkillId(value);
        if (published.has(id)) continue;
        issues.push(issue(loaded, {
          code: "stale-collection-skill",
          severity: "warning",
          scope: "editorial",
          source: "collections",
          location,
          key: id,
          message: `Editorial skill reference is absent from the published catalog: ${value}.`,
        }));
      }
    };
    for (const [handle, override] of Object.entries(sources.collections.authorOverrides ?? {})) {
      checkRefs(override.featuredSkillIds ?? [], `/authorOverrides/${handle}/featuredSkillIds`);
    }
    for (const collection of sources.collections.collections) {
      checkRefs(collection.featuredSkillIds, `/collections/${collection.id}/featuredSkillIds`);
      checkRefs(collection.skillIds, `/collections/${collection.id}/skillIds`);
    }
  }

  if (context.publishedAuthorHandles) {
    const authors = new Set([...context.publishedAuthorHandles].map(normalizePolicyHandle));
    for (const entry of sources.creators.creators) {
      if (!entry.featured) continue;
      const variants = [entry.handle, ...(entry.aliases ?? [])].map(normalizePolicyHandle);
      if (variants.some((handle) => authors.has(handle))) continue;
      issues.push(issue(loaded, {
        code: "stale-featured-creator",
        severity: "warning",
        scope: "editorial",
        source: "creators",
        location: "/creators",
        key: normalizePolicyHandle(entry.handle),
        message: `Featured creator is absent from the published catalog: ${entry.handle}.`,
      }));
    }
  }

  if (context.suppressionCandidateSkillIds) {
    const candidates = normalizedSet(context.suppressionCandidateSkillIds);
    const existing = normalizedSet(context.existingSuppressedSkillIds);
    for (const entry of sources.suppressedSkills.skills) {
      const id = normalizePolicySkillId(entry.id);
      if (candidates.has(id) || existing.has(id)) continue;
      issues.push(issue(loaded, {
        code: "unknown-new-suppression",
        source: "suppressedSkills",
        location: "/skills",
        key: id,
        message: `New suppression is absent from promoted, cutover, and overlay catalogs: ${entry.id}.`,
      }));
    }
  }
  return issues;
}

export function validatePolicy(
  loaded: LoadedPolicySources,
  context: PolicyCatalogContext = {},
): PolicyIssue[] {
  const structural = validatePolicyStructure(loaded);
  if (structural.some((entry) => entry.severity === "error")) return structural;
  return [
    ...structural,
    ...validatePolicyConflicts(loaded),
    ...validatePolicyReferences(loaded, context),
  ];
}

export function blockingPolicyIssues(
  issues: PolicyIssue[],
  profile: PolicyValidationProfile,
): PolicyIssue[] {
  return issues.filter((entry) => {
    if (entry.severity === "error") return true;
    if (profile === "editool" || profile === "strict") return true;
    if (profile === "collections-publish") return entry.scope === "editorial";
    return false;
  });
}

export function assertPolicyValid(
  issues: PolicyIssue[],
  profile: PolicyValidationProfile,
): void {
  const blocking = blockingPolicyIssues(issues, profile);
  if (blocking.length === 0) return;
  const first = blocking[0]!;
  throw new Error(`Policy validation failed (${first.code}): ${first.message}`);
}

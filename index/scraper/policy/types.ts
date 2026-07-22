import type { CreatorRegistrySource } from "../creator-registry.js";
import type {
  CatalogRepoRule,
  ProvenanceOverride,
  RepoOverride,
  SuppressedSkillRule,
} from "../new-crawl/types.js";

export const DO_NOT_CRAWL_REASONS = [
  "catalog",
  "duplicate",
  "low-quality",
  "marketplace",
  "other",
  "spam",
  "template-clone",
  "unsafe",
] as const;

export type DoNotCrawlReason = typeof DO_NOT_CRAWL_REASONS[number];

export type DoNotCrawlRule = {
  repo?: string;
  owner?: string;
  reason: DoNotCrawlReason;
  notes?: string;
};

// This is path-discovery policy, not exclusion policy. P1.5 will migrate the
// existing v2 KNOWN_INVALID_REPOS set without treating these repos as blocked.
export type RootSkillInvalidRule = {
  repo: string;
  reason: "root-skill-invalid";
  notes?: string;
};

export type RootSkillInvalidPolicySource = { repos: RootSkillInvalidRule[] };

export type OfficialRepoPolicySource = { tier1: string[]; tier2: string[] };
export type ManualIncludePolicySource = { include: string[] };
export type DoNotCrawlPolicySource = { repos: DoNotCrawlRule[]; owners: DoNotCrawlRule[] };
export type SuppressedSkillsPolicySource = { skills: SuppressedSkillRule[] };

export type SourceCollection = {
  id: string;
  type: "topic";
  title: string;
  subtitle: string;
  imageUrl?: string | null;
  featuredSkillIds: string[];
  skillIds: string[];
  description?: string | null;
};

export type AuthorOverride = {
  title?: string;
  subtitle?: string;
  imageUrl?: string | null;
  featuredSkillIds?: string[];
  description?: string | null;
};

export type CollectionsPolicySource = {
  version?: number;
  authorOverrides?: Record<string, AuthorOverride>;
  collections: SourceCollection[];
};

export type PolicySources = {
  creators: CreatorRegistrySource;
  collections: CollectionsPolicySource;
  officialRepos: OfficialRepoPolicySource;
  manualIncludeRepos: ManualIncludePolicySource;
  doNotCrawl: DoNotCrawlPolicySource;
  rootSkillInvalid: RootSkillInvalidPolicySource;
  suppressedSkills: SuppressedSkillsPolicySource;
  repoOverrides: RepoOverride[];
  catalogRepos: CatalogRepoRule[];
  provenanceOverrides: ProvenanceOverride[];
  skillEquivalenceOverrides: unknown;
};

export type PolicySourceKey = keyof PolicySources;
export type PolicyRawSources = Record<PolicySourceKey, unknown>;
export type PolicySourcePaths = Record<PolicySourceKey, string>;

export type LoadedPolicySources = {
  raw: PolicyRawSources;
  paths: PolicySourcePaths;
};

export type PolicyIssueSeverity = "error" | "warning";
export type PolicyIssueScope = "core" | "editorial" | "conflict";

export const POLICY_REASON_CODES = [
  "invalid-mapping",
  "do-not-crawl",
  "repo-override-exclude",
  "suppressed-skill",
  "root-skill-invalid",
  "catalog-repo",
  "non-original-provenance",
  "manual-include",
  "official",
  "trusted-vendor",
  "trusted-creator",
  "gold-basket",
  "creator-watch",
  "x-social",
  "stars",
  "install-signal",
  "below-value-threshold",
] as const;

export type PolicyReasonCode = typeof POLICY_REASON_CODES[number];

export type PolicyIssue = {
  code: string;
  reasonCode?: PolicyReasonCode;
  severity: PolicyIssueSeverity;
  scope: PolicyIssueScope;
  source: PolicySourceKey;
  path: string;
  key?: string;
  message: string;
};

export type PolicyValidationProfile =
  | "scheduled-data"
  | "collections-publish"
  | "editool"
  | "manual-command"
  | "deploy"
  | "strict";

export type PolicyCatalogContext = {
  publishedSkillIds?: ReadonlySet<string>;
  publishedAuthorHandles?: ReadonlySet<string>;
  suppressionCandidateSkillIds?: ReadonlySet<string>;
  existingSuppressedSkillIds?: ReadonlySet<string>;
};

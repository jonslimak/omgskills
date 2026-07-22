import { createHash } from "node:crypto";
import {
  normalizePolicyHandle,
  normalizePolicyRepo,
  normalizePolicySkillId,
  policyRepoFromSkillId,
} from "../../scripts/policy-identifiers.mjs";
import { replacePolicySource, typedPolicySources } from "../scraper/policy/loader.js";
import { repoFromGithubUrl } from "../scraper/policy/effective-policy.js";
import { validatePolicy } from "../scraper/policy/validator.js";
import type {
  LoadedPolicySources,
  PolicyCatalogContext,
  PolicyIssue,
  PolicyReasonCode,
  PolicySources,
} from "../scraper/policy/types.js";

export const EDITOOL_POLICY_SOURCE_KEYS = [
  "creators",
  "collections",
  "suppressedSkills",
  "doNotCrawl",
] as const;

const ACKNOWLEDGEABLE_DENY_WINS_CODES = new Set([
  "blocked-manual-include",
  "blocked-official-repo",
  "blocked-catalog-repo",
  "blocked-repo-override",
  "blocked-creator",
]);

export type EditoolPolicySourceKey = typeof EDITOOL_POLICY_SOURCE_KEYS[number];
export type EditoolPolicyReplacements = Partial<Pick<PolicySources, EditoolPolicySourceKey>>;
export type EditoolCatalogSkill = {
  id: string;
  author_handle?: string;
  github_url?: string;
  publisher_repo?: string;
};

export type EditoolPolicyFinding = {
  fingerprint: string;
  code: string;
  message: string;
  source: string;
  key: string | null;
  reasonCode: PolicyReasonCode | null;
  winner: PolicyReasonCode | null;
  disposition: "blocking" | "acknowledgeable-deny-wins";
  affectedSkillCount: number;
  affectedSkillIds: string[];
};

export type PreparedEditoolPolicySave =
  | {
      ok: true;
      savedKeys: EditoolPolicySourceKey[];
      entries: Array<{
        key: EditoolPolicySourceKey;
        value: PolicySources[EditoolPolicySourceKey];
      }>;
      findings: EditoolPolicyFinding[];
    }
  | {
      ok: false;
      errors: string[];
      findings: EditoolPolicyFinding[];
      requiredAcknowledgements: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEditoolPolicyReplacements(value: unknown):
  | { replacements: EditoolPolicyReplacements; errors: [] }
  | { replacements: null; errors: string[] } {
  if (!isRecord(value)) {
    return { replacements: null, errors: ["policy replacements must be an object"] };
  }
  const supported = new Set<string>(EDITOOL_POLICY_SOURCE_KEYS);
  const unknown = Object.keys(value).filter((key) => !supported.has(key));
  if (unknown.length) {
    return { replacements: null, errors: [`unsupported policy sources: ${unknown.sort().join(", ")}`] };
  }
  const savedKeys = EDITOOL_POLICY_SOURCE_KEYS.filter((key) => Object.hasOwn(value, key));
  if (savedKeys.length === 0) {
    return { replacements: null, errors: ["policy save requires at least one editable source"] };
  }
  return { replacements: value as EditoolPolicyReplacements, errors: [] };
}

function issueLocation(issue: PolicyIssue): string {
  return issue.path.includes("#") ? issue.path.slice(issue.path.indexOf("#") + 1) : issue.path;
}

function findingFingerprint(issue: PolicyIssue): string {
  const identity = [
    issue.code,
    issue.source,
    issue.key ?? "",
    issueLocation(issue),
    issue.reasonCode ?? "",
  ].join("\n");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

function affectedSkills(issue: PolicyIssue, skills: EditoolCatalogSkill[]): string[] {
  const key = issue.key?.trim();
  if (!key) return [];
  const normalizedId = normalizePolicySkillId(key);
  if (key.includes(":")) {
    return skills.filter((skill) => normalizePolicySkillId(skill.id) === normalizedId).map((skill) => skill.id);
  }
  if (key.includes("/")) {
    const repo = normalizePolicyRepo(key);
    return skills.filter((skill) => {
      const publisherRepo = normalizePolicyRepo(skill.publisher_repo ?? "") || repoFromGithubUrl(skill.github_url);
      return policyRepoFromSkillId(skill.id) === repo || publisherRepo === repo;
    }).map((skill) => skill.id);
  }
  const handle = normalizePolicyHandle(key);
  return skills.filter((skill) => {
    const publisherRepo = normalizePolicyRepo(skill.publisher_repo ?? "") || repoFromGithubUrl(skill.github_url);
    return normalizePolicyHandle(skill.author_handle) === handle || publisherRepo.split("/")[0] === handle;
  }).map((skill) => skill.id);
}

export function buildEditoolPolicyFindings(
  issues: PolicyIssue[],
  skills: EditoolCatalogSkill[],
): EditoolPolicyFinding[] {
  return issues.map((issue): EditoolPolicyFinding => {
    const affected = [...new Set(affectedSkills(issue, skills))].sort();
    const acknowledgeable = issue.scope === "conflict" && ACKNOWLEDGEABLE_DENY_WINS_CODES.has(issue.code);
    return {
      fingerprint: findingFingerprint(issue),
      code: issue.code,
      message: issue.message,
      source: issue.source,
      key: issue.key ?? null,
      reasonCode: issue.reasonCode ?? null,
      winner: issue.reasonCode ?? null,
      disposition: acknowledgeable ? "acknowledgeable-deny-wins" : "blocking",
      affectedSkillCount: affected.length,
      affectedSkillIds: affected.slice(0, 20),
    };
  }).sort((left, right) =>
    left.disposition.localeCompare(right.disposition)
    || left.code.localeCompare(right.code)
    || (left.key ?? "").localeCompare(right.key ?? "")
  );
}

export function prepareEditoolPolicySave(input: {
  loaded: LoadedPolicySources;
  replacements: EditoolPolicyReplacements;
  catalogContext: Omit<PolicyCatalogContext, "existingSuppressedSkillIds">;
  catalogSkills?: EditoolCatalogSkill[];
  acknowledgements?: ReadonlySet<string>;
}): PreparedEditoolPolicySave {
  const savedKeys = EDITOOL_POLICY_SOURCE_KEYS.filter((key) =>
    Object.hasOwn(input.replacements, key)
  );
  if (savedKeys.length === 0) {
    return {
      ok: false,
      errors: ["policy save requires at least one editable source"],
      findings: [],
      requiredAcknowledgements: [],
    };
  }

  const existingSuppressedSkillIds = new Set(
    typedPolicySources(input.loaded).suppressedSkills.skills.map((entry) => entry.id),
  );
  let proposed = input.loaded;
  for (const key of savedKeys) {
    proposed = replacePolicySource(proposed, key, input.replacements[key]!);
  }
  const issues = validatePolicy(proposed, {
    ...input.catalogContext,
    existingSuppressedSkillIds,
  });
  const findings = buildEditoolPolicyFindings(issues, input.catalogSkills ?? []);
  const blocking = findings.filter((finding) => finding.disposition === "blocking");
  const acknowledged = input.acknowledgements ?? new Set<string>();
  const unacknowledged = findings.filter((finding) =>
    finding.disposition === "acknowledgeable-deny-wins" && !acknowledged.has(finding.fingerprint)
  );
  if (blocking.length || unacknowledged.length) {
    return {
      ok: false,
      errors: [
        ...blocking.map((finding) => `${finding.code}: ${finding.message}`),
        ...unacknowledged.map((finding) => `acknowledgement-required: ${finding.message}`),
      ],
      findings,
      requiredAcknowledgements: unacknowledged.map((finding) => finding.fingerprint),
    };
  }

  return {
    ok: true,
    savedKeys,
    entries: savedKeys.map((key) => ({ key, value: input.replacements[key]! })),
    findings,
  };
}

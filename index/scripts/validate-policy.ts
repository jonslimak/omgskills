import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPolicySources, policyIndexRoot, typedPolicySources } from "../scraper/policy/loader.js";
import {
  assertPolicyValid,
  blockingPolicyIssues,
  validatePolicy,
} from "../scraper/policy/validator.js";
import type { PolicyValidationProfile } from "../scraper/policy/types.js";

const PROFILES = new Set<PolicyValidationProfile>([
  "scheduled-data",
  "collections-publish",
  "editool",
  "manual-command",
  "deploy",
  "strict",
]);

function requestedProfile(argv: string[]): PolicyValidationProfile {
  const inline = argv.find((value) => value.startsWith("--profile="))?.split("=")[1];
  const index = argv.indexOf("--profile");
  const value = inline ?? (index >= 0 ? argv[index + 1] : undefined) ?? "strict";
  if (!PROFILES.has(value as PolicyValidationProfile)) {
    throw new Error(`Unknown policy validation profile: ${value}`);
  }
  return value as PolicyValidationProfile;
}

function readCatalog(path: string): { skillIds: Set<string>; authorHandles: Set<string> } {
  if (!existsSync(path)) return { skillIds: new Set(), authorHandles: new Set() };
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && Array.isArray((value as { skills?: unknown }).skills)
      ? (value as { skills: unknown[] }).skills
      : [];
  const records = rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  return {
    skillIds: new Set(records.map((row) => row.id).filter((id): id is string => typeof id === "string" && id.trim().length > 0)),
    authorHandles: new Set(records.map((row) => row.author_handle).filter((handle): handle is string => typeof handle === "string" && handle.trim().length > 0)),
  };
}

function union(...sets: ReadonlySet<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

function main(): void {
  const profile = requestedProfile(process.argv.slice(2));
  const loaded = loadPolicySources();
  const sources = typedPolicySources(loaded);
  const promoted = readCatalog(join(policyIndexRoot, "skills.json"));
  const cutover = readCatalog(join(policyIndexRoot, "shadow", "skills.cutover.shadow.json"));
  const overlay = readCatalog(join(policyIndexRoot, "shadow", "skills.overlay.json"));
  const existingSuppressed = new Set(sources.suppressedSkills.skills.map((entry) => entry.id));
  const issues = validatePolicy(loaded, {
    publishedSkillIds: promoted.skillIds,
    publishedAuthorHandles: promoted.authorHandles,
    suppressionCandidateSkillIds: union(promoted.skillIds, cutover.skillIds, overlay.skillIds),
    existingSuppressedSkillIds: existingSuppressed,
  });
  const blocking = blockingPolicyIssues(issues, profile);

  for (const entry of issues) {
    console.log(`${entry.severity.toUpperCase()} ${entry.code} ${entry.path}: ${entry.message}`);
  }
  console.log(
    `Policy validation (${profile}): ${issues.length} findings, ${blocking.length} blocking; `
    + `catalogs promoted=${promoted.skillIds.size} cutover=${cutover.skillIds.size} overlay=${overlay.skillIds.size}`,
  );
  assertPolicyValid(issues, profile);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

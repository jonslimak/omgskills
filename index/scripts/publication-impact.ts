import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicySources, typedPolicySources } from "../scraper/policy/loader.js";
import { policyRunMetadata, type PolicyRunMetadata } from "../scraper/policy/metadata.js";

export const PUBLICATION_TRACKS = ["root", "v2", "crawl4"] as const;
export type PublicationTrack = typeof PUBLICATION_TRACKS[number];

export type PublicationAsset = {
  path: string;
  sha256: string;
  bytes: number;
};

export type CollectionSummary = {
  ids: string[];
  memberIdsByCollection: Record<string, string[]>;
  membershipCount: number;
};

export type PublicationSnapshot = PolicyRunMetadata & {
  version: 1;
  track: PublicationTrack;
  capturedAt: string;
  manifestGeneratedAt: string | null;
  manifestContentDigest: string;
  assets: Record<string, PublicationAsset>;
  skills: { count: number; ids: string[] };
  collections: CollectionSummary | null;
};

export type PublicationImpactIssue = {
  code: string;
  message: string;
  blocking: boolean;
  overrideable: boolean;
  assetKey?: string;
};

export type PublicationImpactOverride = {
  enabled: boolean;
  reason: string | null;
  errors: string[];
};

export type PublicationImpactReport = {
  version: 1;
  generatedAt: string;
  track: PublicationTrack;
  sourceCommit: string;
  policyDigest: string;
  baseline: {
    manifestGeneratedAt: string | null;
    skillsCount: number;
    collectionsCount: number;
    membershipCount: number;
  };
  proposed: {
    manifestGeneratedAt: string | null;
    skillsCount: number;
    collectionsCount: number;
    membershipCount: number;
  };
  skills: {
    addedCount: number;
    removedCount: number;
    removalThreshold: number;
    addedSample: string[];
    removedSample: string[];
  };
  collections: {
    addedIds: string[];
    removedIds: string[];
    removedMembershipCount: number;
    removedMembershipPercent: number;
  };
  assets: {
    addedKeys: string[];
    removedKeys: string[];
    authorizedRemovedKeys: string[];
  };
  override: { enabled: boolean; reason: string | null };
  issues: PublicationImpactIssue[];
  blocked: boolean;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const indexRoot = resolve(scriptDir, "..");
const repoRoot = resolve(indexRoot, "..");
const SAMPLE_LIMIT = 20;
const SKILL_REMOVAL_FLAT_LIMIT = 500;
const SKILL_REMOVAL_PERCENT = 0.02;
const COLLECTION_MEMBERSHIP_REMOVAL_PERCENT = 0.2;
const KNOWN_MANIFEST_ASSET_KEYS = new Set([
  "skills",
  "trending",
  "trendingLeaderboard",
  "leaderboardViewData",
  "xTrending",
  "skillSignals",
  "authorSignals",
  "authorLeaderboards",
  "collections",
  "shaHistory",
  "skillEquivalence",
]);

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assetDescriptor(value: unknown): PublicationAsset | null {
  if (!isRecord(value)) return null;
  const hasAssetField = ["path", "sha256", "bytes"].some((key) => Object.hasOwn(value, key));
  if (!hasAssetField) return null;
  if (
    typeof value.path !== "string"
    || !value.path
    || typeof value.sha256 !== "string"
    || !/^[0-9a-f]{64}$/i.test(value.sha256)
    || typeof value.bytes !== "number"
    || !Number.isSafeInteger(value.bytes)
    || value.bytes < 0
  ) {
    throw new Error("manifest contains an incomplete asset descriptor");
  }
  return { path: value.path, sha256: value.sha256.toLowerCase(), bytes: value.bytes };
}

function safeAssetPath(dataDir: string, assetPath: string): string {
  if (isAbsolute(assetPath)) throw new Error(`manifest asset path must be relative: ${assetPath}`);
  const resolved = resolve(dataDir, assetPath);
  const root = `${normalize(dataDir)}${sep}`;
  if (!resolved.startsWith(root)) throw new Error(`manifest asset path escapes data directory: ${assetPath}`);
  return resolved;
}

function sortedUniqueStrings(values: unknown[], context: string): string[] {
  const strings = values.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${context} contains an invalid ID`);
    return value;
  });
  const unique = [...new Set(strings)].sort();
  if (unique.length !== strings.length) throw new Error(`${context} contains duplicate IDs`);
  return unique;
}

export function summarizeCollections(value: unknown): CollectionSummary {
  if (!isRecord(value) || !Array.isArray(value.collections)) {
    throw new Error("collections asset must contain a collections array");
  }
  const memberIdsByCollection: Record<string, string[]> = {};
  for (const entry of value.collections) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) {
      throw new Error("collections asset contains an invalid collection");
    }
    if (Object.hasOwn(memberIdsByCollection, entry.id)) {
      throw new Error(`collections asset contains duplicate id: ${entry.id}`);
    }
    const featured = Array.isArray(entry.featuredSkillIds) ? entry.featuredSkillIds : [];
    const skills = Array.isArray(entry.skillIds) ? entry.skillIds : [];
    const featuredIds = sortedUniqueStrings(featured, `collection ${entry.id} featuredSkillIds`);
    const skillIds = sortedUniqueStrings(skills, `collection ${entry.id} skillIds`);
    memberIdsByCollection[entry.id] = [...new Set([...featuredIds, ...skillIds])].sort();
  }
  const ids = Object.keys(memberIdsByCollection).sort();
  return {
    ids,
    memberIdsByCollection: Object.fromEntries(ids.map((id) => [id, memberIdsByCollection[id]])),
    membershipCount: ids.reduce((total, id) => total + memberIdsByCollection[id].length, 0),
  };
}

export function publicationDataDir(
  track: PublicationTrack,
  siteRoot = join(repoRoot, "site"),
): string {
  return track === "root" ? join(siteRoot, "data") : join(siteRoot, "data", track);
}

export function snapshotPublicationDirectory(input: {
  track: PublicationTrack;
  dataDir?: string;
  capturedAt?: string;
  metadata?: PolicyRunMetadata;
}): PublicationSnapshot {
  const dataDir = input.dataDir ?? publicationDataDir(input.track);
  const manifestPath = join(dataDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`missing manifest: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (!isRecord(manifest)) throw new Error(`manifest must be an object: ${manifestPath}`);

  const assets: Record<string, PublicationAsset> = {};
  const decodedAssets = new Map<string, unknown>();
  for (const [key, value] of Object.entries(manifest)) {
    const descriptor = assetDescriptor(value);
    if (KNOWN_MANIFEST_ASSET_KEYS.has(key) && !descriptor) {
      throw new Error(`${key} manifest asset descriptor is missing or malformed`);
    }
    if (!descriptor) continue;
    const path = safeAssetPath(dataDir, descriptor.path);
    if (!existsSync(path)) throw new Error(`${key} asset file is missing: ${descriptor.path}`);
    const data = readFileSync(path);
    if (statSync(path).size !== descriptor.bytes) throw new Error(`${key} asset byte count mismatch`);
    if (sha256(data) !== descriptor.sha256) throw new Error(`${key} asset sha256 mismatch`);
    assets[key] = descriptor;
    decodedAssets.set(key, JSON.parse(data.toString("utf8")));
  }
  if (!assets.skills) throw new Error("manifest is missing the skills asset");
  if (!assets.trending) throw new Error("manifest is missing the trending asset");

  const skillsValue = decodedAssets.get("skills");
  if (!Array.isArray(skillsValue)) throw new Error("skills asset must be an array");
  const skillIds = sortedUniqueStrings(
    skillsValue.map((entry) => isRecord(entry) ? entry.id : null),
    "skills asset",
  );
  const collections = assets.collections
    ? summarizeCollections(decodedAssets.get("collections"))
    : null;
  const { generatedAt: _generatedAt, ...manifestContent } = manifest;
  const metadata = input.metadata ?? policyRunMetadata(typedPolicySources(loadPolicySources()));

  return {
    version: 1,
    track: input.track,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    ...metadata,
    manifestGeneratedAt: typeof manifest.generatedAt === "string" && manifest.generatedAt
      ? manifest.generatedAt
      : null,
    manifestContentDigest: `sha256:${sha256(JSON.stringify(stableValue(manifestContent)))}`,
    assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))),
    skills: { count: skillIds.length, ids: skillIds },
    collections,
  };
}

export function parsePublicationImpactOverride(
  env: NodeJS.ProcessEnv = process.env,
): PublicationImpactOverride {
  const raw = env.PUBLICATION_IMPACT_OVERRIDE?.trim().toLowerCase() ?? "";
  const reason = env.PUBLICATION_IMPACT_OVERRIDE_REASON?.trim() || null;
  const errors: string[] = [];
  if (raw && raw !== "1") {
    errors.push(`invalid PUBLICATION_IMPACT_OVERRIDE value "${raw}"; expected 1 or unset`);
  }
  const enabled = raw === "1";
  if (enabled && !reason) errors.push("PUBLICATION_IMPACT_OVERRIDE_REASON is required when override is enabled");
  if (!enabled && reason) errors.push("PUBLICATION_IMPACT_OVERRIDE_REASON requires PUBLICATION_IMPACT_OVERRIDE=1");
  return { enabled, reason, errors };
}

export function authorizedAssetRemovals(
  env: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
  const authorized = new Map<string, string>();
  const equivalence = env.SKILL_EQUIVALENCE_PUBLISH?.trim().toLowerCase();
  if (equivalence && !["0", "1", "remove"].includes(equivalence)) {
    throw new Error(
      `invalid SKILL_EQUIVALENCE_PUBLISH value "${equivalence}"; expected 0, 1, remove, or unset`,
    );
  }
  if (equivalence === "0" || equivalence === "remove") {
    authorized.set("skillEquivalence", `SKILL_EQUIVALENCE_PUBLISH=${equivalence}`);
  }
  const collections = env.COLLECTIONS_PUBLISH?.trim().toLowerCase();
  if (collections && !["0", "1", "publish", "remove"].includes(collections)) {
    throw new Error(
      `invalid COLLECTIONS_PUBLISH value "${collections}"; expected 0, 1, publish, remove, or unset`,
    );
  }
  if (collections === "0" || collections === "remove") {
    authorized.set("collections", `COLLECTIONS_PUBLISH=${collections}`);
  }
  return authorized;
}

function setDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

export function collectionDelta(
  baseline: CollectionSummary | null,
  proposed: CollectionSummary | null,
): PublicationImpactReport["collections"] {
  const baselineIds = baseline?.ids ?? [];
  const proposedIds = proposed?.ids ?? [];
  let removedMembershipCount = 0;
  for (const id of baselineIds) {
    const previous = baseline?.memberIdsByCollection[id] ?? [];
    const next = proposed?.memberIdsByCollection[id] ?? [];
    removedMembershipCount += setDifference(previous, next).length;
  }
  return {
    addedIds: setDifference(proposedIds, baselineIds),
    removedIds: setDifference(baselineIds, proposedIds),
    removedMembershipCount,
    removedMembershipPercent: baseline?.membershipCount
      ? removedMembershipCount / baseline.membershipCount
      : 0,
  };
}

function withOverride(
  issue: PublicationImpactIssue,
  override: PublicationImpactOverride,
): PublicationImpactIssue {
  if (issue.blocking && issue.overrideable && override.enabled && override.errors.length === 0) {
    return { ...issue, blocking: false };
  }
  return issue;
}

export function evaluatePublicationImpact(input: {
  baseline: PublicationSnapshot;
  proposed: PublicationSnapshot;
  override?: PublicationImpactOverride;
  authorizedRemovals?: ReadonlyMap<string, string>;
  generatedAt?: string;
}): PublicationImpactReport {
  if (input.baseline.track !== input.proposed.track) {
    throw new Error(`publication track mismatch: ${input.baseline.track} != ${input.proposed.track}`);
  }
  const override = input.override ?? parsePublicationImpactOverride({});
  const authorizedRemovals = input.authorizedRemovals ?? new Map<string, string>();
  const issues: PublicationImpactIssue[] = override.errors.map((message) => ({
    code: "invalid-override",
    message,
    blocking: true,
    overrideable: false,
  }));
  const addIssue = (issue: PublicationImpactIssue) => issues.push(withOverride(issue, override));

  const baselineTime = input.baseline.manifestGeneratedAt
    ? Date.parse(input.baseline.manifestGeneratedAt)
    : Number.NaN;
  const proposedTime = input.proposed.manifestGeneratedAt
    ? Date.parse(input.proposed.manifestGeneratedAt)
    : Number.NaN;
  if (!Number.isFinite(baselineTime)) {
    addIssue({
      code: "missing-baseline-generated-at",
      message: "baseline manifest has a missing or invalid generatedAt",
      blocking: true,
      overrideable: false,
    });
  }
  if (!Number.isFinite(proposedTime)) {
    addIssue({
      code: "missing-generated-at",
      message: "proposed manifest has a missing or invalid generatedAt",
      blocking: true,
      overrideable: false,
    });
  } else if (Number.isFinite(baselineTime) && proposedTime < baselineTime) {
    addIssue({
      code: "older-generated-at",
      message: `proposed generatedAt ${input.proposed.manifestGeneratedAt} is older than ${input.baseline.manifestGeneratedAt}`,
      blocking: true,
      overrideable: true,
    });
  } else if (
    Number.isFinite(baselineTime)
    && proposedTime === baselineTime
    && input.proposed.manifestContentDigest !== input.baseline.manifestContentDigest
  ) {
    addIssue({
      code: "changed-content-with-equal-timestamp",
      message: "manifest content changed without advancing generatedAt",
      blocking: true,
      overrideable: true,
    });
  }

  const baselineAssetKeys = Object.keys(input.baseline.assets);
  const proposedAssetKeys = Object.keys(input.proposed.assets);
  const removedAssetKeys = setDifference(baselineAssetKeys, proposedAssetKeys);
  const authorizedRemovedKeys: string[] = [];
  for (const key of removedAssetKeys) {
    const authorization = authorizedRemovals.get(key);
    if (authorization) {
      authorizedRemovedKeys.push(key);
      issues.push({
        code: "authorized-asset-removal",
        message: `${key} removal authorized by ${authorization}`,
        blocking: false,
        overrideable: false,
        assetKey: key,
      });
      continue;
    }
    addIssue({
      code: "unexpected-asset-removal",
      message: `previously published manifest asset disappeared: ${key}`,
      blocking: true,
      overrideable: true,
      assetKey: key,
    });
  }

  const addedSkillIds = setDifference(input.proposed.skills.ids, input.baseline.skills.ids);
  const removedSkillIds = setDifference(input.baseline.skills.ids, input.proposed.skills.ids);
  const removalThreshold = input.baseline.skills.count > 0
    ? Math.min(
        SKILL_REMOVAL_FLAT_LIMIT,
        Math.max(1, Math.ceil(input.baseline.skills.count * SKILL_REMOVAL_PERCENT)),
      )
    : SKILL_REMOVAL_FLAT_LIMIT;
  if (removedSkillIds.length >= removalThreshold) {
    addIssue({
      code: "large-skill-removal",
      message: `removed ${removedSkillIds.length} skills; threshold is ${removalThreshold} (500 or 2%, whichever is tighter)`,
      blocking: true,
      overrideable: true,
    });
  }

  const collections = collectionDelta(input.baseline.collections, input.proposed.collections);
  if (collections.removedIds.length > 0 && !authorizedRemovedKeys.includes("collections")) {
    addIssue({
      code: "collection-id-removal",
      message: `removed collection IDs: ${collections.removedIds.join(", ")}`,
      blocking: true,
      overrideable: true,
      assetKey: "collections",
    });
  }
  if (
    collections.removedMembershipCount > 0
    && collections.removedMembershipPercent >= COLLECTION_MEMBERSHIP_REMOVAL_PERCENT
    && !authorizedRemovedKeys.includes("collections")
  ) {
    addIssue({
      code: "large-collection-membership-removal",
      message: `removed ${(collections.removedMembershipPercent * 100).toFixed(1)}% of published collection memberships`,
      blocking: true,
      overrideable: true,
      assetKey: "collections",
    });
  }

  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    track: input.proposed.track,
    sourceCommit: input.proposed.sourceCommit,
    policyDigest: input.proposed.policyDigest,
    baseline: {
      manifestGeneratedAt: input.baseline.manifestGeneratedAt,
      skillsCount: input.baseline.skills.count,
      collectionsCount: input.baseline.collections?.ids.length ?? 0,
      membershipCount: input.baseline.collections?.membershipCount ?? 0,
    },
    proposed: {
      manifestGeneratedAt: input.proposed.manifestGeneratedAt,
      skillsCount: input.proposed.skills.count,
      collectionsCount: input.proposed.collections?.ids.length ?? 0,
      membershipCount: input.proposed.collections?.membershipCount ?? 0,
    },
    skills: {
      addedCount: addedSkillIds.length,
      removedCount: removedSkillIds.length,
      removalThreshold,
      addedSample: addedSkillIds.slice(0, SAMPLE_LIMIT),
      removedSample: removedSkillIds.slice(0, SAMPLE_LIMIT),
    },
    collections,
    assets: {
      addedKeys: setDifference(proposedAssetKeys, baselineAssetKeys),
      removedKeys: removedAssetKeys,
      authorizedRemovedKeys: authorizedRemovedKeys.sort(),
    },
    override: { enabled: override.enabled, reason: override.reason },
    issues,
    blocked: issues.some((issue) => issue.blocking),
  };
}

export function renderPublicationImpactMarkdown(report: PublicationImpactReport): string {
  return `${[
    `# Publication Impact: ${report.track}`,
    "",
    `- Generated: ${report.generatedAt}`,
    `- Source commit: ${report.sourceCommit}`,
    `- Policy digest: ${report.policyDigest}`,
    `- Decision: ${report.blocked ? "BLOCKED" : "PASS"}`,
    `- Override: ${report.override.enabled ? report.override.reason : "none"}`,
    `- Skills: ${report.baseline.skillsCount} -> ${report.proposed.skillsCount}`,
    `- Added skills: ${report.skills.addedCount}`,
    `- Removed skills: ${report.skills.removedCount} (threshold ${report.skills.removalThreshold})`,
    `- Collections: ${report.baseline.collectionsCount} -> ${report.proposed.collectionsCount}`,
    `- Collection memberships: ${report.baseline.membershipCount} -> ${report.proposed.membershipCount}`,
    "",
    "## Findings",
    ...(report.issues.length
      ? report.issues.map((issue) => `- ${issue.blocking ? "BLOCK" : "INFO"} ${issue.code}: ${issue.message}`)
      : ["- none"]),
    "",
    "## Removed Skill Sample",
    ...(report.skills.removedSample.length ? report.skills.removedSample.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Added Skill Sample",
    ...(report.skills.addedSample.length ? report.skills.addedSample.map((id) => `- ${id}`) : ["- none"]),
    "",
  ].join("\n")}\n`;
}

function parseArgs(argv: string[]): { command: string; values: Map<string, string> } {
  const [command = "", ...rest] = argv;
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    values.set(key, value);
    index += 1;
  }
  return { command, values };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function requestedTrack(value: string): PublicationTrack {
  if (!PUBLICATION_TRACKS.includes(value as PublicationTrack)) {
    throw new Error(`invalid publication track: ${value}`);
  }
  return value as PublicationTrack;
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function failedReport(
  baseline: PublicationSnapshot,
  message: string,
  metadata: PolicyRunMetadata,
): PublicationImpactReport {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    track: baseline.track,
    ...metadata,
    baseline: {
      manifestGeneratedAt: baseline.manifestGeneratedAt,
      skillsCount: baseline.skills.count,
      collectionsCount: baseline.collections?.ids.length ?? 0,
      membershipCount: baseline.collections?.membershipCount ?? 0,
    },
    proposed: {
      manifestGeneratedAt: null,
      skillsCount: 0,
      collectionsCount: 0,
      membershipCount: 0,
    },
    skills: {
      addedCount: 0,
      removedCount: 0,
      removalThreshold: Math.min(
        SKILL_REMOVAL_FLAT_LIMIT,
        Math.max(1, Math.ceil(baseline.skills.count * SKILL_REMOVAL_PERCENT)),
      ),
      addedSample: [],
      removedSample: [],
    },
    collections: {
      addedIds: [],
      removedIds: [],
      removedMembershipCount: 0,
      removedMembershipPercent: 0,
    },
    assets: { addedKeys: [], removedKeys: [], authorizedRemovedKeys: [] },
    override: { enabled: false, reason: null },
    issues: [{
      code: "invalid-proposed-publication",
      message,
      blocking: true,
      overrideable: false,
    }],
    blocked: true,
  };
}

async function main(): Promise<void> {
  const { command, values } = parseArgs(process.argv.slice(2));
  const track = requestedTrack(required(values, "track"));
  if (command === "snapshot") {
    const output = resolve(required(values, "output"));
    const snapshot = snapshotPublicationDirectory({ track });
    writeText(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`publication-impact: captured ${track} baseline -> ${output}`);
    return;
  }
  if (command !== "check") throw new Error("expected snapshot or check command");

  const baselinePath = resolve(required(values, "baseline"));
  const jsonPath = resolve(required(values, "json"));
  const markdownPath = resolve(required(values, "markdown"));
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as PublicationSnapshot;
  const metadata = policyRunMetadata(typedPolicySources(loadPolicySources()));
  let report: PublicationImpactReport;
  try {
    const proposed = snapshotPublicationDirectory({ track, metadata });
    report = evaluatePublicationImpact({
      baseline,
      proposed,
      override: parsePublicationImpactOverride(),
      authorizedRemovals: authorizedAssetRemovals(),
    });
  } catch (error) {
    report = failedReport(baseline, error instanceof Error ? error.message : String(error), metadata);
  }
  writeText(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeText(markdownPath, renderPublicationImpactMarkdown(report));
  console.log(renderPublicationImpactMarkdown(report));
  if (report.blocked) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`publication-impact: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

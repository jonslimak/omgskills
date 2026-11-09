import { validateSourceTrending, SOURCE_TRENDING_STALE_MS, type SourceTrendingEntry, type SourceTrendingFeed } from "../../../scripts/source-trending-format.mjs";
import type { Candidate, EnrichResult, RepoMeta } from "../enrich.js";
import type { Skill } from "../types.js";
import { evaluateEffectiveSkillPolicy, repoFromGithubUrl } from "../policy/effective-policy.js";
import { resolveShadowProvenance } from "./provenance.js";
import { isKnownCatalogRepo } from "./catalog-policy.js";
import { pinnedPackageMetadataFromSkill, type PinnedPackageMetadata } from "./package-metadata.js";
import { prepareShadowSkillPersistence, TRENDING_ADMISSION_SOURCE, type ShadowSkillPersistenceSnapshot } from "./shadow-skill-persistence.js";
import type { ShadowSkillRecord, TrustedSeeds } from "./types.js";
import type { TrendingAttributionResult } from "./trending-attribution.js";

export const TRENDING_MVP_LIMIT = 20;
const githubRepo = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const shaPattern = /^[0-9a-f]{40}$/i;
const normalizePath = (path: string) => path.replace(/^\.\//, "");
const normalizedName = (name: string) => name.toLowerCase().replace(/[_\s]+/g, "-");

export type TrendingMvpOutcome = {
  sourceId: string;
  rank: number;
  status: "added" | "existing" | "duplicate" | "blocked" | "unresolved" | "failed" | "temporary-failure";
  reason: string;
  id?: string;
  repo?: string;
  path?: string;
  stars?: number;
  existingId?: string;
  attribution?: TrendingAttributionResult;
};

export type TrendingMvpRepo = {
  repo: string;
  commit: string;
  meta: RepoMeta;
  paths: string[];
  readmePath?: string;
};

export type TrendingMvpDependencies = {
  lookupRepo: (source: string) => Promise<TrendingMvpRepo>;
  enrich: (candidate: Candidate, meta: RepoMeta) => Promise<EnrichResult>;
  pin: (skill: Skill, commit: string) => Promise<PinnedPackageMetadata | null>;
  inspectAttribution: (skill: Skill, commit: string, entry: SourceTrendingEntry) => Promise<TrendingAttributionResult>;
  beforeCandidate?: (index: number) => Promise<void>;
};

export function selectTrendingMvpCandidates(feed: SourceTrendingFeed, skills: Skill[], limit = TRENDING_MVP_LIMIT, now = Date.now()) {
  validateSourceTrending(feed);
  if (!Number.isInteger(limit) || limit < 1 || limit > TRENDING_MVP_LIMIT) throw new Error("Trending MVP limit must be 1..20");
  const age = now - Date.parse(feed.fetchedAt);
  if (age > SOURCE_TRENDING_STALE_MS || age < -5 * 60_000) throw new Error("Trending MVP requires a fresh source snapshot");
  const known = new Set(skills.map(skill => skill.id.toLowerCase()));
  return feed.entries.filter(entry => githubRepo.test(entry.source)
    && !known.has(`${entry.source}:${entry.skillId}`.toLowerCase())).slice(0, limit);
}

// Match a unique skill folder, not an arbitrary substring or the first tree result.
export function resolveTrendingMvpPath(paths: string[], hint: string): string | null {
  const safe = [...new Set(paths)].filter(path => (path === "SKILL.md" || path.endsWith("/SKILL.md"))
    && !path.startsWith("/") && !path.includes("\\")
    && !path.split("/").some(part => !part || part === "." || part === ".."));
  const exact = safe.filter(path => path !== "SKILL.md"
    && normalizedName(path.split("/").at(-2)!) === normalizedName(hint));
  if (exact.length === 1) return exact[0]!;
  if (safe.length === 1 && safe[0] === "SKILL.md") return "SKILL.md";
  return null;
}

export function trendingMvpPolicyReason(id: string, repoUrl: string, seeds: TrustedSeeds): string | null {
  const decision = evaluateEffectiveSkillPolicy({ id, github_url: repoUrl }, seeds);
  if (decision.excluded) return decision.reasonCode ?? "policy-excluded";
  if ([id.split(":")[0]!.toLowerCase(), repoFromGithubUrl(repoUrl)].some(repo => isKnownCatalogRepo(repo, seeds.catalogRepoRules))) {
    return "catalog-repo";
  }
  const override = seeds.provenanceOverrides.find(row => row.id?.toLowerCase() === id.toLowerCase())
    ?? seeds.provenanceOverrides.find(row => row.repo === repoFromGithubUrl(repoUrl));
  return override?.provenanceType && override.provenanceType !== "original" ? "non-original-provenance" : null;
}

async function verifyEntry(entry: SourceTrendingEntry, skills: ShadowSkillRecord[], seeds: TrustedSeeds, deps: TrendingMvpDependencies): Promise<{
  outcome: TrendingMvpOutcome;
  skill?: ShadowSkillRecord;
}> {
  const sourceId = `${entry.source}:${entry.skillId}`;
  const outcome: TrendingMvpOutcome = { sourceId, rank: entry.rank, status: "unresolved", reason: "path-unresolved" };
  const sourceBlock = trendingMvpPolicyReason(sourceId, `https://github.com/${entry.source}`, seeds);
  if (sourceBlock) return { outcome: { ...outcome, status: "blocked", reason: sourceBlock } };
  const repo = await deps.lookupRepo(entry.source);
  if (!githubRepo.test(repo.repo) || !shaPattern.test(repo.commit)) throw new Error("Invalid canonical repository coordinates");
  const id = `${repo.repo}:${entry.skillId}`;
  const repoUrl = `https://github.com/${repo.repo}`;
  const details = { ...outcome, id, repo: repo.repo, stars: repo.meta.stars };
  const canonicalBlock = trendingMvpPolicyReason(id, repoUrl, seeds);
  if (canonicalBlock) return { outcome: { ...details, status: "blocked", reason: canonicalBlock } };
  const path = resolveTrendingMvpPath(repo.paths, entry.skillId);
  if (!path) return { outcome: details };
  if (path === "SKILL.md" && seeds.rootSkillInvalidRepos?.has(repo.repo.toLowerCase())) {
    return { outcome: { ...details, path, status: "blocked", reason: "known-invalid-root" } };
  }
  const existingId = skills.find(skill => skill.id.toLowerCase() === id.toLowerCase());
  if (existingId && (repoFromGithubUrl(existingId.github_url) !== repo.repo.toLowerCase()
    || normalizePath(existingId.skill_md_path ?? "") !== path)) {
    return { outcome: { ...details, path, status: "failed", reason: "existing-id-path-conflict" } };
  }
  const existing = existingId ?? skills.find(skill => repoFromGithubUrl(skill.github_url) === repo.repo.toLowerCase()
    && normalizePath(skill.skill_md_path ?? "") === path);
  if (existing) return { outcome: { ...details, path, status: "existing", reason: "catalog-identity-or-path", existingId: existing.id } };
  // The resolved path can have a different historical ID; honor those suppressions too.
  const pathId = `${repo.repo}:${path === "SKILL.md" ? repo.repo.split("/")[1] : path.slice(0, -"/SKILL.md".length)}`;
  const pathBlock = trendingMvpPolicyReason(pathId, repoUrl, seeds);
  if (pathBlock) return { outcome: { ...details, path, status: "blocked", reason: pathBlock } };
  const enriched = await deps.enrich({ id, github_url: repoUrl, skill_md_path: path, ref: repo.commit }, repo.meta);
  if (!enriched.skill) return { outcome: { ...details, path,
    status: enriched.failure?.status && enriched.failure.status >= 500 ? "temporary-failure" : "failed",
    reason: enriched.failure?.reason ?? "content-unavailable" } };
  const skill = enriched.skill;
  if (skill.id !== id || skill.skill_md_path !== path || repoFromGithubUrl(skill.github_url) !== repo.repo.toLowerCase()) {
    return { outcome: { ...details, path, status: "failed", reason: "content-identity-mismatch" } };
  }
  const provenance = resolveShadowProvenance(skill, seeds);
  if (provenance.provenanceType !== "original") return { outcome: { ...details, path, status: "blocked", reason: "non-original-provenance" } };
  const attribution = await deps.inspectAttribution(skill, repo.commit, entry);
  if (attribution.status === "copy") {
    return { outcome: { ...details, path, attribution, status: "blocked", reason: attribution.reason } };
  }
  const pinned = await deps.pin(skill, repo.commit);
  if (!pinned || !pinnedPackageMetadataFromSkill(pinned)
    || pinned.repo_slug.toLowerCase() !== repo.repo.toLowerCase() || pinned.skill_md_path !== path
    || pinned.repo_commit_sha.toLowerCase() !== repo.commit.toLowerCase()
    || pinned.skill_md_sha.toLowerCase() !== skill.skill_md_sha?.toLowerCase()) {
    return { outcome: { ...details, path, status: "temporary-failure", reason: "package-metadata-unresolved-or-mismatched" } };
  }
  return { outcome: { ...details, path, attribution, status: "added", reason: "verified-trending" }, skill: {
    ...skill, ...pinned, author_handle: provenance.authorHandle, publisher_handle: provenance.publisherHandle,
    publisher_repo: provenance.publisherRepo, upstream_repo: provenance.upstreamRepo,
    provenance_type: provenance.provenanceType, author_confidence: provenance.authorConfidence,
  } };
}

export async function executeTrendingMvp(input: {
  entries: SourceTrendingEntry[];
  snapshot: ShadowSkillPersistenceSnapshot;
  seeds: TrustedSeeds;
  deps: TrendingMvpDependencies;
  generatedAt: string;
}) {
  if (input.entries.length > TRENDING_MVP_LIMIT) throw new Error("Trending MVP cannot attempt more than 20 skills");
  let snapshot = structuredClone(input.snapshot);
  const outcomes: TrendingMvpOutcome[] = [];
  for (const [index, entry] of input.entries.entries()) {
    await input.deps.beforeCandidate?.(index);
    let verified: Awaited<ReturnType<typeof verifyEntry>>;
    try {
      verified = await verifyEntry(entry, snapshot.cutoverSkills, input.seeds, input.deps);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 429) throw new Error(`Trending MVP stopped: GitHub authorization/rate limit (${status})`);
      outcomes.push({ sourceId: `${entry.source}:${entry.skillId}`, rank: entry.rank,
        status: status === 404 ? "unresolved" : "temporary-failure", reason: status === 404 ? "source-not-found" : "source-request-failed" });
      continue;
    }
    if (!verified.skill) { outcomes.push(verified.outcome); continue; }
    const prepared = prepareShadowSkillPersistence({ snapshot, additions: [{ skill: verified.skill,
      repoKey: verified.outcome.repo!.toLowerCase(), repoUrl: verified.skill.github_url, source: TRENDING_ADMISSION_SOURCE }],
      generatedAt: input.generatedAt, dedupeExactSha: true });
    const result = prepared.outcomes[0]!;
    outcomes.push({ ...verified.outcome, status: result.status === "exact-sha-existing" ? "duplicate" : result.status,
      reason: result.status === "exact-sha-existing" ? "exact-sha-existing" : verified.outcome.reason,
      ...(result.existingId ? { existingId: result.existingId } : {}) });
    snapshot = { ...prepared.next, revisions: input.snapshot.revisions };
  }
  return { snapshot, outcomes };
}

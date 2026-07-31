import { sortBootstrapCandidates } from "./bootstrap.js";
import type {
  DiscoveredRepoRecord,
  RepoBootstrapCandidate,
  RepoCanonicalizationReport,
} from "./types.js";

export const MAX_ADMISSION_CANONICALIZATION_CHECKS = 25;
const MAX_REPORT_SAMPLES = 20;

export type CanonicalRepoIdentity = {
  repo: string;
  repoUrl: string;
};

type CanonicalizeAdmissionReposOptions = {
  discovered: Map<string, DiscoveredRepoRecord>;
  candidateRepos: Iterable<string>;
  existingRepoKeys: ReadonlySet<string>;
  resolveCanonicalRepoFn: (repo: string) => Promise<CanonicalRepoIdentity>;
  maxChecks?: number;
};

function normalizeRepo(value: string): string {
  const normalized = value.trim().replace(/\.git$/i, "").toLowerCase();
  if (!/^[^/]+\/[^/]+$/.test(normalized)) {
    throw new Error(`invalid canonical repository: ${value}`);
  }
  return normalized;
}

function rewriteCandidate(
  candidate: RepoBootstrapCandidate,
  canonical: CanonicalRepoIdentity,
): RepoBootstrapCandidate {
  const separator = candidate.id.indexOf(":");
  const suffix = separator >= 0 ? candidate.id.slice(separator) : "";
  return {
    ...candidate,
    id: `${canonical.repo}${suffix}`,
    github_url: canonical.repoUrl,
  };
}

function allCandidates(record: DiscoveredRepoRecord): RepoBootstrapCandidate[] {
  return sortBootstrapCandidates([
    ...(record.bootstrapCandidates ?? []),
    ...(record.bootstrapCandidate ? [record.bootstrapCandidate] : []),
  ]);
}

function mergeRecord(
  source: DiscoveredRepoRecord,
  target: DiscoveredRepoRecord | undefined,
  canonical: CanonicalRepoIdentity,
): DiscoveredRepoRecord {
  const candidates = sortBootstrapCandidates([
    ...allCandidates(source),
    ...(target ? allCandidates(target) : []),
  ].map((candidate) => rewriteCandidate(candidate, canonical)));

  return {
    repo: canonical.repo,
    repoUrl: canonical.repoUrl,
    sources: new Set([...(target?.sources ?? []), ...source.sources]),
    lanes: new Set([...(target?.lanes ?? []), ...source.lanes]),
    stars: Math.max(source.stars, target?.stars ?? 0),
    ...(candidates[0] ? { bootstrapCandidate: candidates[0] } : {}),
    ...(candidates.length ? { bootstrapCandidates: candidates } : {}),
  };
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 160);
}

export async function canonicalizeAdmissionRepos({
  discovered,
  candidateRepos,
  existingRepoKeys,
  resolveCanonicalRepoFn,
  maxChecks = MAX_ADMISSION_CANONICALIZATION_CHECKS,
}: CanonicalizeAdmissionReposOptions): Promise<RepoCanonicalizationReport> {
  const candidates = [...new Set([...candidateRepos].map(normalizeRepo))].sort();
  const resolvedCanonicalKeys = new Set<string>();
  const sample: RepoCanonicalizationReport["sample"] = [];
  let checkedCount = 0;
  let unchangedCount = 0;
  let renamedCount = 0;
  let mergedIntoExistingCount = 0;
  let mergedIntoDiscoveryCount = 0;
  let deferredByErrorCount = 0;
  let deferredByCapCount = 0;

  for (const aliasRepo of candidates) {
    const source = discovered.get(aliasRepo);
    if (!source) continue;

    if (checkedCount >= maxChecks) {
      if (resolvedCanonicalKeys.has(aliasRepo)) continue;
      discovered.delete(aliasRepo);
      deferredByCapCount += 1;
      if (sample.length < MAX_REPORT_SAMPLES) {
        sample.push({ aliasRepo, canonicalRepo: null, outcome: "deferred-cap" });
      }
      continue;
    }

    checkedCount += 1;
    let canonical: CanonicalRepoIdentity;
    try {
      const resolved = await resolveCanonicalRepoFn(aliasRepo);
      canonical = {
        repo: normalizeRepo(resolved.repo),
        repoUrl: resolved.repoUrl,
      };
    } catch (error) {
      discovered.delete(aliasRepo);
      deferredByErrorCount += 1;
      if (sample.length < MAX_REPORT_SAMPLES) {
        sample.push({
          aliasRepo,
          canonicalRepo: null,
          outcome: "deferred-error",
          detail: errorDetail(error),
        });
      }
      continue;
    }

    resolvedCanonicalKeys.add(canonical.repo);
    if (canonical.repo === aliasRepo) {
      discovered.set(aliasRepo, mergeRecord(source, undefined, canonical));
      unchangedCount += 1;
      continue;
    }

    const existingTarget = discovered.get(canonical.repo);
    const merged = mergeRecord(source, existingTarget, canonical);
    discovered.delete(aliasRepo);
    discovered.set(canonical.repo, merged);
    renamedCount += 1;

    const mergedExisting = existingRepoKeys.has(canonical.repo);
    const outcome = mergedExisting
      ? "merged-existing"
      : existingTarget
        ? "merged-discovery"
        : "renamed";
    if (mergedExisting) mergedIntoExistingCount += 1;
    if (!mergedExisting && existingTarget) mergedIntoDiscoveryCount += 1;
    if (sample.length < MAX_REPORT_SAMPLES) {
      sample.push({ aliasRepo, canonicalRepo: canonical.repo, outcome });
    }
  }

  return {
    candidateCount: candidates.length,
    checkedCount,
    unchangedCount,
    renamedCount,
    mergedIntoExistingCount,
    mergedIntoDiscoveryCount,
    deferredByErrorCount,
    deferredByCapCount,
    sample,
  };
}

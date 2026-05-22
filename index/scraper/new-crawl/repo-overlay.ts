import { existsSync, readFileSync } from "node:fs";
import type { ShadowCadence, ShadowRepoIndex, ShadowRepoIndexEntry, ShadowRepoOverlay } from "./types.js";

const MUTABLE_OVERLAY_FIELDS = [
  "repoUrl",
  "state",
  "discoveredSources",
  "skillIds",
  "skillCount",
  "stars",
  "lastSeenAt",
  "lastRefreshedAt",
  "promotionReasons",
  "staleOrInvalidState",
  "topSkillId",
  "topSkillStars",
] as const;

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeRepoEntry(entry: ShadowRepoIndexEntry): ShadowRepoIndexEntry {
  return {
    ...entry,
    discoveredSources: sortUnique(entry.discoveredSources),
    skillIds: sortUnique(entry.skillIds),
    skillCount: sortUnique(entry.skillIds).length,
    trustSignals: sortUnique(entry.trustSignals),
    promotionReasons: sortUnique(entry.promotionReasons),
  };
}

function overlayComparableEntry(entry: ShadowRepoIndexEntry) {
  const normalized = normalizeRepoEntry(entry);
  return {
    repo: normalized.repo,
    repoUrl: normalized.repoUrl,
    state: normalized.state,
    discoveredSources: normalized.discoveredSources,
    skillIds: normalized.skillIds,
    skillCount: normalized.skillCount,
    stars: normalized.stars,
    lastSeenAt: normalized.lastSeenAt,
    lastRefreshedAt: normalized.lastRefreshedAt,
    trustSignals: normalized.trustSignals,
    promotionReasons: normalized.promotionReasons,
    staleOrInvalidState: normalized.staleOrInvalidState,
    isTrustedVendor: normalized.isTrustedVendor,
    isTrustedCreator: normalized.isTrustedCreator,
    isGoldBasketRepo: normalized.isGoldBasketRepo,
    topSkillId: normalized.topSkillId,
    topSkillStars: normalized.topSkillStars,
  };
}

function overlayEntriesEqual(a: ShadowRepoIndexEntry, b: ShadowRepoIndexEntry): boolean {
  return JSON.stringify(overlayComparableEntry(a)) === JSON.stringify(overlayComparableEntry(b));
}

function applyOverlayEntry(base: ShadowRepoIndexEntry, overlay: ShadowRepoIndexEntry): ShadowRepoIndexEntry {
  const next = normalizeRepoEntry(base);
  const normalizedOverlay = normalizeRepoEntry(overlay);
  for (const field of MUTABLE_OVERLAY_FIELDS) {
    next[field] = normalizedOverlay[field] as never;
  }
  return next;
}

export function loadShadowRepoOverlay(path: string): ShadowRepoOverlay | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ShadowRepoOverlay;
}

export function shouldReadShadowRepoOverlay(cadence: ShadowCadence): boolean {
  return cadence === "fast" || cadence === "combined";
}

export function shouldWriteShadowRepoOverlay(cadence: ShadowCadence): boolean {
  return cadence === "combined";
}

export function applyShadowRepoOverlay(
  cadence: ShadowCadence,
  repoIndex: ShadowRepoIndex,
  overlay: ShadowRepoOverlay | null,
): { overlayLoaded: boolean; overlayEntryCount: number } {
  if (!shouldReadShadowRepoOverlay(cadence) || !overlay) {
    return { overlayLoaded: false, overlayEntryCount: 0 };
  }

  const repoByName = new Map(repoIndex.repos.map((repo) => [repo.repo, normalizeRepoEntry(repo)]));
  for (const overlayRepo of overlay.repos) {
    const existing = repoByName.get(overlayRepo.repo);
    if (existing) {
      repoByName.set(overlayRepo.repo, applyOverlayEntry(existing, overlayRepo));
      continue;
    }
    repoByName.set(overlayRepo.repo, normalizeRepoEntry(overlayRepo));
  }

  repoIndex.repos = [...repoByName.values()].sort((a, b) => a.repo.localeCompare(b.repo));
  repoIndex.repoCount = repoIndex.repos.length;
  return {
    overlayLoaded: true,
    overlayEntryCount: overlay.repoCount,
  };
}

export function buildShadowRepoOverlay(
  currentRepoIndex: ShadowRepoIndex,
  baselineRepoIndex: ShadowRepoIndex,
  generatedAt: string,
): ShadowRepoOverlay {
  const baselineByRepo = new Map(
    baselineRepoIndex.repos.map((repo) => [repo.repo, normalizeRepoEntry(repo)]),
  );

  const repos = currentRepoIndex.repos
    .map((repo) => normalizeRepoEntry(repo))
    .filter((repo) => {
      const baseline = baselineByRepo.get(repo.repo);
      if (!baseline) return true;
      return !overlayEntriesEqual(repo, baseline);
    })
    .sort((a, b) => a.repo.localeCompare(b.repo));

  return {
    generatedAt,
    repoCount: repos.length,
    repos,
  };
}

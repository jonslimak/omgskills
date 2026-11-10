import { selectTrendingMvpCandidates, type TrendingMvpOutcome } from "./trending-admission-mvp.js";
import type { Skill } from "../types.js";
import type { SourceTrendingFeed } from "../../../scripts/source-trending-format.mjs";

export type TrendingIntakeState = {
  version: 1;
  policyDigest: string;
  reviews: Array<{ sourceId: string; checkedAt: string; outcome: TrendingMvpOutcome["status"]; reason: string }>;
};

export function readTrendingIntakeState(value: unknown): TrendingIntakeState {
  const state = value as TrendingIntakeState;
  const statuses = new Set(["added", "existing", "duplicate", "blocked", "unresolved", "failed", "temporary-failure"]);
  if (!state || state.version !== 1 || typeof state.policyDigest !== "string" || !Array.isArray(state.reviews)
    || state.reviews.length > 1000 || state.reviews.some(row => !row || typeof row.sourceId !== "string"
      || !row.sourceId.trim() || typeof row.checkedAt !== "string" || !Number.isFinite(Date.parse(row.checkedAt))
      || !statuses.has(row.outcome) || typeof row.reason !== "string")
    || new Set(state.reviews.map(row => row.sourceId.toLowerCase())).size !== state.reviews.length) {
    throw new Error("Invalid Trending intake review state");
  }
  return state;
}

export function selectTrendingIntakeCandidates(feed: SourceTrendingFeed, skills: Skill[], state: TrendingIntakeState,
  policyDigest: string, now: number) {
  const recent = state.policyDigest === policyDigest ? state.reviews.filter(row => {
    const age = now - Date.parse(row.checkedAt);
    const retryHours = row.outcome === "temporary-failure" ? 1
      : row.outcome === "failed" || row.outcome === "unresolved" ? 24 : 7 * 24;
    return age >= 0 && age < retryHours * 3600_000;
  }).map(row => row.sourceId.toLowerCase()) : [];
  return selectTrendingMvpCandidates(feed, skills, 20, now, new Set(recent));
}

export function updateTrendingIntakeState(state: TrendingIntakeState, policyDigest: string,
  outcomes: TrendingMvpOutcome[], checkedAt: string): TrendingIntakeState {
  const rows = new Map((state.policyDigest === policyDigest ? state.reviews : [])
    .filter(row => Date.parse(checkedAt) - Date.parse(row.checkedAt) < 30 * 86400_000)
    .map(row => [row.sourceId.toLowerCase(), row]));
  for (const { sourceId, status, reason } of outcomes) {
    rows.set(sourceId.toLowerCase(), { sourceId: sourceId.toLowerCase(), checkedAt, outcome: status, reason });
  }
  return readTrendingIntakeState({ version: 1, policyDigest, reviews: [...rows.values()]
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || a.sourceId.localeCompare(b.sourceId))
    .slice(0, 1000).sort((a, b) => a.sourceId.localeCompare(b.sourceId)) });
}

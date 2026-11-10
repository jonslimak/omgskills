import test from "node:test";
import assert from "node:assert/strict";
import { readTrendingIntakeState, selectTrendingIntakeCandidates, updateTrendingIntakeState } from "./trending-intake.js";
import { sourceTrendingUrl, type SourceTrendingFeed } from "../../../scripts/source-trending-format.mjs";
import { assertTrendingIntakeApplyAllowed } from "./run-trending-intake.js";

const now = Date.parse("2026-11-10T12:00:00Z");
const feed: SourceTrendingFeed = { version: 1, source: "skills.sh", board: "trending", fetchedAt: new Date(now).toISOString(),
  entries: Array.from({ length: 45 }, (_, n) => ({ source: "owner/repo", skillId: `skill-${n}`, name: `skill-${n}`,
    rank: n + 1, installs24h: 1, sourceUrl: sourceTrendingUrl("owner/repo", `skill-${n}`) })) };
const empty = { version: 1 as const, policyDigest: "policy", reviews: [] };

test("local or non-main runs cannot activate catalog writes", () => {
  assert.throws(() => assertTrendingIntakeApplyAllowed({}), /guarded main-branch/);
  assert.throws(() => assertTrendingIntakeApplyAllowed({ GITHUB_ACTIONS: "true", GITHUB_WORKFLOW: "trending-intake", GITHUB_REF: "refs/heads/test" }));
  assert.throws(() => assertTrendingIntakeApplyAllowed({ GITHUB_ACTIONS: "true", GITHUB_WORKFLOW: "content-reports", GITHUB_REF: "refs/heads/main" }));
  assert.doesNotThrow(() => assertTrendingIntakeApplyAllowed({ GITHUB_ACTIONS: "true", GITHUB_WORKFLOW: "trending-intake", GITHUB_REF: "refs/heads/main" }));
});

test("reviews advance past prior rejects while keeping the 20-candidate cap and original ranks", () => {
  const state = updateTrendingIntakeState(empty, "policy", feed.entries.slice(0, 20).map(row => ({
    sourceId: `${row.source}:${row.skillId}`, rank: row.rank, status: "blocked", reason: "reviewed-copy-content",
  })), new Date(now).toISOString());
  const selected = selectTrendingIntakeCandidates(feed, [], state, "policy", now);
  assert.equal(selected.length, 20);
  assert.deepEqual(selected.map(row => row.rank), Array.from({ length: 20 }, (_, n) => n + 21));
  assert.equal(selectTrendingIntakeCandidates(feed, [], state, "changed-policy", now)[0]?.rank, 1);
  assert.equal(selectTrendingIntakeCandidates({ ...feed, fetchedAt: new Date(now + 8 * 86400_000).toISOString() }, [], state,
    "policy", now + 8 * 86400_000)[0]?.rank, 1);
});

test("temporary failures retry after one hour; unresolved paths retry after one day", () => {
  const state = updateTrendingIntakeState(empty, "policy", [
    { sourceId: "OWNER/REPO:skill-0", rank: 1, status: "temporary-failure", reason: "timeout" },
    { sourceId: "owner/repo:skill-1", rank: 2, status: "unresolved", reason: "path-unresolved" },
  ], new Date(now - 2 * 3600_000).toISOString());
  const selected = selectTrendingIntakeCandidates(feed, [], state, "policy", now);
  assert.equal(selected[0]?.rank, 1);
  assert.ok(!selected.some(row => row.rank === 2));
});

test("review state is deterministic, bounded, validated, and case-insensitive", () => {
  const outcomes = feed.entries.map(row => ({ sourceId: `${row.source}:${row.skillId}`, rank: row.rank,
    status: "existing" as const, reason: "catalog-identity-or-path" }));
  const a = updateTrendingIntakeState(empty, "policy", outcomes, new Date(now).toISOString());
  assert.deepEqual(a, updateTrendingIntakeState(empty, "policy", [...outcomes].reverse(), new Date(now).toISOString()));
  assert.deepEqual(a, updateTrendingIntakeState(a, "policy", outcomes, new Date(now).toISOString()));
  assert.throws(() => readTrendingIntakeState({ ...a, reviews: [{ ...a.reviews[0], outcome: "trusted" }] }), /Invalid/);
  assert.throws(() => readTrendingIntakeState({ ...a, reviews: [a.reviews[0], a.reviews[0]] }), /Invalid/);
  const many = Array.from({ length: 1200 }, (_, n) => ({ sourceId: `owner/repo:${n}`, rank: n + 1,
    status: "blocked" as const, reason: "copy" }));
  assert.equal(updateTrendingIntakeState(empty, "policy", many, new Date(now).toISOString()).reviews.length, 1000);
});

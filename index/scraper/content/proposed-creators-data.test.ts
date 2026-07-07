import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProposedCreatorsReport,
  formatProposedCreatorsMarkdown,
  registeredCreatorHandleSet,
} from "./proposed-creators-data.js";

test("registeredCreatorHandleSet includes handles and aliases case-insensitively", () => {
  const registered = registeredCreatorHandleSet({
    creators: [{ handle: "OpenAI", aliases: ["Open-AI-Labs"] }],
  });

  assert.deepEqual([...registered].sort(), ["open-ai-labs", "openai"]);
});

test("buildProposedCreatorsReport excludes registered handles and aliases", () => {
  const report = buildProposedCreatorsReport({
    generatedAt: "2026-07-07T00:00:00Z",
    registry: { creators: [{ handle: "known", aliases: ["old-known"] }] },
    goldBasket: [
      { id: "known/repo:a", author_handle: "known", stars: 10_000 },
      { id: "old-known/repo:b", author_handle: "old-known", stars: 10_000 },
      { id: "new/repo:c", author_handle: "new", stars: 10_000 },
    ],
    authorLeaderboards: [
      { authorHandle: "known", stats: { skillCount: 10, totalStars: 50_000, goldBasketCount: 1 } },
      { authorHandle: "old-known", stats: { skillCount: 10, totalStars: 50_000, goldBasketCount: 1 } },
      { authorHandle: "new", stats: { skillCount: 1, totalStars: 10_000, goldBasketCount: 1 } },
    ],
  });

  assert.deepEqual(report.candidates.map((candidate) => candidate.handle), ["new"]);
});

test("gold-basket authors rank above generic high-volume authors", () => {
  const report = buildProposedCreatorsReport({
    generatedAt: "2026-07-07T00:00:00Z",
    registry: { creators: [] },
    goldBasket: [{ id: "gold/repo:skill", author_handle: "gold", stars: 500 }],
    authorLeaderboards: [
      { authorHandle: "generic", stats: { skillCount: 20, totalStars: 1_000, goldBasketCount: 0 } },
      { authorHandle: "gold", stats: { skillCount: 1, totalStars: 500, goldBasketCount: 1 } },
    ],
  });

  assert.deepEqual(report.candidates.map((candidate) => candidate.handle), ["gold", "generic"]);
  assert.match(report.candidates[0].reasons.join(","), /gold-basket/);
});

test("known bot and catalog handles are excluded even with gold-basket evidence", () => {
  const report = buildProposedCreatorsReport({
    generatedAt: "2026-07-07T00:00:00Z",
    registry: { creators: [] },
    goldBasket: [
      { id: "clawdbot/repo:skill", author_handle: "clawdbot", stars: 50_000 },
      { id: "real/repo:skill", author_handle: "real", stars: 500 },
    ],
    authorLeaderboards: [
      { authorHandle: "clawdbot", stats: { skillCount: 5, totalStars: 50_000, goldBasketCount: 1 } },
      { authorHandle: "real", stats: { skillCount: 1, totalStars: 500, goldBasketCount: 1 } },
    ],
  });

  assert.deepEqual(report.candidates.map((candidate) => candidate.handle), ["real"]);
});

test("author leaderboard evidence and output are deterministic", () => {
  const report = buildProposedCreatorsReport({
    generatedAt: "2026-07-07T00:00:00Z",
    registry: { creators: [] },
    goldBasket: [],
    authorLeaderboards: [
      { authorHandle: "beta", stats: { skillCount: 3, totalStars: 1_000, totalInstalls: 0, bestSkill: { id: "beta/r:s" } } },
      { authorHandle: "alpha", stats: { skillCount: 3, totalStars: 1_000, totalInstalls: 0, bestSkill: { id: "alpha/r:s" } } },
    ],
  });

  assert.deepEqual(report.candidates.map((candidate) => candidate.handle), ["alpha", "beta"]);
  assert.deepEqual(report.candidates[0], {
    handle: "alpha",
    suggestedAction: "review-for-watch",
    score: 21,
    reasons: ["1k+ total stars", "3+ skills"],
    skillCount: 3,
    goldBasketCount: 0,
    totalStars: 1_000,
    totalInstalls: 0,
    sampleSkillIds: ["alpha/r:s"],
  });

  assert.match(formatProposedCreatorsMarkdown(report), /`alpha` \| 21 \| 1k\+ total stars, 3\+ skills/);
});

test("buildProposedCreatorsReport prefers editorial score when available", () => {
  const report = buildProposedCreatorsReport({
    generatedAt: "2026-07-07T00:00:00Z",
    registry: { creators: [] },
    goldBasket: [],
    authorLeaderboards: [
      {
        authorHandle: "editorial",
        stats: {
          skillCount: 1,
          totalStars: 0,
          editorialScore: 123,
          editorialScoreReasons: ["gold + installs"],
          bestSkill: { id: "editorial/repo:skill" },
        },
      },
    ],
  });

  assert.equal(report.candidates[0]?.handle, "editorial");
  assert.equal(report.candidates[0]?.score, 123);
  assert.deepEqual(report.candidates[0]?.reasons, ["gold + installs"]);
});

test("recent Crawl 4 bootstrap evidence contributes a reason", () => {
  const report = buildProposedCreatorsReport({
    generatedAt: "2026-07-07T00:00:00Z",
    registry: { creators: [] },
    goldBasket: [],
    authorLeaderboards: [{ authorHandle: "fresh", stats: { skillCount: 1, totalStars: 0, bestSkill: { id: "fresh/repo:skill" } } }],
    shadowReport: { bootstrappedRepoSample: [{ repo: "fresh/repo", candidateId: "fresh/repo:skill" }] },
  });

  assert.equal(report.candidates[0]?.score, 8);
  assert.deepEqual(report.candidates[0]?.reasons, ["recent Crawl 4 bootstrap evidence"]);
});

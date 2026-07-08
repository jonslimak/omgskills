import test from "node:test";
import assert from "node:assert/strict";
import { buildRemovalAuditReport, renderRemovalAuditMarkdown } from "./removal-audit.js";
import type { SuppressedSkillRule } from "./types.js";

function suppressed(overrides: Partial<SuppressedSkillRule> & Pick<SuppressedSkillRule, "id">): SuppressedSkillRule {
  const { id, ...rest } = overrides;
  return {
    id,
    reason: "same-publisher",
    replacementId: "owner/repo:keep",
    confidence: "high",
    stagedAt: "2026-07-01T00:00:00.000Z",
    ...rest,
  };
}

test("groups suppressions by reason confidence and stagedAt", () => {
  const report = buildRemovalAuditReport({
    generatedAt: "2026-07-08T00:00:00.000Z",
    currentSkillIds: new Set(["owner/repo:keep", "trusted/repo:keep"]),
    doNotCrawl: { repos: [], owners: [] },
    suppressedSkills: [
      suppressed({ id: "owner/repo:drop-b", reason: "same-publisher", stagedAt: "2026-07-02T00:00:00.000Z" }),
      suppressed({ id: "owner/repo:drop-a", reason: "same-publisher", stagedAt: "2026-07-02T00:00:00.000Z" }),
      suppressed({
        id: "other/repo:drop",
        reason: "trusted-owner",
        replacementId: "trusted/repo:keep",
        confidence: "medium",
        stagedAt: "2026-07-01T00:00:00.000Z",
      }),
    ],
  });

  assert.equal(report.suppressedSkillCount, 3);
  assert.deepEqual(report.reasonCounts, { "same-publisher": 2, "trusted-owner": 1 });
  assert.deepEqual(report.confidenceCounts, { high: 2, medium: 1 });
  assert.equal(report.batchCount, 2);
  assert.deepEqual(
    report.batches.map((batch) => [batch.stagedAt, batch.count]),
    [
      ["2026-07-01T00:00:00.000Z", 1],
      ["2026-07-02T00:00:00.000Z", 2],
    ],
  );
  assert.deepEqual(report.batches[1]?.sampleIds, ["owner/repo:drop-a", "owner/repo:drop-b"]);
});

test("reports missing replacement ids as warnings", () => {
  const report = buildRemovalAuditReport({
    generatedAt: "2026-07-08T00:00:00.000Z",
    currentSkillIds: new Set(["owner/repo:keep"]),
    doNotCrawl: { repos: [], owners: [] },
    suppressedSkills: [
      suppressed({ id: "owner/repo:drop", replacementId: "owner/repo:keep" }),
      suppressed({ id: "other/repo:drop", replacementId: "missing/repo:skill" }),
    ],
  });

  assert.equal(report.missingReplacementCount, 1);
  assert.deepEqual(report.missingReplacementCategoryCounts, { "missing-replacement": 1 });
  assert.deepEqual(report.missingReplacementIds, [{ id: "other/repo:drop", replacementId: "missing/repo:skill" }]);
});

test("categorizes missing replacement warnings", () => {
  const report = buildRemovalAuditReport({
    generatedAt: "2026-07-08T00:00:00.000Z",
    currentSkillIds: new Set(),
    doNotCrawl: { repos: [], owners: [] },
    suppressedSkills: [
      suppressed({ id: "Owner/Repo:Skill", replacementId: "owner/repo:skill" }),
      suppressed({ id: "a/repo:drop", replacementId: "a/repo:keep" }),
      suppressed({ id: "b/repo:drop", replacementId: "catalog/awesome-skills:keep" }),
      suppressed({ id: "c/repo:drop", replacementId: "d/repo:also-drop" }),
      suppressed({ id: "d/repo:also-drop", replacementId: "d/repo:keep" }),
      suppressed({ id: "e/repo:drop", replacementId: "f/repo:missing" }),
    ],
  });

  assert.deepEqual(report.missingReplacementCategoryCounts, {
    "case-only-id-difference": 1,
    "catalog-like-replacement-filtered": 1,
    "missing-replacement": 1,
    "replacement-suppressed": 1,
    "same-repo-replacement-filtered": 2,
  });
});

test("includes do-not-crawl repo and owner counts", () => {
  const report = buildRemovalAuditReport({
    generatedAt: "2026-07-08T00:00:00.000Z",
    doNotCrawl: {
      repos: [
        { repo: "owner/catalog", reason: "catalog" },
        { repo: "owner/unsafe", reason: "unsafe" },
      ],
      owners: [{ owner: "spam-owner", reason: "spam" }],
    },
    suppressedSkills: [],
  });

  assert.equal(report.doNotCrawl.repoCount, 2);
  assert.equal(report.doNotCrawl.ownerCount, 1);
  assert.deepEqual(report.doNotCrawl.reasonCounts, { catalog: 1, spam: 1, unsafe: 1 });
});

test("reports top removed repos and owners deterministically", () => {
  const report = buildRemovalAuditReport({
    generatedAt: "2026-07-08T00:00:00.000Z",
    doNotCrawl: { repos: [], owners: [] },
    suppressedSkills: [
      suppressed({ id: "b/repo:two" }),
      suppressed({ id: "a/repo:one" }),
      suppressed({ id: "a/repo:two" }),
    ],
  });

  assert.deepEqual(report.topRemovedRepos.slice(0, 2), [
    { repo: "a/repo", count: 2 },
    { repo: "b/repo", count: 1 },
  ]);
  assert.deepEqual(report.topRemovedOwners.slice(0, 2), [
    { owner: "a", count: 2 },
    { owner: "b", count: 1 },
  ]);
});

test("markdown states the report is documentation only", () => {
  const report = buildRemovalAuditReport({
    generatedAt: "2026-07-08T00:00:00.000Z",
    doNotCrawl: { repos: [], owners: [] },
    suppressedSkills: [],
  });
  const markdown = renderRemovalAuditMarkdown(report);

  assert.match(markdown, /removal-audit is documentation only/);
  assert.match(markdown, /suppressed-skills\.json prevents skill-level duplicates/);
  assert.match(markdown, /do-not-crawl\.json prevents blocked repos and owners/);
});

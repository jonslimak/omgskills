import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildDirectoryCreatorsReview, DIRECTORY_REVIEW_BATCHES, renderDirectoryCreatorsReview, writeDirectoryCreatorsReview } from "./build-directory-creators-review.js";

function fixture() {
  return {
    generatedAt: "2026-10-25T00:00:00.000Z",
    creators: { creators: [
      { handle: "NewName", aliases: ["OldName"], roles: ["creator" as const], watch: true, featured: false },
      { handle: "Existing", roles: ["creator" as const], watch: true, featured: true },
    ] },
    collections: { authorOverrides: {
      OLDNAME: { title: "Display Name", description: "Existing editorial description", xUrl: "https://x.com/known", isCompany: true },
    }, collections: [] },
    skills: [
      { id: "publisher/repo:one", name: "One", author_handle: "OLDNAME", stars: 20, description: "Skill One", github_url: "https://github.com/publisher/repo" },
      { id: "newname/repo:two", name: "Two", author_handle: "NewName", stars: 10 },
      { id: "existing/repo:three", name: "Three", author_handle: "Existing" },
    ],
    batches: [
      { name: "batch-b", addedSkills: [{ id: "publisher/repo:one" }] },
      { name: "batch-a", addedSkills: [{ id: "publisher/repo:one" }, { id: "existing/repo:three" }] },
    ],
  };
}

test("deduplicates cumulative imports and resolves authors and editorial aliases case-insensitively", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildDirectoryCreatorsReview(input);
  assert.equal(result.summary.importedSkillCount, 2);
  assert.equal(result.summary.creatorCount, 2);
  assert.equal(result.summary.existingFeaturedCount, 1);
  assert.equal(result.summary.proposedNewFeaturedCount, 1);
  const creator = result.creators.find(entry => entry.handle === "NewName")!;
  assert.equal(creator.importedSkillCount, 1);
  assert.equal(creator.totalPublishedSkillCount, 2);
  assert.deepEqual(creator.allPublishedSkillIds, ["newname/repo:two", "publisher/repo:one"]);
  assert.equal(creator.editorial.title, "Display Name");
  assert.equal(creator.editorial.isCompany, true);
  assert.equal(creator.needsReview.xProfile, true);
  assert.ok(!result.creators.some(entry => entry.handle === "publisher"));
  assert.deepEqual(input, before);
});

test("report output is stable when catalog and batch order changes", () => {
  const first = fixture();
  const second = fixture();
  second.skills.reverse();
  second.batches.reverse();
  assert.deepEqual(buildDirectoryCreatorsReview(first), buildDirectoryCreatorsReview(second));
  assert.equal(renderDirectoryCreatorsReview(buildDirectoryCreatorsReview(first)), renderDirectoryCreatorsReview(buildDirectoryCreatorsReview(second)));
});

test("excludes reviewed single-skill individuals from review only", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildDirectoryCreatorsReview({ ...input, singleSkillIndividuals: [
    { handle: "EXISTING", evidenceUrl: "https://github.com/Existing", notes: "Verified personal profile" },
    { handle: "oldname", evidenceUrl: "https://github.com/NewName", notes: "Multiple skills; retain" },
  ] });
  assert.deepEqual(result.creators.map(entry => entry.handle), ["NewName"]);
  assert.equal(result.summary.excludedSingleSkillIndividualCount, 1);
  assert.equal(result.summary.importedSkillCount, 2);
  assert.equal(result.summary.currentFeaturedCount, 1);
  assert.equal(result.excludedSingleSkillIndividuals[0].handle, "Existing");
  assert.match(renderDirectoryCreatorsReview(result), /Excluded from review: 1/);
  assert.deepEqual(input, before);
});

test("retains single-skill companies and unknown accounts", () => {
  const input = fixture();
  input.skills = input.skills.filter(skill => skill.id !== "newname/repo:two");
  const result = buildDirectoryCreatorsReview({ ...input, singleSkillIndividuals: [
    { handle: "oldname", evidenceUrl: "https://github.com/NewName", notes: "Stale review; explicit company classification wins" },
  ] });
  assert.equal(result.summary.creatorCount, 2);
  assert.equal(result.summary.excludedSingleSkillIndividualCount, 0);
});

test("explicit individual classification excludes a one-skill author", () => {
  const input = fixture();
  input.collections.authorOverrides.OLDNAME.isCompany = false;
  input.skills = input.skills.filter(skill => skill.id !== "newname/repo:two");
  const result = buildDirectoryCreatorsReview(input);
  assert.deepEqual(result.creators.map(entry => entry.handle), ["Existing"]);
  assert.equal(result.excludedSingleSkillIndividuals[0].handle, "NewName");
});

test("unknown descriptions, company classification, and X links remain pending rather than invented", () => {
  const result = buildDirectoryCreatorsReview(fixture());
  const existing = result.creators.find(entry => entry.handle === "Existing")!;
  assert.equal(existing.editorial.description, null);
  assert.equal(existing.editorial.isCompany, null);
  assert.equal(existing.editorial.xUrl, null);
  assert.equal(existing.needsReview.description, true);
  assert.equal(existing.needsReview.classification, true);
  assert.equal(existing.suggestedAction, "preserve-existing-profile");
  assert.match(renderDirectoryCreatorsReview(result), /Unknown; do not guess/);
});

test("missing skills and blank authors are visible and block readiness", () => {
  const input = fixture();
  input.skills[0].author_handle = "";
  input.batches[0].addedSkills.push({ id: "missing/repo:gone" });
  const result = buildDirectoryCreatorsReview(input);
  assert.deepEqual(result.summary.missingSkillIds, ["missing/repo:gone"]);
  assert.deepEqual(result.summary.unattributedSkillIds, ["publisher/repo:one"]);
  assert.equal(result.summary.readyForEditorialReview, false);
});

test("unregistered catalog authors are reported instead of silently added to seeds", () => {
  const input = fixture();
  input.skills[0].author_handle = "unknown";
  const result = buildDirectoryCreatorsReview(input);
  assert.deepEqual(result.summary.missingRegistryHandles, ["unknown"]);
  assert.equal(result.summary.readyForEditorialReview, false);
});

test("local report generation changes only report outputs, not source data", () => {
  const root = mkdtempSync(join(tmpdir(), "directory-creators-review-"));
  try {
    const input = fixture();
    const files: Record<string, unknown> = {
      "seeds/creators.json": input.creators,
      "curations/collections.json": input.collections,
      "skills.json": input.skills,
      ...Object.fromEntries(DIRECTORY_REVIEW_BATCHES.map(name => [`reports/${name}/summary.json`, { addedSkills: [{ id: "publisher/repo:one" }] }])),
    };
    for (const [path, value] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), JSON.stringify(value) + "\n");
    }
    const before = Object.fromEntries(Object.keys(files).map(path => [path, readFileSync(join(root, path), "utf8")]));
    const report = writeDirectoryCreatorsReview(root, input.generatedAt);
    assert.equal(report.summary.importedSkillCount, 1);
    for (const [path, content] of Object.entries(before)) assert.equal(readFileSync(join(root, path), "utf8"), content);
    assert.equal(JSON.parse(readFileSync(join(root, "reports/directory-creators-review/review.json"), "utf8")).summary.creatorCount, 1);
    assert.match(readFileSync(join(root, "reports/directory-creators-review/review.md"), "utf8"), /NewName/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

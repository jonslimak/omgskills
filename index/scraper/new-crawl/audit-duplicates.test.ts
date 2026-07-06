import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDuplicateAudit,
  buildCatalogCopySuppressionEntries,
  buildExactShaCanonicalPlan,
  buildHighConfidenceSuppressionEntries,
  buildPartialMediumSuppressionEntries,
  isCollectionLikeDuplicateCopy,
  buildSameRepoSuppressionPlan,
  type DuplicateAuditSkill,
} from "./audit-duplicates.js";

function skill(overrides: Partial<DuplicateAuditSkill> & Pick<DuplicateAuditSkill, "id">): DuplicateAuditSkill {
  const { id, ...rest } = overrides;
  return {
    id,
    name: "Skill",
    github_url: "https://github.com/owner/repo",
    install_cmd: "install one",
    author_handle: "owner",
    tags: [],
    stars: 0,
    last_updated: "2026-05-22T00:00:00Z",
    first_seen: "2026-05-22",
    skill_md_sha: "sha-one",
    provenance_type: "original",
    ...rest,
  } as DuplicateAuditSkill;
}

function category(audit: ReturnType<typeof buildDuplicateAudit>, name: string) {
  const result = audit.categories.find((row) => row.category === name);
  assert.ok(result);
  return result;
}

test("groups same SHA duplicates and ignores missing SHA", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "a/repo:one", skill_md_sha: "same" }),
    skill({ id: "b/repo:two", skill_md_sha: "same" }),
    skill({ id: "c/repo:missing", skill_md_sha: "" }),
  ]);
  const result = category(audit, "skill_md_sha");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.affectedSkillCount, 2);
  assert.equal(result.clusters[0]?.key, "same");
});

test("groups same author and normalized name duplicates", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "a/repo:one", author_handle: "Owner", name: "  My   Skill " }),
    skill({ id: "a/repo:two", author_handle: "owner", name: "my skill" }),
    skill({ id: "b/repo:three", author_handle: "other", name: "my skill" }),
  ]);
  const result = category(audit, "author_name");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.clusters[0]?.key, "owner\tmy skill");
});

test("groups same repo and normalized name duplicates", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "owner/repo:one", github_url: "https://github.com/Owner/Repo", name: "Deploy Skill" }),
    skill({ id: "owner/repo:two", github_url: "https://github.com/owner/repo?tab=readme", name: "deploy   skill" }),
    skill({ id: "owner/other:three", github_url: "https://github.com/owner/other", name: "deploy skill" }),
  ]);
  const result = category(audit, "repo_name");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.clusters[0]?.key, "owner/repo\tdeploy skill");
});

test("groups normalized install command duplicates", () => {
  const audit = buildDuplicateAudit([
    skill({ id: "a/repo:one", install_cmd: "npm   install   a" }),
    skill({ id: "b/repo:two", install_cmd: "npm install a" }),
    skill({ id: "c/repo:three", install_cmd: "npm install b" }),
  ]);
  const result = category(audit, "install_cmd");

  assert.equal(result.clusterCount, 1);
  assert.equal(result.clusters[0]?.key, "npm install a");
});

test("cluster output is deterministic", () => {
  const input = [
    skill({ id: "z/repo:low", skill_md_sha: "same", stars: 1 }),
    skill({ id: "a/repo:high", skill_md_sha: "same", stars: 10 }),
    skill({ id: "m/repo:mid", skill_md_sha: "same", stars: 10 }),
  ];
  const first = buildDuplicateAudit(input);
  const second = buildDuplicateAudit([...input].reverse());

  assert.deepEqual(first, second);
  assert.deepEqual(
    category(first, "skill_md_sha").clusters[0]?.samples.map((row) => row.id),
    ["a/repo:high", "m/repo:mid", "z/repo:low"],
  );
});

test("same repo suppression plan proposes exact SHA duplicates", () => {
  const plan = buildSameRepoSuppressionPlan([
    skill({ id: "owner/repo:one", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "same" }),
    skill({ id: "owner/repo:two", name: " deploy ", github_url: "https://github.com/owner/repo", skill_md_sha: "same" }),
    skill({ id: "owner/other:three", name: "Deploy", github_url: "https://github.com/owner/other", skill_md_sha: "same" }),
  ]);

  assert.equal(plan.candidateClusterCount, 1);
  assert.equal(plan.suppressCandidateCount, 1);
  assert.equal(plan.candidates[0]?.repo, "owner/repo");
  assert.equal(plan.candidates[0]?.normalizedName, "deploy");
  assert.equal(plan.candidates[0]?.skillMdSha, "same");
  assert.equal(plan.candidates[0]?.keepId, "owner/repo:one");
  assert.deepEqual(plan.candidates[0]?.suppressIds, ["owner/repo:two"]);
  assert.deepEqual(plan.candidates[0]?.suggestedSuppressionEntries, [
    {
      id: "owner/repo:two",
      reason: "same-repo-same-name-same-sha",
      replacementId: "owner/repo:one",
    },
  ]);
});

test("same repo suppression plan keeps different SHA duplicates review-only", () => {
  const plan = buildSameRepoSuppressionPlan([
    skill({ id: "owner/repo:one", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "sha-one" }),
    skill({ id: "owner/repo:two", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "sha-two" }),
  ]);

  assert.equal(plan.candidateClusterCount, 0);
  assert.equal(plan.suppressCandidateCount, 0);
  assert.equal(plan.reviewOnlyClusterCount, 1);
  assert.equal(plan.reviewOnlyAffectedSkillCount, 2);
  assert.equal(plan.reviewOnlyClusters[0]?.reason, "same-repo-same-name-different-or-missing-sha");
});

test("same repo suppression plan keeps missing SHA duplicates review-only", () => {
  const plan = buildSameRepoSuppressionPlan([
    skill({ id: "owner/repo:one", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "" }),
    skill({ id: "owner/repo:two", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "" }),
  ]);

  assert.equal(plan.candidateClusterCount, 0);
  assert.equal(plan.reviewOnlyClusterCount, 1);
});

test("same repo suppression plan selects canonical skill deterministically", () => {
  const input = [
    skill({
      id: "owner/repo:z",
      name: "Deploy",
      github_url: "https://github.com/owner/repo",
      skill_md_sha: "same",
      skill_md_path: "skills/deploy/SKILL.md",
      stars: 100,
    }),
    skill({
      id: "owner/repo:a",
      name: "Deploy",
      github_url: "https://github.com/owner/repo",
      skill_md_sha: "same",
      skill_md_path: "SKILL.md",
      stars: 1,
    }),
    skill({
      id: "owner/repo:b",
      name: "Deploy",
      github_url: "https://github.com/owner/repo",
      skill_md_sha: "same",
      skill_md_path: "SKILL.md",
      stars: 1,
    }),
  ];

  const first = buildSameRepoSuppressionPlan(input);
  const second = buildSameRepoSuppressionPlan([...input].reverse());

  assert.deepEqual(first, second);
  assert.equal(first.candidates[0]?.keepId, "owner/repo:a");
  assert.deepEqual(first.candidates[0]?.suppressIds, ["owner/repo:b", "owner/repo:z"]);
});

test("same repo suppression plan prefers base id over suffixed ids", () => {
  const plan = buildSameRepoSuppressionPlan([
    skill({
      id: "owner/repo:deploy-pratikkadam254",
      name: "Deploy",
      github_url: "https://github.com/owner/repo",
      skill_md_sha: "same",
      skill_md_path: "SKILL.md",
      stars: 100,
    }),
    skill({
      id: "owner/repo:deploy",
      name: "Deploy",
      github_url: "https://github.com/owner/repo",
      skill_md_sha: "same",
      skill_md_path: "skills/deploy/SKILL.md",
      stars: 1,
    }),
  ]);

  assert.equal(plan.candidates[0]?.keepId, "owner/repo:deploy");
  assert.deepEqual(plan.candidates[0]?.suppressIds, ["owner/repo:deploy-pratikkadam254"]);
});

test("same repo suppression plan falls back to stars then id", () => {
  const plan = buildSameRepoSuppressionPlan([
    skill({ id: "owner/repo:low", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "same", skill_md_path: "__RESOLVE__", stars: 1 }),
    skill({ id: "owner/repo:high-b", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "same", skill_md_path: "__RESOLVE__", stars: 10 }),
    skill({ id: "owner/repo:high-a", name: "Deploy", github_url: "https://github.com/owner/repo", skill_md_sha: "same", skill_md_path: "__RESOLVE__", stars: 10 }),
  ]);

  assert.equal(plan.candidates[0]?.keepId, "owner/repo:high-a");
  assert.deepEqual(plan.candidates[0]?.suppressIds, ["owner/repo:high-b", "owner/repo:low"]);
});

test("exact SHA canonical plan resolves same publisher clusters as high confidence", () => {
  const plan = buildExactShaCanonicalPlan([
    skill({ id: "owner/repo:base", name: "Base", github_url: "https://github.com/owner/repo", skill_md_sha: "same" }),
    skill({ id: "owner/repo:base-copy", name: "Base", github_url: "https://github.com/owner/repo", skill_md_sha: "same" }),
  ]);

  assert.equal(plan.candidateClusterCount, 1);
  assert.equal(plan.suppressCandidateCount, 1);
  assert.equal(plan.candidates[0]?.keepId, "owner/repo:base");
  assert.equal(plan.candidates[0]?.reason, "same-publisher");
  assert.equal(plan.candidates[0]?.confidence, "high");
  assert.equal(plan.suppressCandidateCountByReason["same-publisher"], 1);
  assert.equal(plan.suppressCandidateCountByConfidence.high, 1);
  assert.deepEqual(plan.candidates[0]?.suggestedSuppressionEntries, [
    {
      id: "owner/repo:base-copy",
      reason: "same-publisher",
      confidence: "high",
      replacementId: "owner/repo:base",
    },
  ]);
});

test("exact SHA canonical plan resolves unique trusted owner clusters as high confidence", () => {
  const plan = buildExactShaCanonicalPlan([
    skill({ id: "random/repo:skill", github_url: "https://github.com/random/repo", skill_md_sha: "same", stars: 500 }),
    skill({ id: "openai/codex:skill", github_url: "https://github.com/openai/codex", skill_md_sha: "same", stars: 10 }),
  ]);

  assert.equal(plan.candidates[0]?.keepId, "openai/codex:skill");
  assert.equal(plan.candidates[0]?.reason, "trusted-owner");
  assert.equal(plan.candidates[0]?.confidence, "high");
});

test("exact SHA canonical plan resolves unique trusted repo clusters as high confidence", () => {
  const plan = buildExactShaCanonicalPlan([
    skill({ id: "random/repo:skill", github_url: "https://github.com/random/repo", skill_md_sha: "same", stars: 500 }),
    skill({ id: "posthog/posthog:skill", github_url: "https://github.com/posthog/posthog", skill_md_sha: "same", stars: 10 }),
  ]);

  assert.equal(plan.candidates[0]?.keepId, "posthog/posthog:skill");
  assert.equal(plan.candidates[0]?.reason, "trusted-owner");
  assert.equal(plan.candidates[0]?.confidence, "high");
});

test("exact SHA canonical plan resolves clear star leaders as medium confidence", () => {
  const plan = buildExactShaCanonicalPlan([
    skill({ id: "leader/repo:skill", github_url: "https://github.com/leader/repo", skill_md_sha: "same", stars: 500 }),
    skill({ id: "copy/repo:skill", github_url: "https://github.com/copy/repo", skill_md_sha: "same", stars: 49 }),
  ]);

  assert.equal(plan.candidates[0]?.keepId, "leader/repo:skill");
  assert.equal(plan.candidates[0]?.reason, "clear-star-leader");
  assert.equal(plan.candidates[0]?.confidence, "medium");
});

test("exact SHA canonical plan does not choose catalog repo as star leader", () => {
  const plan = buildExactShaCanonicalPlan(
    [
      skill({ id: "catalog/awesome-skills:skill", github_url: "https://github.com/catalog/awesome-skills", skill_md_sha: "same", stars: 5000 }),
      skill({ id: "direct/repo:skill", github_url: "https://github.com/direct/repo", skill_md_sha: "same", stars: 50 }),
    ],
    { catalogRepoRules: [{ repo: "catalog/awesome-skills", defaultProvenanceType: "catalog" }] },
  );

  assert.equal(plan.candidateClusterCount, 1);
  assert.equal(plan.candidates[0]?.keepId, "direct/repo:skill");
  assert.equal(plan.candidates[0]?.reason, "clear-star-leader");
  assert.equal(plan.candidates[0]?.confidence, "medium");
});

test("exact SHA canonical plan leaves catalog-led ambiguous clusters review-only", () => {
  const plan = buildExactShaCanonicalPlan(
    [
      skill({ id: "catalog/awesome-skills:skill", github_url: "https://github.com/catalog/awesome-skills", skill_md_sha: "same", stars: 5000 }),
      skill({ id: "direct/one:skill", github_url: "https://github.com/direct/one", skill_md_sha: "same", stars: 50 }),
      skill({ id: "direct/two:skill", github_url: "https://github.com/direct/two", skill_md_sha: "same", stars: 10 }),
    ],
    { catalogRepoRules: [{ repo: "catalog/awesome-skills", defaultProvenanceType: "catalog" }] },
  );

  assert.equal(plan.candidateClusterCount, 0);
  assert.equal(plan.reviewOnlyClusterCount, 1);
});

test("exact SHA canonical plan leaves all-catalog clusters review-only", () => {
  const plan = buildExactShaCanonicalPlan(
    [
      skill({ id: "catalog/one:skill", github_url: "https://github.com/catalog/one", skill_md_sha: "same", stars: 5000 }),
      skill({ id: "catalog/two:skill", github_url: "https://github.com/catalog/two", skill_md_sha: "same", stars: 1000 }),
    ],
    {
      catalogRepoRules: [
        { repo: "catalog/one", defaultProvenanceType: "catalog" },
        { repo: "catalog/two", defaultProvenanceType: "catalog" },
      ],
    },
  );

  assert.equal(plan.candidateClusterCount, 0);
  assert.equal(plan.reviewOnlyClusterCount, 1);
});

test("exact SHA canonical plan keeps ambiguous exact duplicates review-only", () => {
  const plan = buildExactShaCanonicalPlan([
    skill({ id: "one/repo:skill", github_url: "https://github.com/one/repo", skill_md_sha: "same", stars: 5 }),
    skill({ id: "two/repo:skill", github_url: "https://github.com/two/repo", skill_md_sha: "same", stars: 4 }),
  ]);

  assert.equal(plan.candidateClusterCount, 0);
  assert.equal(plan.suppressCandidateCount, 0);
  assert.equal(plan.reviewOnlyClusterCount, 1);
  assert.equal(plan.reviewOnlyAffectedSkillCount, 2);
  assert.equal(plan.reviewOnlyClusters[0]?.reason, "ambiguous-exact-sha");
});

test("high-confidence suppression entries exclude medium-confidence star leaders", () => {
  const plan = buildExactShaCanonicalPlan([
    skill({ id: "owner/repo:base", name: "Base", github_url: "https://github.com/owner/repo", skill_md_sha: "same-publisher" }),
    skill({ id: "owner/repo:base-copy", name: "Base", github_url: "https://github.com/owner/repo", skill_md_sha: "same-publisher" }),
    skill({ id: "leader/repo:skill", github_url: "https://github.com/leader/repo", skill_md_sha: "star-leader", stars: 500 }),
    skill({ id: "copy/repo:skill", github_url: "https://github.com/copy/repo", skill_md_sha: "star-leader", stars: 49 }),
  ]);

  assert.deepEqual(buildHighConfidenceSuppressionEntries(plan, "2026-07-06T00:00:00.000Z"), [
    {
      id: "owner/repo:base-copy",
      reason: "same-publisher",
      replacementId: "owner/repo:base",
      confidence: "high",
      stagedAt: "2026-07-06T00:00:00.000Z",
    },
  ]);
});

test("collection-like duplicate classifier matches common catalog and mirror paths", () => {
  assert.equal(isCollectionLikeDuplicateCopy("owner/awesome-skills:skill"), true);
  assert.equal(isCollectionLikeDuplicateCopy("owner/repo:public/skills/foo"), true);
  assert.equal(isCollectionLikeDuplicateCopy("owner/repo:assets/skills/foo"), true);
  assert.equal(isCollectionLikeDuplicateCopy("owner/direct-repo:skill"), false);
});

test("partial medium suppression writes collection-like copied skills only", () => {
  const skills = [
    skill({ id: "leader/repo:skill", github_url: "https://github.com/leader/repo", skill_md_sha: "same", stars: 500 }),
    skill({ id: "copy/awesome-skills:skill", github_url: "https://github.com/copy/awesome-skills", skill_md_sha: "same", stars: 20 }),
    skill({ id: "direct/copy:skill", github_url: "https://github.com/direct/copy", skill_md_sha: "same", stars: 20 }),
  ];
  const plan = buildExactShaCanonicalPlan(skills);

  assert.deepEqual(buildPartialMediumSuppressionEntries(plan, skills, "2026-07-06T00:00:00.000Z"), [
    {
      id: "copy/awesome-skills:skill",
      reason: "collection-like-copy",
      replacementId: "leader/repo:skill",
      confidence: "high",
      stagedAt: "2026-07-06T00:00:00.000Z",
    },
  ]);
});

test("partial medium suppression writes very low-star copied skills", () => {
  const skills = [
    skill({ id: "leader/repo:skill", github_url: "https://github.com/leader/repo", skill_md_sha: "same", stars: 500 }),
    skill({ id: "copy/repo:skill", github_url: "https://github.com/copy/repo", skill_md_sha: "same", stars: 5 }),
    skill({ id: "direct/copy:skill", github_url: "https://github.com/direct/copy", skill_md_sha: "same", stars: 20 }),
  ];
  const plan = buildExactShaCanonicalPlan(skills);

  assert.deepEqual(buildPartialMediumSuppressionEntries(plan, skills, "2026-07-06T00:00:00.000Z"), [
    {
      id: "copy/repo:skill",
      reason: "low-signal-copy",
      replacementId: "leader/repo:skill",
      confidence: "high",
      stagedAt: "2026-07-06T00:00:00.000Z",
    },
  ]);
});

test("partial medium suppression does not trust collection-like keepers", () => {
  const skills = [
    skill({ id: "leader/awesome-skills:skill", github_url: "https://github.com/leader/awesome-skills", skill_md_sha: "same", stars: 500 }),
    skill({ id: "copy/repo:skill", github_url: "https://github.com/copy/repo", skill_md_sha: "same", stars: 5 }),
  ];
  const plan = buildExactShaCanonicalPlan(skills);

  assert.deepEqual(buildPartialMediumSuppressionEntries(plan, skills, "2026-07-06T00:00:00.000Z"), []);
});

test("catalog-copy suppression entries include only catalog-marked copies", () => {
  const skills = [
    skill({ id: "leader/repo:skill", github_url: "https://github.com/leader/repo", skill_md_sha: "same", stars: 500 }),
    skill({ id: "catalog/awesome-skills:skill", github_url: "https://github.com/catalog/awesome-skills", skill_md_sha: "same", stars: 100 }),
    skill({ id: "copy/repo:skill", github_url: "https://github.com/copy/repo", skill_md_sha: "same", stars: 5 }),
  ];
  const catalogRepoRules = [{ repo: "catalog/awesome-skills", defaultProvenanceType: "catalog" as const }];
  const plan = buildExactShaCanonicalPlan(skills, { catalogRepoRules });

  assert.deepEqual(
    buildCatalogCopySuppressionEntries(plan, skills, catalogRepoRules, "2026-07-06T00:00:00.000Z"),
    [
      {
        id: "catalog/awesome-skills:skill",
        reason: "catalog-copy",
        replacementId: "leader/repo:skill",
        confidence: "high",
        stagedAt: "2026-07-06T00:00:00.000Z",
      },
    ],
  );
});

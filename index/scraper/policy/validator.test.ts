import assert from "node:assert/strict";
import test from "node:test";
import type { LoadedPolicySources, PolicySources } from "./types.js";
import {
  blockingPolicyIssues,
  validatePolicy,
  validatePolicyStructure,
} from "./validator.js";

function fixture(overrides: Partial<PolicySources> = {}): LoadedPolicySources {
  const sources: PolicySources = {
    creators: { creators: [{ handle: "openai", roles: ["vendor"], watch: true, featured: true }] },
    collections: {
      authorOverrides: { openai: { featuredSkillIds: ["openai/codex:review"] } },
      collections: [{
        id: "starter-pack",
        type: "topic",
        title: "Starter Pack",
        subtitle: "Useful skills",
        featuredSkillIds: ["openai/codex:review"],
        skillIds: ["openai/codex:review"],
      }],
    },
    officialRepos: { tier1: ["openai/codex"], tier2: [] },
    manualIncludeRepos: { include: [] },
    doNotCrawl: { repos: [], owners: [] },
    rootSkillInvalid: { repos: [] },
    suppressedSkills: { skills: [] },
    repoOverrides: [],
    catalogRepos: [],
    provenanceOverrides: [],
    skillEquivalenceOverrides: { version: 1, decisions: [] },
    ...overrides,
  };
  const paths = Object.fromEntries(
    Object.keys(sources).map((key) => [key, `/policy/${key}.json`]),
  ) as LoadedPolicySources["paths"];
  return { raw: sources, paths };
}

const catalogContext = {
  publishedSkillIds: new Set(["openai/codex:review"]),
  publishedAuthorHandles: new Set(["openai"]),
  suppressionCandidateSkillIds: new Set(["openai/codex:review"]),
  existingSuppressedSkillIds: new Set<string>(),
};

test("accepts a valid complete policy", () => {
  assert.deepEqual(validatePolicy(fixture(), catalogContext), []);
});

test("validates author X profile URLs", () => {
  const valid = fixture({
    collections: {
      authorOverrides: {
        openai: {
          xUrl: "https://x.com/OpenAI",
          featuredSkillIds: ["openai/codex:review"],
        },
      },
      collections: [],
    },
  });
  assert.ok(!validatePolicy(valid, catalogContext).some((entry) => entry.code === "invalid-x-profile-url"));

  const invalid = fixture({
    collections: {
      authorOverrides: {
        openai: {
          xUrl: "https://x.com/OpenAI/status/123",
          featuredSkillIds: ["openai/codex:review"],
        },
      },
      collections: [],
    },
  });
  assert.ok(validatePolicy(invalid, catalogContext).some((entry) => entry.code === "invalid-x-profile-url"));
});

test("validates topic collection image URLs", () => {
  const valid = fixture();
  (valid.raw.collections as PolicySources["collections"]).collections[0].imageUrl = "https://omgskills.com/images/collections/starter-pack.webp?v=0123456789ab";
  assert.ok(!validatePolicy(valid, catalogContext).some((entry) => entry.code === "invalid-collection-image-url"));

  const wrongCollection = fixture();
  (wrongCollection.raw.collections as PolicySources["collections"]).collections[0].imageUrl = "https://omgskills.com/images/collections/other.webp?v=0123456789ab";
  assert.ok(validatePolicy(wrongCollection, catalogContext).some((entry) => entry.code === "invalid-collection-image-url"));

  const unversioned = fixture();
  (unversioned.raw.collections as PolicySources["collections"]).collections[0].imageUrl = "https://omgskills.com/images/collections/starter-pack.webp";
  assert.ok(validatePolicy(unversioned, catalogContext).some((entry) => entry.code === "invalid-collection-image-url"));
});

test("normalizes keys before detecting duplicates", () => {
  const loaded = fixture({ officialRepos: { tier1: ["OpenAI/Codex"], tier2: ["openai/codex"] } });
  assert.ok(validatePolicy(loaded).some((entry) => entry.code === "duplicate-normalized-key"));
});

test("stale editorial references block only editorial and strict profiles", () => {
  const issues = validatePolicy(fixture(), {
    ...catalogContext,
    publishedSkillIds: new Set(),
    publishedAuthorHandles: new Set(),
  });
  assert.ok(issues.some((entry) => entry.code === "stale-collection-skill"));
  assert.ok(issues.some((entry) => entry.code === "stale-featured-creator"));
  assert.equal(blockingPolicyIssues(issues, "scheduled-data").length, 0);
  assert.equal(blockingPolicyIssues(issues, "manual-command").length, 0);
  assert.equal(blockingPolicyIssues(issues, "deploy").length, 0);
  assert.ok(blockingPolicyIssues(issues, "collections-publish").length > 0);
  assert.ok(blockingPolicyIssues(issues, "editool").length > 0);
  assert.ok(blockingPolicyIssues(issues, "strict").length > 0);
});

test("allows an intentionally empty featured creator with approved watch coverage", () => {
  const loaded = fixture({
    creators: {
      creators: [{
        handle: "newcreator",
        roles: ["creator"],
        watch: true,
        featured: true,
        skillCoverage: "selected",
        skillRepos: ["newcreator/skills"],
      }],
    },
    collections: { authorOverrides: { newcreator: {} }, collections: [] },
  });
  const issues = validatePolicy(loaded, {
    ...catalogContext,
    publishedAuthorHandles: new Set(),
  });
  assert.ok(!issues.some((entry) => entry.code === "stale-featured-creator"));
});

test("empty featured creators cannot claim catalog skills", () => {
  const loaded = fixture({
    creators: {
      creators: [{
        handle: "newcreator",
        roles: ["creator"],
        watch: true,
        featured: true,
        skillCoverage: "selected",
        skillRepos: ["newcreator/skills"],
      }],
    },
    collections: {
      authorOverrides: { newcreator: { featuredSkillIds: ["openai/codex:review"] } },
      collections: [],
    },
  });
  const issues = validatePolicy(loaded, {
    ...catalogContext,
    publishedAuthorHandles: new Set(),
  });
  assert.ok(issues.some((entry) => entry.code === "empty-featured-creator-has-skills"));
});

test("validates new suppressions against the promoted, cutover, and overlay union", () => {
  const loaded = fixture({
    suppressedSkills: { skills: [{ id: "owner/repo:overlay-only", reason: "duplicate" }] },
  });
  const accepted = validatePolicy(loaded, {
    ...catalogContext,
    suppressionCandidateSkillIds: new Set(["owner/repo:overlay-only"]),
  });
  assert.ok(!accepted.some((entry) => entry.code === "unknown-new-suppression"));

  const rejected = validatePolicy(loaded, catalogContext);
  assert.ok(rejected.some((entry) => entry.code === "unknown-new-suppression"));
});

test("does not re-litigate an existing suppression after it leaves all catalogs", () => {
  const loaded = fixture({
    suppressedSkills: { skills: [{ id: "owner/repo:historical", reason: "duplicate" }] },
  });
  const issues = validatePolicy(loaded, {
    ...catalogContext,
    existingSuppressedSkillIds: new Set(["owner/repo:historical"]),
  });
  assert.ok(!issues.some((entry) => entry.code === "unknown-new-suppression"));
});

test("reports policy conflicts without changing scheduled crawler behavior", () => {
  const loaded = fixture({
    doNotCrawl: { repos: [{ repo: "openai/codex", reason: "other" }], owners: [] },
  });
  const issues = validatePolicy(loaded, catalogContext);
  assert.ok(issues.some((entry) => entry.code === "blocked-official-repo" && entry.reasonCode === "do-not-crawl"));
  assert.equal(blockingPolicyIssues(issues, "scheduled-data").length, 0);
  assert.ok(blockingPolicyIssues(issues, "editool").length > 0);
});

test("keeps root-skill-invalid separate from exclusion reasons", () => {
  const loaded = fixture({
    doNotCrawl: {
      repos: [{ repo: "obra/superpowers", reason: "root-skill-invalid" as "other" }],
      owners: [],
    },
  });
  assert.ok(validatePolicy(loaded).some((entry) => entry.code === "invalid-do-not-crawl-reason"));
});

test("validates root-skill-invalid as root-path policy", () => {
  const valid = validatePolicyStructure(fixture({
    rootSkillInvalid: { repos: [{ repo: "obra/superpowers", reason: "root-skill-invalid" }] },
  }));
  assert.equal(valid.length, 0);

  const invalid = validatePolicyStructure(fixture({
    rootSkillInvalid: { repos: [{ repo: "obra/superpowers", reason: "wrong" as "root-skill-invalid" }] },
  }));
  assert.equal(invalid.some((entry) => entry.code === "invalid-root-skill-reason"), true);
});

test("requires stored repository policy to use owner/repo form", () => {
  const loaded = fixture({
    doNotCrawl: {
      repos: [{ repo: "https://github.com/openai/codex", reason: "other" }],
      owners: [],
    },
  });
  assert.ok(validatePolicy(loaded).some((entry) => entry.code === "invalid-repo"));
});

test("rejects malformed policy entries instead of silently skipping them", () => {
  const loaded = fixture({ repoOverrides: ["not-an-object" as never] });
  assert.ok(validatePolicy(loaded).some((entry) => entry.code === "invalid-repo-override-entry"));
});

test("validates creator coverage fields through shared policy validation", () => {
  const valid = fixture({
    creators: {
      creators: [{
        handle: "openai",
        roles: ["vendor"],
        watch: true,
        featured: true,
        skillCoverage: "selected",
        skillRepos: ["openai/codex"],
      }],
    },
  });
  assert.equal(validatePolicyStructure(valid).length, 0);

  const invalidRepo = fixture({
    creators: {
      creators: [{
        handle: "openai",
        watch: true,
        skillCoverage: "selected",
        skillRepos: ["https://github.com/openai/codex"],
      }],
    },
  });
  assert.ok(validatePolicyStructure(invalidRepo).some((entry) => entry.code === "invalid-repo"));

  const invalidCoverage = fixture({
    creators: {
      creators: [{
        handle: "openai",
        watch: true,
        skillCoverage: "sometimes" as "all",
      }],
    },
  });
  assert.ok(validatePolicyStructure(invalidCoverage).some((entry) =>
    entry.code === "invalid-creator-skill-coverage"
  ));
});

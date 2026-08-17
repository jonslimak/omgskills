import assert from "node:assert/strict";
import test from "node:test";
import type { CreatorBackfillPlan } from "../scraper/new-crawl/creator-backfill-plan.js";
import {
  buildCreatorIntakeRegistry,
  executeCreatorIntakeApply,
  finalizeCreatorIntakePlan,
  parseCreatorIntakeArguments,
  parseCreatorIntakeInput,
  type CreatorIntakePlan,
  type ResolvedCreatorIntakeInput,
} from "./creator-intake.js";

const emptyBackfill: CreatorBackfillPlan = {
  version: 1,
  complete: true,
  generatedAt: "2026-08-17T00:00:00.000Z",
  sourceCommit: "abc",
  policyDigest: "sha256:policy",
  quota: { initialRemaining: 5000, requiredAtStart: 3500, reservedForScheduledCrawler: 2000 },
  summary: {
    creatorCount: 1,
    repositoryCount: 1,
    discoveredSkillCount: 0,
    candidateCount: 0,
    excludedCount: 0,
    reviewRequiredRepositoryCount: 0,
  },
  creators: [{ handle: "person", repositoryCount: 1, discoveredSkillCount: 0, candidateCount: 0 }],
  repositories: [],
  candidates: [],
  exclusions: [],
};

function resolved(overrides: Partial<ResolvedCreatorIntakeInput> = {}): ResolvedCreatorIntakeInput {
  return {
    url: "https://github.com/Person/Skills",
    requestedHandle: "person",
    requestedRepo: "person/skills",
    kind: "repository",
    canonicalHandle: "Person",
    canonicalRepo: "person/skills",
    role: "creator",
    ...overrides,
  };
}

function plan(): CreatorIntakePlan {
  return finalizeCreatorIntakePlan({
    version: 1,
    complete: true,
    generatedAt: "2026-08-17T00:00:00.000Z",
    sourceCommit: "abc",
    policyDigest: "sha256:policy",
    creatorRevision: "sha256:creator",
    inputs: [resolved()],
    changedHandles: ["person"],
    proposedRegistry: {
      creators: [{
        handle: "Person",
        roles: ["creator"],
        watch: true,
        featured: true,
        skillCoverage: "selected",
        skillRepos: ["person/skills"],
      }],
    },
    backfill: emptyBackfill,
  });
}

test("parses profile, repository, and nested SKILL.md GitHub URLs", () => {
  assert.equal(parseCreatorIntakeInput("https://github.com/Person").kind, "profile");
  assert.deepEqual(
    parseCreatorIntakeInput("https://github.com/Person/Skills/blob/main/skills/example/SKILL.md"),
    {
      url: "https://github.com/Person/Skills/blob/main/skills/example/SKILL.md",
      requestedHandle: "person",
      requestedRepo: "person/skills",
      kind: "repository",
    },
  );
  assert.throws(() => parseCreatorIntakeInput("https://example.com/person"), /supports only/);
});

test("new repository intake creates watched featured selected coverage", () => {
  const result = buildCreatorIntakeRegistry({ creators: [] }, [resolved()], "2026-08-17");
  assert.deepEqual(result.changedHandles, ["person"]);
  assert.deepEqual(result.registry.creators[0], {
    handle: "Person",
    roles: ["creator"],
    watch: true,
    featured: true,
    skillCoverage: "selected",
    skillRepos: ["person/skills"],
    notes: "Added by creator intake 2026-08-17.",
  });
});

test("repository intake stores canonical renamed repositories", () => {
  const result = buildCreatorIntakeRegistry({ creators: [] }, [resolved({
    url: "https://github.com/person/old-name",
    requestedRepo: "person/old-name",
    canonicalRepo: "person/new-name",
  })], "2026-08-17");
  assert.deepEqual(result.registry.creators[0]?.skillRepos, ["person/new-name"]);
});

test("profile intake upgrades selected coverage to all without losing existing metadata", () => {
  const result = buildCreatorIntakeRegistry({
    creators: [{
      handle: "oldname",
      roles: ["creator"],
      watch: true,
      featured: false,
      skillCoverage: "selected",
      skillRepos: ["oldname/one"],
      notes: "Keep this note.",
    }],
  }, [resolved({
    url: "https://github.com/oldname",
    requestedHandle: "oldname",
    requestedRepo: null,
    kind: "profile",
    canonicalHandle: "newname",
    canonicalRepo: null,
  })], "2026-08-17");

  assert.deepEqual(result.registry.creators[0], {
    handle: "oldname",
    roles: ["creator"],
    watch: true,
    featured: true,
    aliases: ["newname"],
    skillCoverage: "all",
    notes: "Keep this note.",
  });
});

test("apply requires the reviewed digest and unchanged inputs", () => {
  const value = plan();
  let writes = 0;
  executeCreatorIntakeApply({
    plan: value,
    expectedDigest: value.planDigest,
    current: { sourceCommit: "abc", policyDigest: "sha256:policy", creatorRevision: "sha256:creator" },
    validate: () => undefined,
    write: () => { writes += 1; },
  });
  assert.equal(writes, 1);

  assert.throws(() => executeCreatorIntakeApply({
    plan: value,
    expectedDigest: "sha256:wrong",
    current: { sourceCommit: "abc", policyDigest: "sha256:policy", creatorRevision: "sha256:creator" },
    validate: () => undefined,
    write: () => undefined,
  }), /digest/);

  assert.throws(() => executeCreatorIntakeApply({
    plan: value,
    expectedDigest: value.planDigest,
    current: { sourceCommit: "abc", policyDigest: "sha256:changed", creatorRevision: "sha256:creator" },
    validate: () => undefined,
    write: () => undefined,
  }), /Policy changed/);

  assert.throws(() => executeCreatorIntakeApply({
    plan: value,
    expectedDigest: value.planDigest,
    current: { sourceCommit: "abc", policyDigest: "sha256:policy", creatorRevision: "sha256:new" },
    validate: () => undefined,
    write: () => undefined,
  }), /registry changed/);
});

test("apply validates before writing", () => {
  const value = plan();
  let writes = 0;
  assert.throws(() => executeCreatorIntakeApply({
    plan: value,
    expectedDigest: value.planDigest,
    current: { sourceCommit: "abc", policyDigest: "sha256:policy", creatorRevision: "sha256:creator" },
    validate: () => { throw new Error("blocked policy"); },
    write: () => { writes += 1; },
  }), /blocked policy/);
  assert.equal(writes, 0);
});

test("parses explicit plan and digest-pinned apply modes", () => {
  assert.deepEqual(
    parseCreatorIntakeArguments(["--plan", "https://github.com/person"]),
    { mode: "plan", urls: ["https://github.com/person"] },
  );
  assert.deepEqual(
    parseCreatorIntakeArguments(["--apply", "--digest=sha256:test"]),
    { mode: "apply", digest: "sha256:test" },
  );
  assert.throws(() => parseCreatorIntakeArguments(["--apply"]), /requires --digest/);
});

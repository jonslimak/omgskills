import assert from "node:assert/strict";
import test from "node:test";
import type { LoadedPolicySources, PolicySources } from "../scraper/policy/types.js";
import {
  buildEditoolPolicyFindings,
  parseEditoolPolicyReplacements,
  prepareEditoolPolicySave,
} from "./editool-policy-save.js";

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
};

test("invalid complete policy writes nothing", () => {
  const result = prepareEditoolPolicySave({
    loaded: fixture({ creators: { creators: [{ handle: "bad handle", watch: false, featured: false }] } }),
    replacements: { collections: fixture().raw.collections as PolicySources["collections"] },
    catalogContext,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("\n"), /invalid-handle/);
});

test("combined proposal is validated once before preparing selected writes", () => {
  const result = prepareEditoolPolicySave({
    loaded: fixture(),
    replacements: {
      collections: {
        authorOverrides: { openai: { featuredSkillIds: [] } },
        collections: [{
          id: "starter-pack",
          type: "topic",
          title: "Starter Pack",
          subtitle: "Useful skills",
          featuredSkillIds: [],
          skillIds: [],
        }],
      },
      suppressedSkills: {
        skills: [{ id: "openai/codex:review", reason: "duplicate" }],
      },
    },
    catalogContext,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.savedKeys, ["collections", "suppressedSkills"]);
    assert.deepEqual(result.entries.map((entry) => entry.key), ["collections", "suppressedSkills"]);
  }
});

test("deny-wins conflicts require an exact server-generated acknowledgement", () => {
  const replacements = {
    doNotCrawl: { repos: [{ repo: "openai/codex", reason: "other" as const }], owners: [] },
  };
  const first = prepareEditoolPolicySave({
    loaded: fixture(),
    replacements,
    catalogContext,
    catalogSkills: [{
      id: "openai/codex:review",
      author_handle: "openai",
      github_url: "https://github.com/openai/codex",
    }],
  });
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.findings[0]?.disposition, "acknowledgeable-deny-wins");
  assert.equal(first.findings[0]?.winner, "do-not-crawl");
  assert.equal(first.findings[0]?.affectedSkillCount, 1);
  assert.deepEqual(first.findings[0]?.affectedSkillIds, ["openai/codex:review"]);
  assert.equal(first.requiredAcknowledgements.length, 1);

  const accepted = prepareEditoolPolicySave({
    loaded: fixture(),
    replacements,
    catalogContext,
    acknowledgements: new Set(first.requiredAcknowledgements),
  });
  assert.equal(accepted.ok, true);
});

test("editorial suppression conflict cannot be acknowledged", () => {
  const result = prepareEditoolPolicySave({
    loaded: fixture(),
    replacements: {
      suppressedSkills: { skills: [{ id: "openai/codex:review", reason: "duplicate" }] },
    },
    catalogContext,
    acknowledgements: new Set(["anything"]),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.findings.some((finding) =>
      finding.code === "suppressed-editorial-skill" && finding.disposition === "blocking"
    ));
  }
});

test("finding fingerprints do not depend on absolute policy paths", () => {
  const issue = {
    code: "blocked-official-repo",
    reasonCode: "do-not-crawl" as const,
    severity: "warning" as const,
    scope: "conflict" as const,
    source: "officialRepos" as const,
    path: "/first/policy.json#/tier1",
    key: "openai/codex",
    message: "conflict",
  };
  const first = buildEditoolPolicyFindings([issue], []);
  const second = buildEditoolPolicyFindings([{ ...issue, path: "/second/policy.json#/tier1" }], []);
  assert.equal(first[0]?.fingerprint, second[0]?.fingerprint);
});

test("batch parser rejects empty and unsupported policy sources", () => {
  assert.deepEqual(parseEditoolPolicyReplacements({}).errors, [
    "policy save requires at least one editable source",
  ]);
  assert.deepEqual(parseEditoolPolicyReplacements({ creators: {}, officialRepos: {} }).errors, [
    "unsupported policy sources: officialRepos",
  ]);
});

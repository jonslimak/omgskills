import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candidate } from "./enrich.js";
import type { Skill } from "./types.js";
import type { TrustedSeeds } from "./new-crawl/types.js";
import { loadTrustedSeeds } from "./new-crawl/seeds.js";
import {
  LEGACY_BLOCKED_OWNERS,
  LEGACY_BLOCKED_REPOS,
  LEGACY_ROOT_SKILL_INVALID_REPOS,
  assertV2PolicyEnforcementReady,
  buildV2LegacyMigrationAudit,
  buildV2PolicyReport,
  evaluateLegacyV2Candidate,
  evaluateProposedV2Candidate,
  isRootSkillPath,
  observeCandidatePolicy,
  parseV2PolicyMode,
  writeV2PolicyReport,
} from "./v2-policy.js";
import { evaluateEffectiveSkillPolicy } from "./policy/effective-policy.js";

function seeds(overrides: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    doNotCrawlRepos: new Set(LEGACY_BLOCKED_REPOS),
    doNotCrawlOwners: new Set(LEGACY_BLOCKED_OWNERS),
    rootSkillInvalidRepos: new Set(LEGACY_ROOT_SKILL_INVALID_REPOS),
    suppressedSkillIds: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...overrides,
  };
}

function candidate(path: string): Candidate {
  return {
    id: "obra/superpowers:skills/foo",
    skill_md_path: path,
    github_url: "https://github.com/obra/superpowers",
  };
}

function skill(id: string): Skill {
  return {
    id,
    name: id,
    description: "Test skill description",
    github_url: `https://github.com/${id.split(":")[0]}`,
    skill_md_path: "skills/foo/SKILL.md",
    install_cmd: "install",
    author_handle: "owner",
    tags: [],
    stars: 10,
    last_updated: "2026-07-22T00:00:00Z",
    first_seen: "2026-07-22",
  };
}

test("root-invalid policy rejects only root path while legacy rejects nested paths", () => {
  assert.equal(isRootSkillPath("./SKILL.md"), true);
  assert.equal(isRootSkillPath("skills/foo/SKILL.md"), false);
  assert.equal(evaluateLegacyV2Candidate(candidate("skills/foo/SKILL.md")).excluded, true);
  assert.equal(evaluateProposedV2Candidate(candidate("skills/foo/SKILL.md"), seeds()).excluded, false);
  assert.equal(evaluateProposedV2Candidate(candidate("SKILL.md"), seeds()).reasonCode, "root-skill-invalid");
  assert.deepEqual(observeCandidatePolicy(candidate("skills/foo/SKILL.md"), seeds()), {
    id: "obra/superpowers:skills/foo",
    skillMdPath: "skills/foo/SKILL.md",
    legacyExcluded: true,
    proposedExcluded: false,
    reasonCode: "root-skill-invalid",
    matchedSource: "legacy.KNOWN_INVALID_REPOS",
  });
});

test("legacy migration audit requires every hardcoded entry to have shared policy", () => {
  const complete = buildV2LegacyMigrationAudit(seeds());
  assert.equal(complete.enforcementReady, true);
  assert.doesNotThrow(() => assertV2PolicyEnforcementReady(complete));

  const incomplete = buildV2LegacyMigrationAudit(seeds({ doNotCrawlRepos: new Set() }));
  assert.equal(incomplete.enforcementReady, false);
  assert.throws(() => assertV2PolicyEnforcementReady(incomplete), /majiayu000/);
});

test("checked-in shared policy covers every legacy v2 entry", () => {
  const audit = buildV2LegacyMigrationAudit(loadTrustedSeeds("scheduled-data"));
  assert.deepEqual(audit.blockedReposMissing, []);
  assert.deepEqual(audit.blockedOwnersMissing, []);
  assert.deepEqual(audit.rootSkillInvalidMissing, []);
  assert.equal(audit.enforcementReady, true);
});

test("v2 mode defaults to observe and rejects unknown values", () => {
  assert.equal(parseV2PolicyMode(undefined), "observe");
  assert.equal(parseV2PolicyMode("enforce"), "enforce");
  assert.throws(() => parseV2PolicyMode("enabled"), /Expected observe or enforce/);
});

test("report preserves legacy effective count in observe and explains removals", () => {
  const blocked = skill("newly-blocked/repo:skill");
  const allowed = skill("allowed/repo:skill");
  const policySeeds = seeds({
    doNotCrawlRepos: new Set([...LEGACY_BLOCKED_REPOS, "newly-blocked/repo"]),
  });
  const report = buildV2PolicyReport({
    generatedAt: "2026-07-22T00:00:00Z",
    mode: "observe",
    sourceCommit: "abc",
    policyDigest: "sha256:test",
    legacySkills: [blocked, allowed],
    proposedSkills: [allowed],
    candidateObservations: [],
    migration: buildV2LegacyMigrationAudit(policySeeds),
    seeds: policySeeds,
  });
  assert.equal(report.effectiveSkillCount, 2);
  assert.equal(report.removalCount, 1);
  assert.equal(report.removalSample[0]?.reasonCode, "do-not-crawl");
  const directory = mkdtempSync(join(tmpdir(), "v2-policy-report-"));
  const jsonPath = join(directory, "report.json");
  const markdownPath = join(directory, "report.md");
  writeV2PolicyReport(jsonPath, markdownPath, report);
  assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).sourceCommit, "abc");
  assert.match(readFileSync(markdownPath, "utf8"), /Policy digest: sha256:test/);
});

test("v2 proposed exclusions match shared Crawl 4 policy fixtures", () => {
  const fixtures: Array<{ skill: Skill; seeds: TrustedSeeds }> = [
    { skill: skill("blocked/repo:skill"), seeds: seeds({ doNotCrawlRepos: new Set(["blocked/repo"]) }) },
    { skill: skill("blocked/repo:skill"), seeds: seeds({ doNotCrawlOwners: new Set(["blocked"]) }) },
    { skill: skill("blocked/repo:skill"), seeds: seeds({ repoOverrides: [{ repo: "blocked/repo", exclude: true }] }) },
    { skill: skill("blocked/repo:skill"), seeds: seeds({ suppressedSkillIds: new Set(["blocked/repo:skill"]) }) },
    { skill: skill("allowed/repo:skill"), seeds: seeds() },
  ];
  for (const fixture of fixtures) {
    const shared = evaluateEffectiveSkillPolicy(fixture.skill, fixture.seeds);
    const proposed = evaluateProposedV2Candidate({
      id: fixture.skill.id,
      github_url: fixture.skill.github_url,
      skill_md_path: fixture.skill.skill_md_path ?? "skills/foo/SKILL.md",
    }, fixture.seeds);
    assert.equal(proposed.excluded, shared.excluded, fixture.skill.id);
    assert.equal(proposed.reasonCode, shared.reasonCode, fixture.skill.id);
  }
});

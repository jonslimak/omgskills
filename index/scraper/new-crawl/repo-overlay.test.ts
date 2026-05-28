import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShadowRepoOverlay,
  buildShadowRepoOverlay,
  shouldReadShadowRepoOverlay,
  shouldWriteShadowRepoOverlay,
} from "./repo-overlay.js";
import type { ShadowCutoverSkillSignal, ShadowRepoIndex, ShadowRepoIndexEntry, ShadowRepoOverlay, ShadowSkillRecord } from "./types.js";
import { buildCutoverSkillSignals, reconcileRepoIndexSkillIds } from "./build-shadow.js";

function repo(overrides: Partial<ShadowRepoIndexEntry> & Pick<ShadowRepoIndexEntry, "repo" | "stars">): ShadowRepoIndexEntry {
  const { repo: repoName, stars, ...rest } = overrides;
  return {
    repo: repoName,
    repoUrl: `https://github.com/${repoName}`,
    state: "library",
    discoveredSources: ["baseline"],
    skillIds: [`${repoName}:skill`],
    skillCount: 1,
    stars,
    lastSeenAt: "2026-05-22T00:00:00Z",
    lastRefreshedAt: "2026-05-22T00:00:00Z",
    trustSignals: [],
    promotionReasons: [],
    staleOrInvalidState: null,
    isTrustedVendor: false,
    isTrustedCreator: false,
    isGoldBasketRepo: false,
    topSkillId: `${repoName}:skill`,
    topSkillStars: stars,
    ...rest,
  };
}

function repoIndex(repos: ShadowRepoIndexEntry[]): ShadowRepoIndex {
  return {
    generatedAt: "2026-05-22T00:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

function overlay(repos: ShadowRepoIndexEntry[]): ShadowRepoOverlay {
  return {
    generatedAt: "2026-05-22T01:00:00Z",
    repoCount: repos.length,
    repos,
  };
}

test("combined run loads overlay and merges onto baseline index", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  const result = applyShadowRepoOverlay(
    "combined",
    index,
    overlay([
      repo({
        repo: "owner/repo",
        stars: 20,
        state: "rising",
        discoveredSources: ["baseline", "awesome"],
        skillIds: ["owner/repo:bootstrapped"],
        skillCount: 1,
        topSkillId: "owner/repo:bootstrapped",
        topSkillStars: 20,
        promotionReasons: ["shortlist-promotion"],
      }),
    ]),
  );

  assert.equal(result.overlayLoaded, true);
  assert.equal(result.overlayEntryCount, 1);
  assert.equal(index.repos[0]?.state, "rising");
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:bootstrapped");
  assert.deepEqual(index.repos[0]?.discoveredSources, ["awesome", "baseline"]);
});

test("fast run loads overlay and merges onto baseline index", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  const result = applyShadowRepoOverlay(
    "fast",
    index,
    overlay([repo({ repo: "owner/repo", stars: 20, state: "rising" })]),
  );

  assert.equal(result.overlayLoaded, true);
  assert.equal(result.overlayEntryCount, 1);
  assert.equal(index.repos[0]?.state, "rising");
  assert.equal(index.repos[0]?.stars, 20);
});

test("periodic and background cadences ignore overlay", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  const periodicResult = applyShadowRepoOverlay(
    "periodic",
    index,
    overlay([repo({ repo: "owner/repo", stars: 20, state: "rising" })]),
  );
  const backgroundResult = applyShadowRepoOverlay(
    "background",
    index,
    overlay([repo({ repo: "owner/repo", stars: 20, state: "rising" })]),
  );

  assert.equal(periodicResult.overlayLoaded, false);
  assert.equal(periodicResult.overlayEntryCount, 0);
  assert.equal(backgroundResult.overlayLoaded, false);
  assert.equal(backgroundResult.overlayEntryCount, 0);
  assert.equal(index.repos[0]?.state, "library");
});

test("only combined writes overlay", () => {
  assert.equal(shouldReadShadowRepoOverlay("fast"), true);
  assert.equal(shouldReadShadowRepoOverlay("combined"), true);
  assert.equal(shouldReadShadowRepoOverlay("periodic"), false);
  assert.equal(shouldReadShadowRepoOverlay("background"), false);

  assert.equal(shouldWriteShadowRepoOverlay("combined"), true);
  assert.equal(shouldWriteShadowRepoOverlay("fast"), false);
  assert.equal(shouldWriteShadowRepoOverlay("periodic"), false);
  assert.equal(shouldWriteShadowRepoOverlay("background"), false);
});

test("overlay-only repo is added to repo index", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([
      repo({
        repo: "new/repo",
        stars: 50,
        state: "rising",
        discoveredSources: ["awesome"],
        skillIds: [],
        skillCount: 0,
        topSkillId: null,
        topSkillStars: 0,
      }),
    ]),
  );

  assert.equal(index.repoCount, 2);
  assert.ok(index.repos.find((row) => row.repo === "new/repo"));
});

test("overlay state overrides baseline state for the same repo", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10, state: "library" })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([repo({ repo: "owner/repo", stars: 10, state: "rising" })]),
  );

  assert.equal(index.repos[0]?.state, "rising");
});

test("promoted rising repo survives into next combined-run starting state", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10, state: "library" })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([repo({ repo: "owner/repo", stars: 10, state: "rising", promotionReasons: ["shortlist-promotion"] })]),
  );

  assert.equal(index.repos[0]?.state, "rising");
  assert.deepEqual(index.repos[0]?.promotionReasons, ["shortlist-promotion"]);
});

test("bootstrapped skill ids survive into next combined-run starting state", () => {
  const index = repoIndex([repo({ repo: "owner/repo", stars: 10 })]);
  applyShadowRepoOverlay(
    "combined",
    index,
    overlay([
      repo({
        repo: "owner/repo",
        stars: 10,
        skillIds: ["owner/repo:bootstrapped"],
        skillCount: 1,
        topSkillId: "owner/repo:bootstrapped",
        topSkillStars: 10,
      }),
    ]),
  );

  assert.deepEqual(index.repos[0]?.skillIds, ["owner/repo:bootstrapped"]);
  assert.equal(index.repos[0]?.topSkillId, "owner/repo:bootstrapped");
});

test("overlay write count matches persisted repo entries", () => {
  const baseline = repoIndex([
    repo({ repo: "same/repo", stars: 10 }),
    repo({ repo: "changed/repo", stars: 10 }),
  ]);
  const current = repoIndex([
    repo({ repo: "same/repo", stars: 10 }),
    repo({ repo: "changed/repo", stars: 20, state: "rising", promotionReasons: ["shortlist-promotion"] }),
    repo({ repo: "new/repo", stars: 30, state: "rising", discoveredSources: ["awesome"], skillIds: [], skillCount: 0, topSkillId: null, topSkillStars: 0 }),
  ]);

  const result = buildShadowRepoOverlay(current, baseline, "2026-05-22T02:00:00Z");

  assert.equal(result.repoCount, 2);
  assert.deepEqual(result.repos.map((row) => row.repo), ["changed/repo", "new/repo"]);
});

test("reconciliation rewrites stale overlay skill ids to current shadow skill ids", () => {
  const index = repoIndex([
    repo({
      repo: "orcaqubits/agentic-commerce-skills-plugins",
      stars: 31,
      skillIds: [
        "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
        "OrcaQubits/agentic-commerce-skills-plugins:acp-checkout-mcp",
        "OrcaQubits/agentic-commerce-skills-plugins:medusa-payments",
      ],
      skillCount: 3,
      topSkillId: "OrcaQubits/agentic-commerce-skills-plugins:medusa-payments",
      topSkillStars: 31,
    }),
  ]);

  const shadowSkills: ShadowSkillRecord[] = [
    {
      id: "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
      name: "acp-checkout-mcp",
      description: "Desc",
      github_url: "https://github.com/OrcaQubits/agentic-commerce-skills-plugins",
      skill_md_path: "acp-agentic-commerce/skills/acp-checkout-mcp/SKILL.md",
      install_cmd: "install",
      author_handle: "orcaqubits",
      tags: [],
      stars: 23,
      last_updated: "2026-05-01T00:00:00Z",
      first_seen: "2026-05-01",
      skill_md_sha: "sha-a",
      publisher_handle: "orcaqubits",
      publisher_repo: "orcaqubits/agentic-commerce-skills-plugins",
      upstream_repo: "orcaqubits/agentic-commerce-claude-plugins",
      provenance_type: "repackaged",
      author_confidence: "high",
    },
    {
      id: "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-setup",
      name: "acp-setup",
      description: "Desc",
      github_url: "https://github.com/OrcaQubits/agentic-commerce-skills-plugins",
      skill_md_path: "acp-agentic-commerce/skills/acp-setup/SKILL.md",
      install_cmd: "install",
      author_handle: "orcaqubits",
      tags: [],
      stars: 23,
      last_updated: "2026-05-01T00:00:00Z",
      first_seen: "2026-05-01",
      skill_md_sha: "sha-b",
      publisher_handle: "orcaqubits",
      publisher_repo: "orcaqubits/agentic-commerce-skills-plugins",
      upstream_repo: "orcaqubits/agentic-commerce-claude-plugins",
      provenance_type: "repackaged",
      author_confidence: "high",
    },
  ];

  reconcileRepoIndexSkillIds(index, shadowSkills);

  assert.deepEqual(index.repos[0]?.skillIds, [
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-setup",
  ]);
  assert.equal(index.repos[0]?.skillCount, 2);
  assert.equal(index.repos[0]?.topSkillId, "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp");
  assert.equal(index.repos[0]?.topSkillStars, 23);

  const signals: ShadowCutoverSkillSignal[] = buildCutoverSkillSignals(shadowSkills, index);
  assert.deepEqual(signals.map((row) => row.id), [
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-checkout-mcp",
    "OrcaQubits/agentic-commerce-claude-plugins:acp-agentic-commerce/skills/acp-setup",
  ]);
});

test("reconciliation clears repo skill ids when no current shadow skills remain", () => {
  const index = repoIndex([
    repo({
      repo: "owner/repo",
      stars: 10,
      skillIds: ["owner/repo:stale"],
      skillCount: 1,
      topSkillId: "owner/repo:stale",
      topSkillStars: 10,
    }),
  ]);

  reconcileRepoIndexSkillIds(index, []);

  assert.deepEqual(index.repos[0]?.skillIds, []);
  assert.equal(index.repos[0]?.skillCount, 0);
  assert.equal(index.repos[0]?.topSkillId, null);
  assert.equal(index.repos[0]?.topSkillStars, 0);
});

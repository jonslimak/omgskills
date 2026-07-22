import test from "node:test";
import assert from "node:assert/strict";
import { resolveShadowProvenance } from "./provenance.js";
import type { Skill } from "../types.js";
import type { TrustedSeeds } from "./types.js";

function skill(overrides: Partial<Skill>): Skill {
  return {
    id: "owner/repo:skill",
    name: "skill",
    description: "desc",
    github_url: "https://github.com/owner/repo",
    install_cmd: "cmd",
    author_handle: "owner",
    tags: [],
    stars: 10,
    last_updated: "2026-01-01T00:00:00Z",
    first_seen: "2026-01-01",
    ...overrides,
  };
}

function seeds(partial: Partial<TrustedSeeds> = {}): TrustedSeeds {
  return {
    trustedVendorHandles: new Set(),
    trustedCreatorHandles: new Set(),
    officialTier1Repos: new Set(),
    officialTier2Repos: new Set(),
    manualIncludeRepos: new Set(),
    repoOverrides: [],
    catalogRepoRules: [],
    provenanceOverrides: [],
    ...partial,
  };
}

test("keeps a normal one-author repo as original", () => {
  const result = resolveShadowProvenance(skill({}), seeds());
  assert.equal(result.authorHandle, "owner");
  assert.equal(result.publisherHandle, "owner");
  assert.equal(result.provenanceType, "original");
  assert.equal(result.authorConfidence, "high");
});

test("catalog repo child skill does not inherit repo owner by default", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "sickn33/antigravity-awesome-skills:content-marketer",
      github_url: "https://github.com/sickn33/antigravity-awesome-skills",
      author_handle: "sickn33",
    }),
    seeds({
      catalogRepoRules: [{ repo: "sickn33/antigravity-awesome-skills", defaultProvenanceType: "catalog" }],
    }),
  );
  assert.equal(result.authorHandle, "");
  assert.equal(result.publisherHandle, "sickn33");
  assert.equal(result.provenanceType, "catalog");
  assert.equal(result.authorConfidence, "low");
});

test("obvious upstream repo in skill id produces repackaged provenance", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "steipete/clawdis:summarize",
      github_url: "https://github.com/openclaw/openclaw",
      author_handle: "steipete",
    }),
    seeds(),
  );
  assert.equal(result.authorHandle, "steipete");
  assert.equal(result.publisherHandle, "openclaw");
  assert.equal(result.upstreamRepo, "steipete/clawdis");
  assert.equal(result.provenanceType, "repackaged");
  assert.equal(result.authorConfidence, "high");
});

test("parses openclaw/skills path author", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "clawdbot/skills:skills/steipete/github",
      github_url: "https://github.com/openclaw/skills",
      author_handle: "clawdbot",
    }),
    seeds(),
  );
  assert.equal(result.authorHandle, "steipete");
  assert.equal(result.publisherHandle, "openclaw");
  assert.equal(result.publisherRepo, "openclaw/skills");
  assert.equal(result.upstreamRepo, null);
  assert.equal(result.provenanceType, "repackaged");
  assert.equal(result.authorConfidence, "high");
});

test("parses NeverSight mirrored path", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "NeverSight/skills.sh_feed:data/skills-md/vercel/ai/ai-sdk",
      github_url: "https://github.com/NeverSight/learn-skills.dev",
      author_handle: "NeverSight",
    }),
    seeds(),
  );
  assert.equal(result.authorHandle, "vercel");
  assert.equal(result.publisherHandle, "neversight");
  assert.equal(result.publisherRepo, "neversight/learn-skills.dev");
  assert.equal(result.upstreamRepo, "vercel/ai");
  assert.equal(result.provenanceType, "mirrored");
  assert.equal(result.authorConfidence, "high");
});

test("aiskillstore marketplace does not inherit repo owner authorship by default", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "aiskillstore/marketplace:skills/sickn33/2d-games",
      github_url: "https://github.com/aiskillstore/marketplace",
      author_handle: "aiskillstore",
    }),
    seeds({
      catalogRepoRules: [{ repo: "aiskillstore/marketplace", defaultProvenanceType: "repackaged" }],
      provenanceOverrides: [
        {
          repo: "aiskillstore/marketplace",
          authorHandle: "",
          publisherHandle: "aiskillstore",
          provenanceType: "repackaged",
          authorConfidence: "low",
        },
      ],
    }),
  );
  assert.equal(result.authorHandle, "");
  assert.equal(result.publisherHandle, "aiskillstore");
  assert.equal(result.publisherRepo, "aiskillstore/marketplace");
  assert.equal(result.provenanceType, "repackaged");
  assert.equal(result.authorConfidence, "low");
});

test("aiskillstore marketplace can keep a trusted upstream author hint", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "aiskillstore/marketplace:skills/vercel-labs/nextjs",
      github_url: "https://github.com/aiskillstore/marketplace",
      author_handle: "aiskillstore",
    }),
    seeds({
      trustedVendorHandles: new Set(["vercel-labs"]),
      catalogRepoRules: [{ repo: "aiskillstore/marketplace", defaultProvenanceType: "repackaged" }],
      provenanceOverrides: [
        {
          repo: "aiskillstore/marketplace",
          authorHandle: "",
          publisherHandle: "aiskillstore",
          provenanceType: "repackaged",
          authorConfidence: "low",
        },
      ],
    }),
  );
  assert.equal(result.authorHandle, "vercel-labs");
  assert.equal(result.publisherHandle, "aiskillstore");
  assert.equal(result.provenanceType, "repackaged");
  assert.equal(result.authorConfidence, "high");
});

test("aiskillstore marketplace resolves trusted creator aliases", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "aiskillstore/marketplace:skills/old-vendor/nextjs",
      github_url: "https://github.com/aiskillstore/marketplace",
      author_handle: "aiskillstore",
    }),
    seeds({
      trustedVendorHandles: new Set(["new-vendor"]),
      creatorAliasToCanonicalHandle: new Map([["old-vendor", "new-vendor"]]),
      catalogRepoRules: [{ repo: "aiskillstore/marketplace", defaultProvenanceType: "repackaged" }],
      provenanceOverrides: [
        {
          repo: "aiskillstore/marketplace",
          authorHandle: "",
          publisherHandle: "aiskillstore",
          provenanceType: "repackaged",
          authorConfidence: "low",
        },
      ],
    }),
  );

  assert.equal(result.authorHandle, "old-vendor");
  assert.equal(result.authorConfidence, "high");
});

test("unmatched openclaw/skills ids fall back safely", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "openclaw/skills:rstack-page",
      github_url: "https://github.com/openclaw/skills",
      author_handle: "openclaw",
    }),
    seeds(),
  );
  assert.equal(result.authorHandle, "openclaw");
  assert.equal(result.publisherHandle, "openclaw");
  assert.equal(result.provenanceType, "original");
  assert.equal(result.authorConfidence, "high");
});

test("unmatched NeverSight ids fall back safely", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "NeverSight/skills_feed:data/other-source/ai-sdk",
      github_url: "https://github.com/NeverSight/learn-skills.dev",
      author_handle: "NeverSight",
    }),
    seeds({
      provenanceOverrides: [
        {
          repo: "neversight/learn-skills.dev",
          authorHandle: "",
          publisherHandle: "neversight",
          provenanceType: "mirrored",
          authorConfidence: "low",
        },
      ],
    }),
  );
  assert.equal(result.authorHandle, "");
  assert.equal(result.publisherHandle, "neversight");
  assert.equal(result.provenanceType, "mirrored");
  assert.equal(result.authorConfidence, "low");
});

test("skill-level overrides beat repo-level rules", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "owner/repo:skill",
      github_url: "https://github.com/sickn33/antigravity-awesome-skills",
      author_handle: "sickn33",
    }),
    seeds({
      catalogRepoRules: [{ repo: "sickn33/antigravity-awesome-skills", defaultProvenanceType: "catalog" }],
      provenanceOverrides: [
        { repo: "sickn33/antigravity-awesome-skills", authorHandle: "publisher", provenanceType: "catalog", authorConfidence: "low" },
        { id: "owner/repo:skill", authorHandle: "real-author", provenanceType: "mirrored", authorConfidence: "high" },
      ],
    }),
  );
  assert.equal(result.authorHandle, "real-author");
  assert.equal(result.provenanceType, "mirrored");
  assert.equal(result.authorConfidence, "high");
});

test("skill-level overrides beat openclaw path parsing", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "clawdbot/skills:skills/steipete/github",
      github_url: "https://github.com/openclaw/skills",
      author_handle: "clawdbot",
    }),
    seeds({
      provenanceOverrides: [
        {
          id: "clawdbot/skills:skills/steipete/github",
          authorHandle: "manual-author",
          provenanceType: "repackaged",
          authorConfidence: "high",
        },
      ],
    }),
  );
  assert.equal(result.authorHandle, "manual-author");
  assert.equal(result.publisherHandle, "openclaw");
  assert.equal(result.provenanceType, "repackaged");
});

test("openclaw path parsing beats repo-level override", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "clawdbot/skills:skills/steipete/github",
      github_url: "https://github.com/openclaw/skills",
      author_handle: "clawdbot",
    }),
    seeds({
      provenanceOverrides: [
        {
          repo: "openclaw/skills",
          authorHandle: "",
          publisherHandle: "openclaw",
          provenanceType: "repackaged",
          authorConfidence: "low",
        },
      ],
    }),
  );
  assert.equal(result.authorHandle, "steipete");
  assert.equal(result.publisherHandle, "openclaw");
  assert.equal(result.provenanceType, "repackaged");
  assert.equal(result.authorConfidence, "high");
});

test("NeverSight path parsing beats repo-level override", () => {
  const result = resolveShadowProvenance(
    skill({
      id: "NeverSight/skills.sh_feed:data/skills-md/vercel/ai/ai-sdk",
      github_url: "https://github.com/NeverSight/learn-skills.dev",
      author_handle: "NeverSight",
    }),
    seeds({
      provenanceOverrides: [
        {
          repo: "neversight/learn-skills.dev",
          authorHandle: "",
          publisherHandle: "neversight",
          provenanceType: "mirrored",
          authorConfidence: "low",
        },
      ],
    }),
  );
  assert.equal(result.authorHandle, "vercel");
  assert.equal(result.publisherHandle, "neversight");
  assert.equal(result.upstreamRepo, "vercel/ai");
  assert.equal(result.provenanceType, "mirrored");
  assert.equal(result.authorConfidence, "high");
});

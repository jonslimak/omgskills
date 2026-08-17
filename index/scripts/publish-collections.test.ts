import test from "node:test";
import assert from "node:assert/strict";
import type { CreatorRegistrySource } from "../scraper/creator-registry.js";
import {
  buildCollectionsAsset,
  collectionsPublishMode,
  evaluateCollectionsImpact,
  validateSource,
} from "./publish-collections.js";
import { summarizeCollections } from "./publication-impact.js";

const skills = [
  {
    id: "oldhandle/repo:one",
    name: "One",
    description: "One",
    author_handle: "OldHandle",
    stars: 10,
  },
  {
    id: "other/repo:two",
    name: "Two",
    description: "Two",
    author_handle: "other",
    stars: 5,
  },
];

test("featured creators come from the creator registry", () => {
  const source = {
    version: 1,
    authorOverrides: {},
    collections: [],
  };
  const registry: CreatorRegistrySource = {
    creators: [{ handle: "OldHandle", roles: ["creator"], watch: true, featured: true }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  assert.deepEqual(asset.collections.map((collection) => collection.authorHandle), ["OldHandle"]);
  assert.deepEqual(asset.collections.map((collection) => collection.githubUrl), ["https://github.com/OldHandle"]);
});

test("an empty featured registry produces no author collections", () => {
  const source = { version: 1, authorOverrides: {}, collections: [] };
  const registry: CreatorRegistrySource = { creators: [] };

  validateSource(source, registry, skills);
  assert.deepEqual(buildCollectionsAsset(source, registry, skills).collections, []);
});

test("featured creator must be watched", () => {
  assert.throws(
    () =>
      validateSource(
        { version: 1, authorOverrides: {}, collections: [] },
        { creators: [{ handle: "OldHandle", roles: ["creator"], watch: false, featured: true }] },
        skills,
      ),
    /must be watched/,
  );
});

test("featured creator with approved coverage may publish an empty profile", () => {
  const source = { version: 1, authorOverrides: {}, collections: [] };
  const registry: CreatorRegistrySource = {
    creators: [{
      handle: "NewCreator",
      roles: ["creator"],
      watch: true,
      featured: true,
      skillCoverage: "selected",
      skillRepos: ["newcreator/skills"],
    }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);
  assert.deepEqual(asset.collections[0].featuredSkillIds, []);
  assert.equal(asset.collections[0].authorHandle, "NewCreator");
});

test("empty featured creator cannot reference skills before catalog rows exist", () => {
  assert.throws(
    () => validateSource(
      {
        version: 1,
        authorOverrides: { newcreator: { featuredSkillIds: ["oldhandle/repo:one"] } },
        collections: [],
      },
      {
        creators: [{
          handle: "newcreator",
          roles: ["creator"],
          watch: true,
          featured: true,
          skillCoverage: "selected",
          skillRepos: ["newcreator/skills"],
        }],
      },
      skills,
    ),
    /must not reference skills/,
  );
});

test("alias-only creator validates and generates a non-empty profile", () => {
  const source = { version: 1, authorOverrides: {}, collections: [] };
  const registry: CreatorRegistrySource = {
    creators: [{ handle: "NewHandle", roles: ["creator"], watch: true, featured: true, aliases: ["oldhandle"] }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  assert.equal(asset.collections[0].authorHandle, "OldHandle");
  assert.equal(asset.collections[0].githubUrl, "https://github.com/NewHandle");
  assert.deepEqual(asset.collections[0].featuredSkillIds, ["oldhandle/repo:one"]);
});

test("author override lookup is case-insensitive and alias-aware", () => {
  const source = {
    version: 1,
    authorOverrides: {
      oldhandle: {
        title: "Custom",
        xUrl: "https://x.com/OldHandle",
        featuredSkillIds: ["oldhandle/repo:one"],
      },
    },
    collections: [],
  };
  const registry: CreatorRegistrySource = {
    creators: [{ handle: "NewHandle", roles: ["creator"], watch: true, featured: true, aliases: ["OldHandle"] }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  assert.equal(asset.collections[0].title, "Custom");
  assert.equal(asset.collections[0].xUrl, "https://x.com/OldHandle");
  assert.deepEqual(asset.collections[0].featuredSkillIds, ["oldhandle/repo:one"]);
});

test("duplicate skill ids within one curated list are rejected", () => {
  const source = {
    version: 1,
    authorOverrides: {},
    collections: [{
      id: "starter-pack",
      type: "topic" as const,
      title: "Starter Pack",
      subtitle: "Start here",
      featuredSkillIds: [],
      skillIds: ["oldhandle/repo:one", "oldhandle/repo:one"],
    }],
  };

  assert.throws(
    () => validateSource(source, { creators: [] }, skills),
    /duplicate skill id in starter-pack\.skillIds: oldhandle\/repo:one/,
  );
});

test("collections publish mode defaults to publish and supports explicit removal", () => {
  assert.equal(collectionsPublishMode({}), "publish");
  assert.equal(collectionsPublishMode({ COLLECTIONS_PUBLISH: "1" }), "publish");
  assert.equal(collectionsPublishMode({ COLLECTIONS_PUBLISH: "publish" }), "publish");
  assert.equal(collectionsPublishMode({ COLLECTIONS_PUBLISH: "0" }), "remove");
  assert.equal(collectionsPublishMode({ COLLECTIONS_PUBLISH: "remove" }), "remove");
  assert.throws(
    () => collectionsPublishMode({ COLLECTIONS_PUBLISH: "true" }),
    /invalid COLLECTIONS_PUBLISH/,
  );
});

test("collections impact blocks collection removal without review", () => {
  const previous = summarizeCollections({
    collections: [{
      id: "starter-pack",
      featuredSkillIds: ["oldhandle/repo:one"],
      skillIds: [],
    }],
  });
  const report = evaluateCollectionsImpact({
    mode: "publish",
    tracks: [{ name: "v2", previous }, { name: "crawl4", previous }],
    proposed: summarizeCollections({ collections: [] }),
    metadata: { sourceCommit: "abc", policyDigest: "sha256:test" },
  });

  assert.equal(report.blocked, true);
  assert.equal(report.tracks.every((track) => track.blocked), true);
});

test("explicit collections removal is authorized without the general override", () => {
  const previous = summarizeCollections({
    collections: [{
      id: "starter-pack",
      featuredSkillIds: ["oldhandle/repo:one"],
      skillIds: [],
    }],
  });
  const report = evaluateCollectionsImpact({
    mode: "remove",
    tracks: [{ name: "v2", previous }, { name: "crawl4", previous }],
    proposed: null,
    metadata: { sourceCommit: "abc", policyDigest: "sha256:test" },
  });

  assert.equal(report.blocked, false);
  assert.equal(report.authorizedRemoval, true);
});

test("reviewed impact override permits a large membership edit and records its reason", () => {
  const previous = summarizeCollections({
    collections: [{
      id: "starter-pack",
      featuredSkillIds: ["oldhandle/repo:one", "other/repo:two"],
      skillIds: [],
    }],
  });
  const proposed = summarizeCollections({
    collections: [{
      id: "starter-pack",
      featuredSkillIds: ["oldhandle/repo:one"],
      skillIds: [],
    }],
  });
  const report = evaluateCollectionsImpact({
    mode: "publish",
    tracks: [{ name: "v2", previous }, { name: "crawl4", previous }],
    proposed,
    override: {
      enabled: true,
      reason: "reviewed editorial cleanup",
      errors: [],
    },
    metadata: { sourceCommit: "abc", policyDigest: "sha256:test" },
  });

  assert.equal(report.blocked, false);
  assert.equal(report.override.reason, "reviewed editorial cleanup");
});

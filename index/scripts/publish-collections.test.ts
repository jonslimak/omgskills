import test from "node:test";
import assert from "node:assert/strict";
import type { CreatorRegistrySource } from "../scraper/creator-registry.js";
import { buildCollectionsAsset, validateSource } from "./publish-collections.js";

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

test("alias-only creator validates and generates a non-empty profile", () => {
  const source = { version: 1, authorOverrides: {}, collections: [] };
  const registry: CreatorRegistrySource = {
    creators: [{ handle: "NewHandle", roles: ["creator"], watch: true, featured: true, aliases: ["oldhandle"] }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  assert.equal(asset.collections[0].authorHandle, "OldHandle");
  assert.deepEqual(asset.collections[0].featuredSkillIds, ["oldhandle/repo:one"]);
});

test("author override lookup is case-insensitive and alias-aware", () => {
  const source = {
    version: 1,
    authorOverrides: {
      oldhandle: {
        title: "Custom",
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

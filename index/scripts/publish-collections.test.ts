import test from "node:test";
import assert from "node:assert/strict";
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

test("featured creators come from registry, not legacy featuredAuthors", () => {
  const source = {
    version: 1,
    featuredAuthors: ["legacy"],
    authorOverrides: {},
    collections: [],
  };
  const registry = {
    creators: [{ handle: "OldHandle", roles: ["creator"], watch: true, featured: true }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  assert.deepEqual(asset.collections.map((collection) => collection.authorHandle), ["OldHandle"]);
});

test("zero featured registry fails when legacy featuredAuthors is non-empty", () => {
  assert.throws(
    () =>
      validateSource(
        { version: 1, featuredAuthors: ["legacy"], authorOverrides: {}, collections: [] },
        { creators: [] },
        skills,
      ),
    /zero featured creators/,
  );
});

test("featured creator must be watched", () => {
  assert.throws(
    () =>
      validateSource(
        { version: 1, featuredAuthors: [], authorOverrides: {}, collections: [] },
        { creators: [{ handle: "OldHandle", roles: ["creator"], watch: false, featured: true }] },
        skills,
      ),
    /must also be watched/,
  );
});

test("alias-only creator validates and generates a non-empty profile", () => {
  const source = { version: 1, featuredAuthors: [], authorOverrides: {}, collections: [] };
  const registry = {
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
    featuredAuthors: [],
    authorOverrides: {
      oldhandle: {
        title: "Custom",
        featuredSkillIds: ["oldhandle/repo:one"],
      },
    },
    collections: [],
  };
  const registry = {
    creators: [{ handle: "NewHandle", roles: ["creator"], watch: true, featured: true, aliases: ["OldHandle"] }],
  };

  validateSource(source, registry, skills);
  const asset = buildCollectionsAsset(source, registry, skills);

  assert.equal(asset.collections[0].title, "Custom");
  assert.deepEqual(asset.collections[0].featuredSkillIds, ["oldhandle/repo:one"]);
});

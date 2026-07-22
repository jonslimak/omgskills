import test from "node:test";
import assert from "node:assert/strict";
import { buildTrustedSeeds, loadTrustedSeeds, resolveCreatorHandle } from "./seeds.js";

test("loadTrustedSeeds reads official repo seed sets", () => {
  const seeds = loadTrustedSeeds();

  assert.ok(seeds.officialTier1Repos.has("openai/codex"));
  assert.ok(seeds.officialTier2Repos.has("browserbase/skills"));
  assert.ok(seeds.trustedVendorHandles.has("anthropics"));
  assert.ok(seeds.watchedCreatorHandles?.has("anthropics"));
  assert.ok(seeds.doNotCrawlRepos?.has("majiayu000/claude-skill-registry"));
  assert.ok(seeds.doNotCrawlRepos?.has("majiayu000/claude-skill-registry-data"));
  assert.ok(seeds.doNotCrawlRepos?.has("supercent-io/skills-template"));
  assert.ok(seeds.doNotCrawlRepos?.has("anthropics/claude-for-legal"));
  assert.ok(seeds.doNotCrawlOwners?.has("user-attachments"));
  assert.ok((seeds.suppressedSkillIds?.size ?? 0) > 0);
  assert.deepEqual([...seeds.manualIncludeRepos], []);
});

test("buildTrustedSeeds normalizes and dedupes official repo entries", () => {
  const seeds = buildTrustedSeeds({
    creatorRegistryJson: { creators: [] },
    officialJson: {
      tier1: [" OpenAI/Codex ", "openai/codex.git", ""],
      tier2: ["Browserbase/Skills", "browserbase/skills", "   "],
    },
    manualIncludeJson: {
      include: [" Owner/Repo ", "owner/repo.git", ""],
    },
    doNotCrawlJson: {
      repos: [{ repo: " Blocked/Repo.git ", reason: "catalog" }],
      owners: [{ owner: " BlockedOwner ", reason: "spam" }],
    },
    suppressedSkillsJson: {
      skills: [{ id: " Owner/Repo:Skill ", reason: "duplicate", replacementId: "owner/repo:canonical" }],
    },
    overridesJson: [],
    catalogJson: [],
    provenanceJson: [],
  });

  assert.deepEqual([...seeds.officialTier1Repos], ["openai/codex"]);
  assert.deepEqual([...seeds.officialTier2Repos], ["browserbase/skills"]);
  assert.deepEqual([...seeds.manualIncludeRepos], ["owner/repo"]);
  assert.deepEqual([...(seeds.doNotCrawlRepos ?? [])], ["blocked/repo"]);
  assert.deepEqual([...(seeds.doNotCrawlOwners ?? [])], ["blockedowner"]);
  assert.deepEqual([...(seeds.suppressedSkillIds ?? [])], ["owner/repo:skill"]);
  assert.equal(seeds.suppressedSkillRules?.[0]?.id, "Owner/Repo:Skill");
});

test("buildTrustedSeeds derives trust only from the creator registry", () => {
  const seeds = buildTrustedSeeds({
    creatorRegistryJson: {
      creators: [
        { handle: "RegistryVendor", roles: ["vendor"], watch: true },
        { handle: "RegistryCreator", roles: ["creator"], watch: true },
      ],
    },
    officialJson: {},
    manualIncludeJson: {},
    doNotCrawlJson: {},
    overridesJson: [],
    catalogJson: [],
    provenanceJson: [],
  });

  assert.ok(seeds.trustedVendorHandles.has("registryvendor"));
  assert.ok(seeds.trustedCreatorHandles.has("registrycreator"));
  assert.ok(seeds.watchedCreatorHandles?.has("registryvendor"));
  assert.ok(seeds.watchedCreatorHandles?.has("registrycreator"));
});

test("buildTrustedSeeds supports an empty creator registry", () => {
  const seeds = buildTrustedSeeds({
    creatorRegistryJson: { creators: [] },
    officialJson: {},
    manualIncludeJson: {},
    doNotCrawlJson: {},
    overridesJson: [],
    catalogJson: [],
    provenanceJson: [],
  });

  assert.deepEqual([...seeds.trustedVendorHandles], []);
  assert.deepEqual([...seeds.trustedCreatorHandles], []);
});

test("creator aliases resolve case-insensitively to canonical handles", () => {
  const seeds = buildTrustedSeeds({
    creatorRegistryJson: {
      creators: [{ handle: "NewHandle", roles: ["creator"], watch: true, aliases: ["OldHandle"] }],
    },
    officialJson: {},
    manualIncludeJson: {},
    doNotCrawlJson: {},
    overridesJson: [],
    catalogJson: [],
    provenanceJson: [],
  });

  assert.equal(resolveCreatorHandle(seeds, "OLDHANDLE"), "newhandle");
  assert.equal(resolveCreatorHandle(seeds, "UnknownHandle"), "unknownhandle");
});

test("creator registry rejects duplicate alias ownership", () => {
  assert.throws(
    () =>
      buildTrustedSeeds({
        creatorRegistryJson: {
          creators: [
            { handle: "First", roles: ["creator"], watch: true, aliases: ["Shared"] },
            { handle: "Second", roles: ["creator"], watch: true, aliases: ["shared"] },
          ],
        },
        officialJson: {},
        manualIncludeJson: {},
        doNotCrawlJson: {},
        overridesJson: [],
        catalogJson: [],
        provenanceJson: [],
      }),
    /handle or alias shared maps to both first and second/,
  );
});

test("creator registry rejects featured creators that are not watched", () => {
  assert.throws(
    () =>
      buildTrustedSeeds({
        creatorRegistryJson: {
          creators: [{ handle: "Featured", roles: ["creator"], watch: false, featured: true }],
        },
        officialJson: {},
        manualIncludeJson: {},
        doNotCrawlJson: {},
        overridesJson: [],
        catalogJson: [],
        provenanceJson: [],
      }),
    /featured creators must be watched/,
  );
});

test("creator registry rejects unknown roles", () => {
  assert.throws(
    () =>
      buildTrustedSeeds({
        creatorRegistryJson: {
          creators: [{ handle: "Unknown", roles: ["partner" as never], watch: true }],
        },
        officialJson: {},
        manualIncludeJson: {},
        doNotCrawlJson: {},
        overridesJson: [],
        catalogJson: [],
        provenanceJson: [],
      }),
    /unknown role partner/,
  );
});

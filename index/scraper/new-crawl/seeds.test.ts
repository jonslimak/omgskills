import test from "node:test";
import assert from "node:assert/strict";
import { buildTrustedSeeds, loadTrustedSeeds } from "./seeds.js";

test("loadTrustedSeeds reads official repo seed sets", () => {
  const seeds = loadTrustedSeeds();

  assert.ok(seeds.officialTier1Repos.has("openai/codex"));
  assert.ok(seeds.officialTier2Repos.has("browserbase/skills"));
  assert.deepEqual([...seeds.manualIncludeRepos], []);
});

test("buildTrustedSeeds normalizes and dedupes official repo entries", () => {
  const seeds = buildTrustedSeeds({
    vendorJson: { handles: [] },
    creatorJson: { handles: [] },
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
    overridesJson: [],
    catalogJson: [],
    provenanceJson: [],
  });

  assert.deepEqual([...seeds.officialTier1Repos], ["openai/codex"]);
  assert.deepEqual([...seeds.officialTier2Repos], ["browserbase/skills"]);
  assert.deepEqual([...seeds.manualIncludeRepos], ["owner/repo"]);
  assert.deepEqual([...(seeds.doNotCrawlRepos ?? [])], ["blocked/repo"]);
  assert.deepEqual([...(seeds.doNotCrawlOwners ?? [])], ["blockedowner"]);
});

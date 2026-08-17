import assert from "node:assert/strict";
import test from "node:test";
import type { CreatorRegistrySource } from "../scraper/creator-registry.js";
import { formatCreatorRegistry } from "./editool-creator-format.js";

test("creator formatting preserves coverage fields in stable key order", () => {
  const source: CreatorRegistrySource = {
    creators: [{
      handle: "DisplayCase",
      roles: ["creator"],
      watch: true,
      featured: false,
      aliases: ["old-handle"],
      skillCoverage: "selected",
      skillRepos: ["DisplayCase/skills"],
      skillPathExclusions: ["DisplayCase/skills#examples/"],
      notes: "Reviewed coverage",
    }],
  };

  const formatted = formatCreatorRegistry(source);
  assert.equal(
    formatted,
    `{\n  "creators": [\n    { "handle": "DisplayCase", "roles": ["creator"], "watch": true, "featured": false, "aliases": ["old-handle"], "skillCoverage": "selected", "skillRepos": ["DisplayCase/skills"], "skillPathExclusions": ["DisplayCase/skills#examples/"], "notes": "Reviewed coverage" }\n  ]\n}\n`,
  );
  assert.deepEqual(JSON.parse(formatted), source);
  assert.equal(formatCreatorRegistry(JSON.parse(formatted) as CreatorRegistrySource), formatted);
});

test("creator formatting keeps all coverage without adding an empty repo list", () => {
  const source: CreatorRegistrySource = {
    creators: [{ handle: "creator", watch: true, featured: false, skillCoverage: "all" }],
  };
  const formatted = formatCreatorRegistry(source);
  assert.match(formatted, /"skillCoverage": "all"/);
  assert.doesNotMatch(formatted, /skillRepos/);
});

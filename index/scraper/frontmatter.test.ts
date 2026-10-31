import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, stripFrontmatter } from "./frontmatter.js";

test("valid YAML frontmatter parses as before", () => {
  assert.deepEqual(
    parseFrontmatter("---\nname: review\ndescription: >\n  Reviews code\n  carefully.\ntags: [a, b]\n---\n# Body"),
    { name: "review", description: "Reviews code carefully.\n", tags: ["a", "b"] },
  );
});

test("a byte-order mark, Windows line endings and leading blank lines are accepted", () => {
  for (const content of [
    "﻿---\nname: kmp\ndescription: Glass UI\n---\n",
    "---\r\nname: kmp\r\ndescription: Glass UI\r\n---\r\n",
    "\n\n---\nname: kmp\ndescription: Glass UI\n---\n",
  ]) assert.deepEqual(parseFrontmatter(content), { name: "kmp", description: "Glass UI" }, JSON.stringify(content));
});

test("strict-invalid YAML falls back to the top-level name and description lines", () => {
  // Unquoted colons inside the description.
  assert.deepEqual(
    parseFrontmatter("---\nname: convex-agents\ndescription: Builds agents: threads, messages, tools\nwhen_to_use: Ask: \"x\"\n---\n"),
    { name: "convex-agents", description: "Builds agents: threads, messages, tools" },
  );
  // An apostrophe inside a single-quoted value.
  assert.deepEqual(
    parseFrontmatter("---\nname: retro\ndescription: 'Review each ticket's story file'\n---\n"),
    { name: "retro", description: "Review each ticket's story file" },
  );
  // A block scalar and an unclosed block that runs into the body.
  assert.deepEqual(
    parseFrontmatter("---\nname: dbg\ndescription: |\n  Root cause: logs first.\n  Then bisect.\ngraph:\n  roles: [a]\n2. DO NOT guess\n---\n"),
    { name: "dbg", description: "Root cause: logs first.\nThen bisect." },
  );
});

test("frontmatter without a name keeps its description; no block at all still fails", () => {
  assert.deepEqual(parseFrontmatter("---\n# generated\ndescription: \"Audit: drift\"\nmeta: {a: [}\n---\n"), { description: "Audit: drift" });
  assert.equal(parseFrontmatter("# TanStack Router\n\nNo frontmatter."), null);
  assert.equal(parseFrontmatter("/Users/me/.claude/skills/canary/SKILL.md"), null);
  assert.equal(parseFrontmatter("---\nname: open\ndescription: never closed\n"), null);
  assert.equal(parseFrontmatter("---\nversion: 1.0.0description: glued\n---\n"), null);
});

test("stripFrontmatter ignores a byte-order mark", () => {
  assert.equal(stripFrontmatter("﻿---\nname: a\n---\n# Body"), "\n# Body");
  assert.equal(stripFrontmatter("# Only body"), "# Only body");
});

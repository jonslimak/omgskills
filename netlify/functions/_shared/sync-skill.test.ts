import assert from "node:assert/strict";
import test from "node:test";
import { parseSyncSkill } from "./sync-skill.js";

function skill(overrides: Record<string, unknown> = {}) {
  return {
    stableKey: "location:v1:codex:review",
    installationPath: "review",
    identityStatus: "resolved",
    name: "review",
    description: "Review code",
    catalogSkillId: "owner/repo:review",
    githubUrl: "https://github.com/owner/repo",
    isLocalOnly: true,
    source: "Codex",
    ...overrides
  };
}

test("preserves a valid location key and derives local-only from status", () => {
  const parsed = parseSyncSkill(skill());

  assert.equal(parsed.stableKey, "location:v1:codex:review");
  assert.equal(parsed.identityStatus, "resolved");
  assert.equal(parsed.isLocalOnly, false);
});

test("rejects a location key that does not match source and path", () => {
  assert.throws(
    () => parseSyncSkill(skill({ stableKey: "location:v1:claude:review" })),
    (error) => error instanceof Response && error.status === 400
  );
});

test("rejects contradictory new identity fields", () => {
  assert.throws(
    () => parseSyncSkill(skill({ identityStatus: "localOnly" })),
    (error) => error instanceof Response && error.status === 400
  );
});

test("keeps ambiguous and local-only states distinct", () => {
  const ambiguous = parseSyncSkill(skill({
    identityStatus: "ambiguous",
    catalogSkillId: null,
    isLocalOnly: true
  }));
  const localOnly = parseSyncSkill(skill({
    identityStatus: "localOnly",
    catalogSkillId: null,
    isLocalOnly: false
  }));

  assert.equal(ambiguous.isLocalOnly, false);
  assert.equal(localOnly.isLocalOnly, true);
});

test("keeps legacy clients compatible while normalizing identity", () => {
  const parsed = parseSyncSkill({
    stableKey: "ignored-by-legacy-github-row",
    identityStatus: "resolved",
    name: "review",
    catalogSkillId: "owner/repo:review",
    githubUrl: "https://github.com/owner/repo",
    isLocalOnly: true,
    source: "Claude"
  });

  assert.equal(parsed.stableKey, "https://github.com/owner/repo#review");
  assert.equal(parsed.isLocalOnly, false);
});

test("Claude and Codex location keys replace the legacy merged snapshot key", () => {
  const claude = parseSyncSkill(skill({
    stableKey: "location:v1:claude:review",
    source: "Claude"
  }));
  const codex = parseSyncSkill(skill());

  assert.notEqual(claude.stableKey, codex.stableKey);
  assert.deepEqual(
    [claude.stableKey, codex.stableKey],
    ["location:v1:claude:review", "location:v1:codex:review"]
  );
  assert.equal([claude.stableKey, codex.stableKey].includes("https://github.com/owner/repo#review"), false);
});

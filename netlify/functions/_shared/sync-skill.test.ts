import assert from "node:assert/strict";
import test from "node:test";
import { installationFolderFromKey, parsePresenceSkill, parseSyncReport, parseSyncSkill } from "./sync-skill.js";
import { inventoryReadVersion } from "./sync-inventory-read.js";
import { performSyncUpload } from "./sync-upload.js";
import type { Pool } from "pg";

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

test("Set origin is optional, nullable and bounded in legacy and presence reports", () => {
  for (const value of [undefined, null, "", " Team Skills "]) {
    for (const parse of [parseSyncSkill, parsePresenceSkill]) {
      const body = parse === parseSyncSkill ? skill() : { source: "codex", installationPath: "review", name: "review" };
      const parsed = parse({ ...body, ...(value === undefined ? {} : { installedFromSet: value }) });
      assert.equal(parsed.installedFromSet, value === undefined ? undefined : value?.trim() || null);
    }
  }
  for (const value of [17, {}, [], "x".repeat(201)]) {
    for (const parse of [parseSyncSkill, parsePresenceSkill]) {
      const body = parse === parseSyncSkill ? skill() : { source: "codex", installationPath: "review", name: "review" };
      assert.throws(() => parse({ ...body, installedFromSet: value }), e => e instanceof Response && e.status === 400);
    }
  }
});

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

const presence = {
  source: "codex", installationPath: "review", name: "Review",
  skillMdSha: "A".repeat(40), githubUrl: "https://github.com/Owner/Repo.git/",
  gitRelativePath: "skills/review", catalogSkillIdHint: "owner/repo:skills/review"
};
const badRequest = (error: unknown) => error instanceof Response && error.status === 400;

test("presence derives location and unresolved identity without trusting hints", () => {
  const parsed = parsePresenceSkill(presence);
  assert.equal(parsed.stableKey, "location:v1:codex:review");
  assert.equal(parsed.githubUrl, "https://github.com/owner/repo");
  assert.equal(parsed.skillMdSha, "a".repeat(40));
  assert.equal(parsed.catalogSkillId, null);
  assert.equal(parsed.identityStatus, "ambiguous");
  assert.equal(parsed.catalogSkillIdHint, presence.catalogSkillIdHint);
  const local = parsePresenceSkill({ source: "agents", installationPath: "Review", name: "Review", gitRelativePath: "." });
  assert.equal(local.gitRelativePath, "");
  assert.equal(local.identityStatus, "localOnly");
});

for (const [field, values] of Object.entries({
  source: ["Codex", "cursor", ""],
  installationPath: [".", "..", "/tmp/secret", "a/b", "a\\b", "a\u0000b", "a\nb", " review", "x".repeat(501)],
  githubUrl: ["https://secret@github.com/o/r", "https://github.com/o/r?token=secret", "https://github.com/o/r#secret", "http://github.com/o/r", "https://evil.test/o/r", "https://github.com/o/r/tree/main", "git@github.com:o/r.git"],
  gitRelativePath: ["/skills", "../skills", "a/../b", "a//b", "a\\b", "C:/skills", "a\u0000b", 42],
  skillMdSha: ["bad", "x".repeat(40), "a".repeat(41)],
  name: ["", "x".repeat(201)],
  description: ["x".repeat(2001)],
  catalogSkillIdHint: ["x".repeat(501)]
})) {
  test(`presence rejects invalid ${field}`, () => {
    for (const value of values) assert.throws(() => parsePresenceSkill({ ...presence, [field]: value }), badRequest);
  });
}

test("presence rejects client-selected or verified identities and extra content", () => {
  for (const key of ["stableKey", "identityStatus", "catalogSkillId", "userId", "deviceId", "content"]) {
    assert.throws(() => parsePresenceSkill({ ...presence, [key]: "untrusted" }), badRequest);
  }
  for (const key of ["userId", "deviceId", "accountId", "token", "timestamp"]) {
    assert.throws(() => parseSyncReport({ reportVersion: 2, skills: [], [key]: "untrusted" }), badRequest);
  }
});

test("report versions never downgrade; bounds and duplicate keys apply to both modes", () => {
  for (const reportVersion of [null, "2", 0, 1, 3, false]) {
    assert.throws(() => parseSyncReport({ reportVersion, skills: [] }), badRequest);
  }
  assert.equal(parseSyncReport({ skills: [skill()] }).reportVersion, 1);
  assert.equal(parseSyncReport({ reportVersion: 2, skills: [] }).reportVersion, 2);
  for (const report of [{ skills: [skill(), skill()] }, { reportVersion: 2, skills: [presence, presence] },
    { reportVersion: 2, skills: Array(1001).fill(presence) }, { reportVersion: 2, skills: {} }]) {
    assert.throws(() => parseSyncReport(report), badRequest);
  }
  assert.throws(() => parsePresenceSkill([]), badRequest);
});

test("read version is explicit and historical paths cannot become folder names", () => {
  const req = (suffix: string) => new Request(`https://example.test/api/portal/synced-skills${suffix}`);
  assert.equal(inventoryReadVersion(req("")), 1);
  assert.equal(inventoryReadVersion(req("?version=1")), 1);
  assert.equal(inventoryReadVersion(req("?version=2")), 2);
  for (const suffix of ["?version=3", "?version=1&version=1", "?version=2&version=2", "?version="]) {
    assert.throws(() => inventoryReadVersion(req(suffix)), badRequest);
  }
  assert.equal(installationFolderFromKey("codex:/Users/person/.codex/skills/review", "codex"), null);
  assert.equal(installationFolderFromKey("location:v1:claude:review", "codex"), null);
});

test("version 2 refuses legacy authentication before opening a database connection", async () => {
  const pool = { connect() { assert.fail("must not connect"); } } as unknown as Pool;
  await assert.rejects(performSyncUpload(pool, { kind: "legacy", token: "old" }, [], new Date(), 2), badRequest);
});

test("version 3 parses only explicit complete coverage and keeps presence metadata validation", async () => {
  const report = { reportVersion: 3, baseRevision: null,
    roots: ["claude", "codex", "agents"].map(source => ({ source, state: "complete" })),
    skills: [{ source: "codex", installationPath: "review", name: "Review" }] };
  const parsed = parseSyncReport(report);
  assert.equal(parsed.reportVersion, 3);
  assert.deepEqual(parsed.reconciliation, { baseRevision: null, roots: report.roots });
  assert.equal(parsed.skills[0].stableKey, "location:v1:codex:review");
  for (const invalid of [
    { ...report, token: "legacy" }, { ...report, deviceId: "other" },
    { ...report, skills: [report.skills[0], report.skills[0]] },
    { ...report, skills: [{ ...report.skills[0], installationPath: "/Users/private/review" }] },
    { ...report, skills: Array(1001).fill(report.skills[0]) },
    { reportVersion: 2, skills: [], roots: report.roots },
    { ...report, roots: report.roots.slice(1) }
  ]) assert.throws(() => parseSyncReport(invalid), badRequest);
  const pool = { connect() { assert.fail("must not connect"); } } as unknown as Pool;
  await assert.rejects(performSyncUpload(pool, { kind: "legacy", token: "old" }, [], new Date(), 3, parsed.reconciliation), badRequest);
  await assert.rejects(performSyncUpload(pool, { kind: "device", request: new Request("http://localhost") }, [], new Date(), 3), badRequest);
});

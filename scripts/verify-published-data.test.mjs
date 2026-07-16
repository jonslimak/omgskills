import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "verify-published-data.mjs");
const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

function writeAsset(dataDir, name, value) {
  const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(join(dataDir, name), data);
  return {
    path: name,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
  };
}

function verifyFixture({ skills, shaHistory, collections }) {
  const root = mkdtempSync(join(tmpdir(), "verify-published-data-test-"));
  const dataDir = join(root, "site", "data", "test");
  mkdirSync(dataDir, { recursive: true });

  try {
    const manifest = {
      version: 1,
      skills: writeAsset(dataDir, "skills.json", skills),
      trending: writeAsset(dataDir, "trending.json", []),
      shaHistory: writeAsset(dataDir, "sha-history.json", shaHistory),
    };
    if (collections !== undefined) {
      manifest.collections = writeAsset(dataDir, "collections.json", collections);
    }
    writeFileSync(join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      env: { ...process.env, OMGSKILLS_DATA_SUBDIR: "test" },
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function skill(id, sha) {
  return { id, author_handle: "owner", skill_md_sha: sha };
}

function history(canonicalBySha) {
  const value = {
    version: 1,
    generatedAt: "2026-07-15T00:00:00.000Z",
    shaToSkillIds: {
      [shaA]: ["owner/repo:one", "owner/repo:two"],
    },
  };
  if (canonicalBySha !== undefined) value.canonicalBySha = canonicalBySha;
  return value;
}

test("accepts historical SHA assets without canonicalBySha", () => {
  const result = verifyFixture({
    skills: [skill("owner/repo:one", shaA)],
    shaHistory: history(undefined),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).canonicalByShaCount, 0);
  assert.equal(JSON.parse(result.stdout).collectionsCount, 0);
});

test("accepts a live high-confidence same-repository canonical mapping", () => {
  const result = verifyFixture({
    skills: [skill("owner/repo:one", shaA), skill("owner/repo:two", shaA)],
    shaHistory: history({
      [shaA]: { skillId: "owner/repo:one", confidence: "high", reason: "same-repo" },
    }),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).canonicalByShaCount, 1);
});

test("rejects invalid canonical mappings", async (t) => {
  const cases = [
    {
      name: "non-member ID",
      skills: [skill("owner/repo:one", shaA), skill("other/repo:one", shaA)],
      entry: { skillId: "other/repo:one", confidence: "high", reason: "same-repo" },
      error: "is not a member",
    },
    {
      name: "non-live ID",
      skills: [skill("owner/repo:one", shaA)],
      entry: { skillId: "owner/repo:two", confidence: "high", reason: "same-repo" },
      error: "is not live",
    },
    {
      name: "mismatched live SHA",
      skills: [skill("owner/repo:one", shaA), skill("owner/repo:two", shaB)],
      entry: { skillId: "owner/repo:two", confidence: "high", reason: "same-repo" },
      error: "SHA does not match",
    },
    {
      name: "unsupported confidence",
      skills: [skill("owner/repo:one", shaA)],
      entry: { skillId: "owner/repo:one", confidence: "medium", reason: "trusted-creator" },
      error: "must be high-confidence same-repo",
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const result = verifyFixture({
        skills: fixture.skills,
        shaHistory: history({ [shaA]: fixture.entry }),
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(fixture.error));
    });
  }
});

test("accepts a structurally valid collections asset", () => {
  const result = verifyFixture({
    skills: [skill("owner/repo:one", shaA)],
    shaHistory: history(undefined),
    collections: {
      version: 1,
      generatedAt: "2026-07-16T00:00:00.000Z",
      collections: [
        {
          id: "author-owner",
          type: "author",
          title: "Owner",
          subtitle: "Skills by @owner",
          authorHandle: "owner",
          featuredSkillIds: ["owner/repo:one"],
        },
        {
          id: "starter",
          type: "topic",
          title: "Starter",
          subtitle: "Starter skills",
          featuredSkillIds: ["owner/repo:one"],
          skillIds: ["owner/repo:one"],
        },
      ],
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).collectionsCount, 2);
  assert.equal(JSON.parse(result.stdout).staleCollectionReferenceCount, 0);
});

test("warns without blocking when a collection references a missing track skill", () => {
  const result = verifyFixture({
    skills: [skill("owner/repo:one", shaA)],
    shaHistory: history(undefined),
    collections: {
      version: 1,
      generatedAt: "2026-07-16T00:00:00.000Z",
      collections: [
        {
          id: "starter",
          type: "topic",
          title: "Starter",
          subtitle: "Starter skills",
          featuredSkillIds: ["owner/repo:missing"],
          skillIds: ["owner/repo:missing"],
        },
      ],
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: starter references owner\/repo:missing/);
  assert.equal(JSON.parse(result.stdout).staleCollectionReferenceCount, 1);
});

test("rejects malformed collections assets", async (t) => {
  const cases = [
    {
      name: "array payload",
      collections: [],
      error: "collections payload must be an object",
    },
    {
      name: "duplicate collection IDs",
      collections: {
        version: 1,
        generatedAt: "2026-07-16T00:00:00.000Z",
        collections: [
          {
            id: "duplicate",
            type: "topic",
            title: "One",
            subtitle: "One",
            featuredSkillIds: [],
            skillIds: [],
          },
          {
            id: "duplicate",
            type: "topic",
            title: "Two",
            subtitle: "Two",
            featuredSkillIds: [],
            skillIds: [],
          },
        ],
      },
      error: "duplicate id",
    },
    {
      name: "author without handle",
      collections: {
        version: 1,
        generatedAt: "2026-07-16T00:00:00.000Z",
        collections: [
          {
            id: "author-owner",
            type: "author",
            title: "Owner",
            subtitle: "Owner skills",
            featuredSkillIds: [],
          },
        ],
      },
      error: "missing authorHandle",
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const result = verifyFixture({
        skills: [skill("owner/repo:one", shaA)],
        shaHistory: history(undefined),
        collections: fixture.collections,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(fixture.error));
    });
  }
});

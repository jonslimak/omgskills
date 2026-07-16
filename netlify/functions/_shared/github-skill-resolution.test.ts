import assert from "node:assert/strict";
import test from "node:test";
import {
  GithubSkillValidationError,
  gitBlobSha,
  groupItemForValidatedGithubSkill,
  resolveCatalogSkillId,
  validateGithubSkill,
  type ValidatedGithubSkill,
} from "./github-skill-resolution.js";
import type {
  PublishedCatalogIdentity,
  ShaHistoryAsset,
} from "./published-catalog.js";
import { resolvePublicSkillLink } from "./public-skill-links.js";

const sha = "a".repeat(40);

function identity(
  liveSkillIds: string[],
  shaHistory: ShaHistoryAsset | null,
): PublishedCatalogIdentity {
  return {
    track: "fixture",
    liveSkillIds: new Set(liveSkillIds),
    shaHistory,
  };
}

function history(
  ids: unknown,
  canonicalBySha?: ShaHistoryAsset["canonicalBySha"],
): ShaHistoryAsset {
  return {
    version: 1,
    shaToSkillIds: { [sha]: ids },
    ...(canonicalBySha ? { canonicalBySha } : {}),
  };
}

function validated(skillMdSha = sha): ValidatedGithubSkill {
  return {
    githubUrl: "https://github.com/owner/repo/blob/main/skills/example/SKILL.md",
    rawSkillUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/example/SKILL.md",
    name: "Example",
    description: "Example skill",
    skillMdSha,
  };
}

test("computes the standard Git blob SHA from exact bytes", () => {
  const bytes = new TextEncoder().encode("hello\n");
  assert.equal(gitBlobSha(bytes), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.notEqual(gitBlobSha(new TextEncoder().encode("hello\r\n")), gitBlobSha(bytes));
});

test("validates SKILL.md from exact fetched bytes and preserves its snapshot", async () => {
  const markdown = "---\r\nname: Example\r\ndescription: Exact bytes\r\n---\r\nBody\r\n";
  const bytes = new TextEncoder().encode(markdown);
  const result = await validateGithubSkill(
    "https://github.com/owner/repo/blob/main/skills/example/SKILL.md",
    (async () => new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.byteLength) },
    })) as typeof fetch,
  );

  assert.equal(result.name, "Example");
  assert.equal(result.description, "Exact bytes");
  assert.equal(result.skillMdSha, gitBlobSha(bytes));
  assert.equal(
    result.rawSkillUrl,
    "https://raw.githubusercontent.com/owner/repo/main/skills/example/SKILL.md",
  );
});

test("accepts a root-level GitHub blob URL", async () => {
  const markdown = "---\nname: Root\ndescription: Root skill\n---\n";
  const requested: string[] = [];
  const result = await validateGithubSkill(
    "https://github.com/owner/repo/blob/main/SKILL.md",
    (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(markdown, { status: 200 });
    }) as typeof fetch,
  );

  assert.deepEqual(requested, ["https://raw.githubusercontent.com/owner/repo/main/SKILL.md"]);
  assert.equal(result.name, "Root");
});

test("rejects non-SKILL.md and non-public GitHub URLs", async () => {
  const fetcher = (async () => new Response("", { status: 404 })) as typeof fetch;
  await assert.rejects(
    validateGithubSkill("https://github.com/owner/repo/blob/main/README.md", fetcher),
    GithubSkillValidationError,
  );
  await assert.rejects(
    validateGithubSkill("http://github.com/owner/repo", fetcher),
    GithubSkillValidationError,
  );
});

test("resolves one live SHA candidate and ignores stale history members", () => {
  assert.deepEqual(
    resolveCatalogSkillId(sha, identity(
      ["live/repo:skill"],
      history(["stale/repo:skill", "live/repo:skill"]),
    )),
    {
      status: "resolved",
      catalogSkillId: "live/repo:skill",
      reason: "unique",
    },
  );
});

test("uses only a valid live canonical mapping for ambiguous candidates", () => {
  const candidates = ["owner/repo:first", "owner/repo:second"];
  assert.deepEqual(
    resolveCatalogSkillId(sha, identity(
      candidates,
      history(candidates, {
        [sha]: {
          skillId: "owner/repo:second",
          confidence: "high",
          reason: "same-repo",
        },
      }),
    )),
    {
      status: "resolved",
      catalogSkillId: "owner/repo:second",
      reason: "canonical",
    },
  );

  assert.deepEqual(
    resolveCatalogSkillId(sha, identity(
      candidates,
      history(candidates, {
        [sha]: {
          skillId: "other/repo:skill",
          confidence: "high",
          reason: "same-repo",
        },
      }),
    )),
    { status: "unresolved", reason: "ambiguous" },
  );
});

test("keeps ambiguous, unresolved, and unavailable matches as GitHub items", () => {
  const candidates = ["owner/repo:first", "owner/repo:second"];
  const ambiguous = identity(candidates, history(candidates));
  const missing = identity([], history(["stale/repo:skill"]));

  for (const catalogIdentity of [ambiguous, missing, null]) {
    assert.deepEqual(
      groupItemForValidatedGithubSkill(validated(), catalogIdentity),
      {
        kind: "github",
        githubUrl: validated().githubUrl,
        name: "Example",
        description: "Example skill",
      },
    );
  }
});

test("stores unique and canonical matches as catalog items with the validated snapshot", () => {
  const catalogIdentity = identity(
    ["owner/repo:skill"],
    history(["owner/repo:skill"]),
  );
  assert.deepEqual(
    groupItemForValidatedGithubSkill(validated(), catalogIdentity),
    {
      kind: "catalog",
      catalogSkillId: "owner/repo:skill",
      githubUrl: validated().githubUrl,
      name: "Example",
      description: "Example skill",
    },
  );
});

test("a resolved GitHub item uses F1's exact generated catalog page", () => {
  const resolvedItem = groupItemForValidatedGithubSkill(
    validated(),
    identity(["owner/repo:skill"], history(["owner/repo:skill"])),
  );
  assert.equal(resolvedItem.kind, "catalog");
  if (resolvedItem.kind !== "catalog") {
    return;
  }

  assert.deepEqual(
    resolvePublicSkillLink({
      catalogSkillId: resolvedItem.catalogSkillId,
      githubUrl: resolvedItem.githubUrl,
    }, new Map([["owner/repo:skill", "/skills/owner/repo/skill--1234abcd/"]])),
    {
      kind: "skillPage",
      url: "/skills/owner/repo/skill--1234abcd/",
    },
  );
});

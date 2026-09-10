import assert from "node:assert/strict";
import test from "node:test";
import type { ValidatedGithubSkill } from "./github-skill-resolution.js";
import {
  PublicReleaseResolutionError,
  resolveCatalogPublicRelease,
  resolveGithubPublicRelease,
} from "./public-releases.js";

const commitSha = "a".repeat(40);
const rootTreeSha = "b".repeat(40);
const skillTreeSha = "c".repeat(40);
const skillMdSha = "d".repeat(40);
const skillsTreeSha = "e".repeat(40);

function fixtureFetcher(
  fixtures: Record<string, { body: unknown; status?: number; headers?: HeadersInit }>,
  calls: string[] = [],
  expectedAuthorization?: string,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const fixture = fixtures[url];
    if (!fixture) return new Response("missing", { status: 404 });
    if (expectedAuthorization && init?.headers) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), expectedAuthorization);
    }
    return Response.json(fixture.body, {
      status: fixture.status ?? 200,
      headers: fixture.headers,
    });
  }) as typeof fetch;
}

function githubFixtures() {
  return {
    "https://api.github.com/repos/owner/repo": {
      body: { id: 123, full_name: "owner/repo", default_branch: "main" },
    },
    "https://api.github.com/repos/owner/repo/commits/main": {
      body: { sha: commitSha, commit: { tree: { sha: rootTreeSha } } },
    },
    [`https://api.github.com/repos/owner/repo/git/trees/${rootTreeSha}`]: {
      body: {
        sha: rootTreeSha,
        tree: [{ path: "skills", mode: "040000", type: "tree", sha: skillsTreeSha }],
      },
    },
    [`https://api.github.com/repos/owner/repo/git/trees/${skillsTreeSha}`]: {
      body: {
        sha: skillsTreeSha,
        tree: [{ path: "example", mode: "040000", type: "tree", sha: skillTreeSha }],
      },
    },
    [`https://api.github.com/repos/owner/repo/git/trees/${skillTreeSha}`]: {
      body: {
        sha: skillTreeSha,
        tree: [{ path: "SKILL.md", mode: "100644", type: "blob", sha: skillMdSha }],
      },
    },
  };
}

test("materializes a catalog skill from its published identity and current immutable coordinates", async () => {
  const calls: string[] = [];
  const release = await resolveCatalogPublicRelease("owner/repo:skills/example", {
    loadSkills: async () => [{
      id: "owner/repo:skills/example",
      github_url: "https://github.com/owner/repo",
      skill_md_path: "skills/example/SKILL.md",
      skill_md_sha: skillMdSha,
    }],
    fetcher: fixtureFetcher(githubFixtures(), calls, "Bearer test-token"),
    githubToken: "test-token",
  });

  assert.deepEqual(release, {
    source: {
      kind: "catalog",
      normalizedRoot: "skills/example",
      catalogSkillId: "owner/repo:skills/example",
    },
    coordinates: { commitSha, treeSha: skillTreeSha, skillMdSha },
    createdBy: "catalog:owner/repo:skills/example",
  });
  assert.equal(calls.length, 5);
});

test("materializes an unresolved public GitHub skill without converting its identity", async () => {
  const validated: ValidatedGithubSkill = {
    githubUrl: "https://github.com/owner/repo/blob/main/skills/example/SKILL.md",
    rawSkillUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/example/SKILL.md",
    name: "Example",
    description: "Example skill",
    skillMdSha,
  };
  const release = await resolveGithubPublicRelease(validated, {
    fetcher: fixtureFetcher(githubFixtures(), [], "Bearer test-token"),
    githubToken: "test-token",
  });

  assert.deepEqual(release, {
    source: {
      kind: "public_github",
      normalizedRoot: "skills/example",
      repositoryId: "123",
      repositorySlug: "owner/repo",
    },
    coordinates: { commitSha, treeSha: skillTreeSha, skillMdSha },
    createdBy: "github:owner/repo",
  });
});

test("fails closed when the published or validated SKILL.md no longer matches GitHub", async () => {
  await assert.rejects(
    resolveCatalogPublicRelease("owner/repo:skills/example", {
      loadSkills: async () => [{
        id: "owner/repo:skills/example",
        github_url: "https://github.com/owner/repo",
        skill_md_path: "skills/example/SKILL.md",
        skill_md_sha: "e".repeat(40),
      }],
      fetcher: fixtureFetcher(githubFixtures()),
    }),
    (error: unknown) => error instanceof PublicReleaseResolutionError
      && error.code === "skill_changed",
  );
});

test("preserves GitHub retry timing when public resolution is rate limited", async () => {
  const fetcher = fixtureFetcher({
    "https://api.github.com/repos/owner/repo": {
      body: { message: "rate limited" },
      status: 403,
      headers: { "retry-after": "17" },
    },
  });

  await assert.rejects(
    resolveCatalogPublicRelease("owner/repo", {
      loadSkills: async () => [{
        id: "owner/repo",
        github_url: "https://github.com/owner/repo",
        skill_md_sha: skillMdSha,
      }],
      fetcher,
    }),
    (error: unknown) => error instanceof PublicReleaseResolutionError
      && error.code === "rate_limited"
      && error.retryAfterSeconds === 17,
  );
});

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { GitHubBrokerClient, GitHubBrokerError } from "./github-broker.js";
import { gitObjectSha } from "./skill-package.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = {
  appId: 123,
  privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString()
};
const now = Date.parse("2026-08-27T18:00:00Z");
const secretToken = "ghs_private-token-value";

function mockFetch(options: {
  repositorySelection?: string;
  rootStatus?: number;
  rateLimited?: boolean;
} = {}) {
  const requests: Array<{ path: string; body: unknown; authorization: string }> = [];
  const fetchImpl = async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const headers = init.headers as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path, body, authorization: headers.authorization });
    if (options.rateLimited && path === "/app/installations/456") {
      return new Response(null, {
        status: 403,
        headers: { "x-ratelimit-reset": String(Math.floor(now / 1000) + 60) }
      });
    }
    if (path === "/app/installations/456") {
      return Response.json({
        id: 456,
        repository_selection: options.repositorySelection ?? "selected",
        account: { id: 789, login: "owner", type: "User" }
      });
    }
    if (path === "/app/installations/456/access_tokens") {
      const restrictedIds = Array.isArray(body?.repository_ids) ? body.repository_ids : null;
      return Response.json({
        token: secretToken,
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
        permissions: { contents: "read", metadata: "read" },
        ...(restrictedIds ? { repositories: restrictedIds.map((id: number) => ({ id })) } : {})
      });
    }
    if (path === "/installation/repositories") {
      return Response.json({
        repositories: [{
          id: 321,
          full_name: "owner/private-skills",
          name: "private-skills",
          private: true,
          default_branch: "main"
        }]
      });
    }
    if (path === "/repos/owner/private-skills/contents/skills/example/SKILL.md") {
      return options.rootStatus === 404
        ? new Response(null, { status: 404 })
        : Response.json({ type: "file", name: "SKILL.md" });
    }
    return new Response(null, { status: 404 });
  };
  return { fetchImpl: fetchImpl as typeof fetch, requests };
}

test("lists only installation-granted repository metadata without exposing tokens", async () => {
  const mock = mockFetch();
  const client = new GitHubBrokerClient(config, mock.fetchImpl, () => now);
  const repositories = await client.listRepositories("456");

  assert.deepEqual(repositories, [{
    id: "321",
    fullName: "owner/private-skills",
    name: "private-skills",
    isPrivate: true,
    defaultBranch: "main"
  }]);
  assert.doesNotMatch(JSON.stringify(repositories), /private-token/);
  const tokenRequest = mock.requests.find((request) => request.path.endsWith("/access_tokens"));
  assert.deepEqual(tokenRequest?.body, { permissions: { contents: "read" } });
});

test("skill-root verification restricts its token to one repository", async () => {
  const mock = mockFetch();
  const client = new GitHubBrokerClient(config, mock.fetchImpl, () => now);
  await client.verifySkillRoot("456", {
    id: "321",
    fullName: "owner/private-skills",
    name: "private-skills",
    isPrivate: true,
    defaultBranch: "main"
  }, "skills/example");

  const tokenRequest = mock.requests.find((request) => request.path.endsWith("/access_tokens"));
  assert.deepEqual(tokenRequest?.body, {
    permissions: { contents: "read" },
    repository_ids: [321]
  });
  assert.ok(mock.requests.some((request) => request.authorization === `Bearer ${secretToken}`));
});

test("all-repository grants and missing roots fail closed", async () => {
  await assert.rejects(
    new GitHubBrokerClient(config, mockFetch({ repositorySelection: "all" }).fetchImpl, () => now)
      .listRepositories("456"),
    (error: unknown) => error instanceof GitHubBrokerError && error.code === "installation_scope"
  );
  await assert.rejects(
    new GitHubBrokerClient(config, mockFetch({ rootStatus: 404 }).fetchImpl, () => now)
      .verifySkillRoot("456", {
        id: "321",
        fullName: "owner/private-skills",
        name: "private-skills",
        isPrivate: true,
        defaultBranch: "main"
      }, "skills/example"),
    (error: unknown) => error instanceof GitHubBrokerError && error.code === "skill_root_missing"
  );
});

test("rate-limit errors expose a bounded retry without upstream response content", async () => {
  const client = new GitHubBrokerClient(config, mockFetch({ rateLimited: true }).fetchImpl, () => now);
  await assert.rejects(client.getInstallation("456"), (error: unknown) => {
    assert.ok(error instanceof GitHubBrokerError);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryAfterSeconds, 60);
    assert.doesNotMatch(error.message, /token|authorization/i);
    return true;
  });
});

test("resolves and validates a nested immutable skill package", async () => {
  const skillData = Buffer.from("# Example\n");
  const skillMdSha = gitObjectSha("blob", skillData);
  const subtreeSha = gitObjectSha("tree", Buffer.concat([
    Buffer.from("100644 SKILL.md\0"),
    Buffer.from(skillMdSha, "hex")
  ]));
  const commitSha = "a".repeat(40);
  const rootTreeSha = "b".repeat(40);
  const skillsTreeSha = "c".repeat(40);
  const requests: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/access_tokens")) {
      return Response.json({
        token: secretToken,
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
        permissions: { contents: "read", metadata: "read" },
        repositories: [{ id: 321 }]
      });
    }
    if (url.pathname.endsWith("/git/ref/heads/main")) {
      return Response.json({ object: { type: "commit", sha: commitSha } });
    }
    if (url.pathname.endsWith(`/git/commits/${commitSha}`)) {
      return Response.json({ sha: commitSha, tree: { sha: rootTreeSha } });
    }
    if (url.pathname.endsWith(`/git/trees/${rootTreeSha}`)) {
      return Response.json({
        sha: rootTreeSha,
        tree: [{ path: "skills", mode: "040000", type: "tree", sha: skillsTreeSha }]
      });
    }
    if (url.pathname.endsWith(`/git/trees/${skillsTreeSha}`)) {
      return Response.json({
        sha: skillsTreeSha,
        tree: [{ path: "example", mode: "040000", type: "tree", sha: subtreeSha }]
      });
    }
    if (url.pathname.endsWith(`/git/trees/${subtreeSha}`) && url.search === "?recursive=1") {
      return Response.json({
        sha: subtreeSha,
        truncated: false,
        tree: [{
          path: "SKILL.md",
          mode: "100644",
          type: "blob",
          sha: skillMdSha,
          size: skillData.byteLength
        }]
      });
    }
    if (url.pathname.endsWith(`/git/blobs/${skillMdSha}`)) {
      return Response.json({
        sha: skillMdSha,
        encoding: "base64",
        content: skillData.toString("base64"),
        size: skillData.byteLength
      });
    }
    return new Response(null, { status: 404 });
  };
  const client = new GitHubBrokerClient(config, fetchImpl as typeof fetch, () => now);
  const repository = {
    id: "321",
    fullName: "owner/private-skills",
    name: "private-skills",
    isPrivate: true,
    defaultBranch: "main"
  };

  const skillPackage = await client.fetchCurrentSkillPackage(
    "456",
    repository,
    "skills/example"
  );
  assert.deepEqual(skillPackage.coordinates, { commitSha, treeSha: subtreeSha, skillMdSha });
  assert.equal(skillPackage.entries[0].data.toString(), "# Example\n");
  assert.ok(requests.includes(`/repos/owner/private-skills/git/trees/${subtreeSha}?recursive=1`));

  const pinned = await client.fetchPinnedSkillPackage(
    "456",
    repository,
    "skills/example",
    skillPackage.coordinates
  );
  assert.deepEqual(pinned, skillPackage);
  assert.equal(requests.filter((path) => path.includes("/git/ref/heads/")).length, 1);
});

test("pinned package mismatch and truncated trees fail before delivery", async () => {
  const commitSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  function clientForTree(tree: unknown) {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/access_tokens")) {
        return Response.json({
          token: secretToken,
          expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
          permissions: { contents: "read" },
          repositories: [{ id: 321 }]
        });
      }
      if (url.pathname.endsWith(`/git/commits/${commitSha}`)) {
        return Response.json({ sha: commitSha, tree: { sha: treeSha } });
      }
      if (url.pathname.endsWith(`/git/trees/${treeSha}`)) return Response.json(tree);
      return new Response(null, { status: 404 });
    };
    return new GitHubBrokerClient(config, fetchImpl as typeof fetch, () => now);
  }
  const repository = {
    id: "321",
    fullName: "owner/private-skills",
    name: "private-skills",
    isPrivate: true,
    defaultBranch: "main"
  };

  await assert.rejects(
    clientForTree({ sha: treeSha, truncated: true, tree: [] }).fetchPinnedSkillPackage(
      "456",
      repository,
      ".",
      { commitSha, treeSha, skillMdSha: "c".repeat(40) }
    ),
    (error: unknown) => error instanceof GitHubBrokerError && error.code === "package_invalid"
  );

  await assert.rejects(
    clientForTree({ sha: "d".repeat(40), truncated: false, tree: [] }).fetchPinnedSkillPackage(
      "456",
      repository,
      ".",
      { commitSha, treeSha, skillMdSha: "c".repeat(40) }
    ),
    (error: unknown) => error instanceof GitHubBrokerError && error.code === "package_invalid"
  );
});

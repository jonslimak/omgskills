import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  brokerConfigFromEnv,
  createAppJwt,
  verifyGithubBrokerApp
} from "./verify-github-broker-app.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" });
const now = Date.parse("2026-08-27T18:00:00Z");
const config = {
  appId: 123,
  installationId: 456,
  privateKey: privateKeyPem,
  allowedRepository: "owner/pilot-skills",
  deniedRepository: "owner/private-denied",
  testPath: "skills/example/SKILL.md"
};

function mockFetch({
  appPermissions = { contents: "read", metadata: "read" },
  repositorySelection = "selected",
  tokenPermissions = { contents: "read", metadata: "read" },
  deniedStatus = 404,
  tokenRepositories = [{ full_name: "owner/pilot-skills" }]
} = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    const authorization = options.headers.authorization;
    assert.match(authorization, /^Bearer /);
    assert.doesNotMatch(authorization, /private-denied/);

    if (path === "/app") return Response.json({ id: 123, permissions: appPermissions });
    if (path === "/app/installations/456") {
      return Response.json({ id: 456, repository_selection: repositorySelection });
    }
    if (path === "/app/installations/456/access_tokens") {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), {
        repositories: ["pilot-skills"],
        permissions: { contents: "read" }
      });
      return Response.json({
        token: "ghs_secret-token-value",
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
        permissions: tokenPermissions,
        repositories: tokenRepositories
      });
    }
    if (path === "/repos/owner/pilot-skills/contents/skills/example/SKILL.md") {
      return Response.json({ type: "file", sha: "abc123" });
    }
    if (path === "/repos/owner/private-denied") return new Response(null, { status: deniedStatus });
    return new Response(null, { status: 404 });
  };
}

test("creates a signed App JWT without embedding the private key", () => {
  const jwt = createAppJwt({ appId: 123, privateKey: privateKeyPem, now });
  assert.equal(jwt.split(".").length, 3);
  assert.doesNotMatch(jwt, /BEGIN RSA PRIVATE KEY/);
});

test("loads and validates broker verifier environment", () => {
  const loaded = brokerConfigFromEnv({
    OMGSKILLS_GITHUB_BROKER_APP_ID: "123",
    OMGSKILLS_GITHUB_BROKER_INSTALLATION_ID: "456",
    OMGSKILLS_GITHUB_BROKER_PRIVATE_KEY: privateKeyPem.replace(/\n/g, "\\n"),
    OMGSKILLS_GITHUB_BROKER_ALLOWED_REPOSITORY: "https://github.com/owner/pilot-skills.git",
    OMGSKILLS_GITHUB_BROKER_DENIED_REPOSITORY: "owner/private-denied",
    OMGSKILLS_GITHUB_BROKER_TEST_PATH: "/skills/example/SKILL.md"
  });
  assert.equal(loaded.allowedRepository, "owner/pilot-skills");
  assert.equal(loaded.testPath, "skills/example/SKILL.md");
  assert.match(loaded.privateKey, /BEGIN RSA PRIVATE KEY/);
});

test("verifies selected-repository read access and denied-repository isolation", async () => {
  const result = await verifyGithubBrokerApp({ config, fetchImpl: mockFetch(), now });
  assert.deepEqual(result, {
    appId: 123,
    installationId: 456,
    repository: "owner/pilot-skills",
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString()
  });
});

test("rejects write permission on the App", async () => {
  await assert.rejects(
    verifyGithubBrokerApp({
      config,
      fetchImpl: mockFetch({ appPermissions: { contents: "write", metadata: "read" } }),
      now
    }),
    /contents:read|contents:write/
  );
});

test("rejects all-repository installations", async () => {
  await assert.rejects(
    verifyGithubBrokerApp({ config, fetchImpl: mockFetch({ repositorySelection: "all" }), now }),
    /selected repositories/
  );
});

test("rejects tokens that include another repository", async () => {
  await assert.rejects(
    verifyGithubBrokerApp({
      config,
      fetchImpl: mockFetch({
        tokenRepositories: [
          { full_name: "owner/pilot-skills" },
          { full_name: "owner/private-denied" }
        ]
      }),
      now
    }),
    /not restricted/
  );
});

test("fails if an unapproved private repository becomes readable", async () => {
  await assert.rejects(
    verifyGithubBrokerApp({ config, fetchImpl: mockFetch({ deniedStatus: 200 }), now }),
    /expected 404/
  );
});

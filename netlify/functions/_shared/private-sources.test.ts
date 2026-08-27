import assert from "node:assert/strict";
import test from "node:test";
import {
  bindGithubBrokerInstallation,
  normalizePrivateSkillRoot,
  PrivateSourceError,
  registerOwnerPrivateSource,
  requireOwnerBrokerInstallation,
  upsertOwnerPrivateSource
} from "./private-sources.js";

test("normalizes valid roots and rejects traversal or ambiguous paths", () => {
  assert.equal(normalizePrivateSkillRoot(" . "), ".");
  assert.equal(normalizePrivateSkillRoot(" skills/Review "), "skills/Review");
  for (const value of ["", "/skills/a", "skills/a/", "skills//a", "skills\\a", "skills/../a", "skills/./a", "skills\u0000/a"]) {
    assert.throws(
      () => normalizePrivateSkillRoot(value),
      (error: unknown) => error instanceof PrivateSourceError && error.code === "invalid_root"
    );
  }
});

test("installation binding cannot silently move to another owner", async () => {
  const query = async (sql: string) => ({
    rows: sql.includes("RETURNING") ? [] : [],
    rowCount: 0,
    command: "INSERT",
    oid: 0,
    fields: []
  });
  await assert.rejects(
    bindGithubBrokerInstallation({ query } as any, {
      ownerUserId: "owner-b",
      installationId: "456",
      accountId: "789",
      accountLogin: "owner",
      accountType: "User"
    }),
    (error: unknown) => error instanceof PrivateSourceError && error.code === "installation_conflict"
  );
});

test("owner installation lookup is always scoped by owner and installation", async () => {
  let values: unknown[] | undefined;
  const query = async (_sql: string, input?: unknown[]) => {
    values = input;
    return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
  };
  await assert.rejects(
    requireOwnerBrokerInstallation({ query } as any, "owner-a", "456"),
    (error: unknown) => error instanceof PrivateSourceError && error.code === "installation_not_found"
  );
  assert.deepEqual(values, ["owner-a", "456"]);
});

test("private source upsert preserves immutable repository and root identity", async () => {
  let sql = "";
  let values: unknown[] | undefined;
  const query = async (text: string, input?: unknown[]) => {
    sql = text;
    values = input;
    return {
      rows: [{
        id: "source-id",
        installationId: "456",
        repositoryId: "321",
        repositorySlug: "renamed/private-skills",
        normalizedRoot: "skills/example",
        createdAt: "2026-08-27T00:00:00Z"
      }],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: []
    };
  };
  const source = await upsertOwnerPrivateSource({ query } as any, {
    ownerUserId: "owner-a",
    installationId: "456",
    repositoryId: "321",
    repositorySlug: "renamed/private-skills",
    normalizedRoot: "skills/example"
  });
  assert.equal(source.id, "source-id");
  assert.match(sql, /ON CONFLICT \(kind, repository_id, normalized_root\)/);
  assert.match(sql, /skill_sources\.owner_user_id = EXCLUDED\.owner_user_id/);
  assert.doesNotMatch(sql, /normalized_root = EXCLUDED|repository_id = EXCLUDED/);
  assert.deepEqual(values, ["skills/example", "321", "renamed/private-skills", "owner-a", "456"]);
});

test("registration rejects another owner's installation before calling GitHub", async () => {
  let brokerCalls = 0;
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; }
  };
  const broker = {
    async getInstallation() { brokerCalls += 1; },
    async listRepositories() { brokerCalls += 1; return []; },
    async verifySkillRoot() { brokerCalls += 1; }
  };
  await assert.rejects(
    registerOwnerPrivateSource(pool as any, broker as any, {
      ownerUserId: "owner-b",
      installationId: "456",
      repositoryId: "321",
      root: "skills/example"
    }),
    (error: unknown) => error instanceof PrivateSourceError
      && error.code === "installation_not_found"
  );
  assert.equal(brokerCalls, 0);
});

test("registration rejects repositories outside the live installation grant", async () => {
  const pool = {
    async query() {
      return {
        rows: [{
          installationId: "456",
          accountId: "789",
          accountLogin: "owner",
          accountType: "User"
        }],
        rowCount: 1
      };
    }
  };
  let verifiedRoot = false;
  const broker = {
    async getInstallation() {
      return {
        installationId: "456",
        accountId: "789",
        accountLogin: "owner",
        accountType: "User"
      };
    },
    async listRepositories() {
      return [{
        id: "999",
        fullName: "owner/other-private",
        name: "other-private",
        isPrivate: true,
        defaultBranch: "main"
      }];
    },
    async verifySkillRoot() { verifiedRoot = true; }
  };
  await assert.rejects(
    registerOwnerPrivateSource(pool as any, broker as any, {
      ownerUserId: "owner-a",
      installationId: "456",
      repositoryId: "321",
      root: "skills/example"
    }),
    (error: unknown) => error instanceof PrivateSourceError
      && error.code === "repository_not_found"
  );
  assert.equal(verifiedRoot, false);
});

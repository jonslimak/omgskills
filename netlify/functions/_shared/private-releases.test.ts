import assert from "node:assert/strict";
import test from "node:test";
import {
  loadOwnerPrivateReleasePackage,
  PrivateReleaseError,
  registerOwnerPrivateRelease
} from "./private-releases.js";
import type { SkillPackage } from "./skill-package.js";

const coordinates = {
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  skillMdSha: "c".repeat(40)
};
const skillPackage: SkillPackage = { coordinates, entries: [] };
const sourceRow = {
  sourceId: "11111111-1111-4111-8111-111111111111",
  installationId: "456",
  repositoryId: "321",
  repositorySlug: "owner/private-skills",
  normalizedRoot: "skills/example"
};
const releaseRow = {
  id: "22222222-2222-4222-8222-222222222222",
  releaseId: "22222222-2222-4222-8222-222222222222",
  ...sourceRow,
  ...coordinates,
  createdAt: "2026-08-27T20:00:00Z"
};

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

test("registers one validated release under the authenticated owner", async () => {
  const writes: Array<{ sql: string; values?: unknown[] }> = [];
  const query = async (sql: string, values?: unknown[]) => {
    writes.push({ sql, values });
    if (sql.includes("FROM skill_sources")) return result([sourceRow]);
    if (sql.includes("INSERT INTO skill_releases")) return result([{ id: releaseRow.id }]);
    if (sql.includes("FROM skill_releases")) return result([releaseRow]);
    return result([]);
  };
  const client = { query, release() {} };
  const pool = { query, async connect() { return client; } };
  let fetchedRoot = "";
  const broker = {
    async listRepositories() {
      return [{
        id: "321",
        fullName: "owner/private-skills",
        name: "private-skills",
        isPrivate: true,
        defaultBranch: "main"
      }];
    },
    async fetchCurrentSkillPackage(_installationId: string, _repository: unknown, root: string) {
      fetchedRoot = root;
      return skillPackage;
    },
    async fetchPinnedSkillPackage() { throw new Error("unused"); }
  };

  const release = await registerOwnerPrivateRelease(pool as any, broker, {
    ownerUserId: "owner-a",
    sourceId: sourceRow.sourceId
  });
  assert.equal(release.id, releaseRow.id);
  assert.equal(fetchedRoot, "skills/example");
  const insert = writes.find(({ sql }) => sql.includes("INSERT INTO skill_releases"));
  assert.deepEqual(insert?.values, [
    sourceRow.sourceId,
    coordinates.commitSha,
    coordinates.treeSha,
    coordinates.skillMdSha,
    "owner-a"
  ]);
});

test("registration rejects another owner's source before GitHub access", async () => {
  let brokerCalls = 0;
  const pool = {
    async query() { return result([]); },
    async connect() { throw new Error("must not connect"); }
  };
  const broker = {
    async listRepositories() { brokerCalls += 1; return []; },
    async fetchCurrentSkillPackage() { brokerCalls += 1; return skillPackage; },
    async fetchPinnedSkillPackage() { brokerCalls += 1; return skillPackage; }
  };
  await assert.rejects(
    registerOwnerPrivateRelease(pool as any, broker, {
      ownerUserId: "owner-b",
      sourceId: sourceRow.sourceId
    }),
    (error: unknown) => error instanceof PrivateReleaseError && error.code === "source_unavailable"
  );
  assert.equal(brokerCalls, 0);
});

test("package loading resolves all private coordinates from an opaque release ID", async () => {
  let queryValues: unknown[] | undefined;
  const pool = {
    async query(_sql: string, values?: unknown[]) {
      queryValues = values;
      return result([releaseRow]);
    }
  };
  let pinnedInput: unknown;
  const broker = {
    async listRepositories() {
      return [{
        id: "321",
        fullName: "renamed/private-skills",
        name: "private-skills",
        isPrivate: true,
        defaultBranch: "main"
      }];
    },
    async fetchCurrentSkillPackage() { throw new Error("unused"); },
    async fetchPinnedSkillPackage(...input: unknown[]) {
      pinnedInput = input;
      return skillPackage;
    }
  };
  const loaded = await loadOwnerPrivateReleasePackage(pool as any, broker, {
    ownerUserId: "owner-a",
    releaseId: releaseRow.id
  });
  assert.deepEqual(queryValues, [releaseRow.id, "owner-a"]);
  assert.deepEqual(pinnedInput, [
    "456",
    {
      id: "321",
      fullName: "renamed/private-skills",
      name: "private-skills",
      isPrivate: true,
      defaultBranch: "main"
    },
    "skills/example",
    coordinates
  ]);
  assert.equal(loaded.release.id, releaseRow.id);
});

test("revoked repository access fails before a pinned package fetch", async () => {
  const pool = { async query() { return result([releaseRow]); } };
  let fetched = false;
  const broker = {
    async listRepositories() { return []; },
    async fetchCurrentSkillPackage() { throw new Error("unused"); },
    async fetchPinnedSkillPackage() { fetched = true; return skillPackage; }
  };
  await assert.rejects(
    loadOwnerPrivateReleasePackage(pool as any, broker, {
      ownerUserId: "owner-a",
      releaseId: releaseRow.id
    }),
    (error: unknown) => error instanceof PrivateReleaseError
      && error.code === "repository_unavailable"
  );
  assert.equal(fetched, false);
});

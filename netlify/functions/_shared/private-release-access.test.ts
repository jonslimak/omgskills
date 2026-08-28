import assert from "node:assert/strict";
import test from "node:test";
import {
  decidePrivateReleaseAccess,
  PrivateReleaseAccessError,
  recordContentFetch,
  requirePrivateReleaseAccess,
  samePrivateRelease,
  type PrivateReleaseAccessRow,
  type PrivateReleaseActor
} from "./private-release-access.js";

const actor: PrivateReleaseActor = {
  userId: "recipient-id",
  email: "recipient@example.com"
};

function row(overrides: Partial<PrivateReleaseAccessRow> = {}): PrivateReleaseAccessRow {
  return {
    sourceId: "11111111-1111-4111-8111-111111111111",
    releaseId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "owner-id",
    installationId: "456",
    repositoryId: "321",
    repositorySlug: "owner/private-skills",
    normalizedRoot: "skills/example",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    skillMdSha: "c".repeat(40),
    createdAt: "2026-08-28T12:00:00Z",
    groupId: "33333333-3333-4333-8333-333333333333",
    groupOwnerUserId: "owner-id",
    groupName: "Private group",
    groupSlug: "private-group",
    groupVisibility: "restricted",
    groupIsFavorites: false,
    groupDisabledAt: null,
    invited: true,
    skillItemId: "44444444-4444-4444-8444-444444444444",
    ...overrides
  };
}

function result(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

test("source owner can read a release without a group membership", () => {
  const owner = { userId: "owner-id", email: "owner@example.com" };
  const resolved = decidePrivateReleaseAccess([
    row({ groupId: null, groupOwnerUserId: null, groupName: null, groupSlug: null,
      groupVisibility: null, groupIsFavorites: null, skillItemId: null, invited: false })
  ], owner);
  assert.equal(resolved?.accessRole, "owner");
  assert.equal(resolved?.groupId, null);
  assert.equal(resolved?.skillItemId, null);
});

test("verified allow-list membership grants only active restricted-group access", () => {
  assert.equal(decidePrivateReleaseAccess([row()], actor)?.accessRole, "invited");
  assert.equal(decidePrivateReleaseAccess([row({ invited: false })], actor), null);
  assert.equal(decidePrivateReleaseAccess([row({ groupVisibility: "public" })], actor), null);
  assert.equal(decidePrivateReleaseAccess([row({ groupVisibility: "private" })], actor), null);
  assert.equal(
    decidePrivateReleaseAccess([row({ groupDisabledAt: "2026-08-28T12:01:00Z" })], actor),
    null
  );
});

test("cross-owner group substitution never grants release access", () => {
  assert.equal(
    decidePrivateReleaseAccess([row({ groupOwnerUserId: "other-owner" })], actor),
    null
  );
});

test("release authorization uses only opaque release ID and verified email", async () => {
  let values: unknown[] | undefined;
  const client = {
    async query(_sql: string, received?: unknown[]) {
      values = received;
      return result([row()]);
    }
  };
  const resolved = await requirePrivateReleaseAccess(client as any, actor, row().releaseId);
  assert.equal(resolved.accessRole, "invited");
  assert.deepEqual(values, [row().releaseId, actor.email]);
});

test("missing and unauthorized releases share one generic failure", async () => {
  for (const rows of [[], [row({ invited: false })]]) {
    await assert.rejects(
      requirePrivateReleaseAccess({ async query() { return result(rows); } } as any, actor, row().releaseId),
      (error: unknown) => error instanceof PrivateReleaseAccessError
        && error.message === "Private release is unavailable"
    );
  }
});

test("content fetch audit writes structured metadata only", async () => {
  let sql = "";
  let values: unknown[] | undefined;
  const client = {
    async query(receivedSql: string, receivedValues?: unknown[]) {
      sql = receivedSql;
      values = receivedValues;
      return result([]);
    }
  };
  const grant = decidePrivateReleaseAccess([row()], actor);
  assert.ok(grant);
  await recordContentFetch(client as any, grant);
  assert.match(sql, /INSERT INTO analytics_events/);
  assert.match(sql, /content_fetch/);
  assert.deepEqual(values, [
    row().groupId,
    row().skillItemId,
    actor.userId,
    row().sourceId,
    row().releaseId,
    null
  ]);
  assert.equal(JSON.stringify(values).includes("private-skills"), false);
});

test("release identity comparison detects a changed immutable coordinate", () => {
  const first = decidePrivateReleaseAccess([row()], actor);
  const same = decidePrivateReleaseAccess([row()], actor);
  const changed = decidePrivateReleaseAccess([row({ treeSha: "d".repeat(40) })], actor);
  assert.ok(first && same && changed);
  assert.equal(samePrivateRelease(first, same), true);
  assert.equal(samePrivateRelease(first, changed), false);
});

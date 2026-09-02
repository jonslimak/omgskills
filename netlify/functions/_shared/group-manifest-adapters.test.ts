import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  buildDeviceGroupManifestByRoute,
  buildMemberGroupManifest,
  buildPublicGroupManifestByRoute,
  withGroupManifestSnapshot,
} from "./group-manifest-adapters.js";
import type { GroupAccessClient, GroupAccessFacts } from "./group-access.js";

function result(rows: any[]) {
  return { rows, rowCount: rows.length } as any;
}

function sequenceClient(rowsByQuery: any[][]): GroupAccessClient {
  let index = 0;
  return {
    async query() {
      const rows = rowsByQuery[index++];
      assert.notEqual(rows, undefined, `unexpected query ${index}`);
      return result(rows);
    },
  };
}

function accessFacts(overrides: Partial<GroupAccessFacts> = {}): GroupAccessFacts {
  return {
    id: "group-id",
    ownerUserId: "owner-id",
    name: "Team skills",
    slug: "team-skills",
    visibility: "restricted",
    isFavorites: false,
    disabledAt: null,
    invited: true,
    ...overrides,
  };
}

const sha = {
  commit: "1111111111111111111111111111111111111111",
  tree: "2222222222222222222222222222222222222222",
  skill: "3333333333333333333333333333333333333333",
};

function manifestRow(overrides: Record<string, unknown> = {}) {
  return {
    groupId: "group-id",
    groupName: "Team skills",
    groupDescription: "Reviewed skills",
    groupSlug: "team-skills",
    groupRevision: 9,
    itemId: "item-id",
    itemKind: "github",
    itemPosition: 0,
    itemName: "Private review",
    itemDescription: "Review privately.",
    itemNote: null,
    itemCatalogSkillId: null,
    itemGithubUrl: "https://github.com/secret/private-skills/tree/main/skills/review",
    metadataOnlyReason: null,
    sourceId: "source-id",
    sourceKind: "private_github",
    sourceNormalizedRoot: "skills/review",
    sourceCatalogSkillId: null,
    sourceRepositoryId: "987654321",
    sourceRepositorySlug: "secret/private-skills",
    sourceTombstonedAt: null,
    releaseId: "release-id",
    releaseSourceId: "source-id",
    releaseCommitSha: sha.commit,
    releaseTreeSha: sha.tree,
    releaseSkillMdSha: sha.skill,
    syncedName: null,
    syncedDescription: null,
    syncedGithubUrl: null,
    syncedIdentityStatus: null,
    syncedCatalogSkillId: null,
    syncedIsLocalOnly: false,
    syncedIsCurrent: null,
    ...overrides,
  };
}

test("member manifest allows owners and invited members through the shared read policy", async () => {
  for (const actor of [
    { id: "owner-id", email: "owner@example.com" },
    { id: "member-id", email: "member@example.com" },
  ]) {
    const view = await buildMemberGroupManifest(actor, "group-id", sequenceClient([
      [accessFacts({ invited: actor.id === "member-id" })],
      [manifestRow()],
    ]));
    assert.equal(view.manifest.group.revision, 9);
    assert.equal(view.manifest.items[0].installability.status, "installable");
  }
});

test("member manifest denies unrelated users with the generic not-found response", async () => {
  await assert.rejects(
    buildMemberGroupManifest(
      { id: "stranger-id", email: "stranger@example.com" },
      "group-id",
      sequenceClient([[accessFacts({ invited: false })]])
    ),
    (error) => error instanceof Response && error.status === 404
  );
});

test("device manifest resolves private routes without requiring a published profile", async () => {
  const view = await buildDeviceGroupManifestByRoute(
    { id: "member-id", email: "member@example.com" },
    "jon",
    "team-skills",
    sequenceClient([
      [{ id: "group-id" }],
      [accessFacts({ invited: true })],
      [manifestRow()],
    ])
  );
  assert.equal(view.manifest.items[0].installability.status, "installable");
});

test("device manifest gives public-role readers the public-safe view", async () => {
  const view = await buildDeviceGroupManifestByRoute(
    { id: "reader-id", email: "reader@example.com" },
    "jon",
    "team-skills",
    sequenceClient([
      [{ id: "group-id" }],
      [accessFacts({ visibility: "public", invited: false })],
      [manifestRow()],
    ])
  );
  assert.deepEqual(view.manifest.items[0].installability, {
    status: "metadata_only",
    reason: "source_unavailable",
  });
  const serialized = JSON.stringify(view.manifest);
  for (const secret of ["secret/private-skills", "skills/review", "987654321"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("device manifest keeps inaccessible and absent routes indistinguishable", async () => {
  const failures: Array<{ status: number; body: string }> = [];
  for (const rows of [
    [[{ id: "group-id" }], [accessFacts({ invited: false })]],
    [[]],
  ]) {
    try {
      await buildDeviceGroupManifestByRoute(
        { id: "stranger-id", email: "stranger@example.com" },
        "jon",
        "team-skills",
        sequenceClient(rows as any)
      );
      assert.fail("expected route denial");
    } catch (error) {
      assert.ok(error instanceof Response);
      failures.push({ status: error.status, body: await error.text() });
    }
  }
  assert.deepEqual(failures, [
    { status: 404, body: "Group not found" },
    { status: 404, body: "Group not found" },
  ]);
});

test("public manifest requires a published public group and hides private source coordinates", async () => {
  const view = await buildPublicGroupManifestByRoute(
    "jon",
    "team-skills",
    sequenceClient([
      [{ id: "group-id" }],
      [accessFacts({ visibility: "public", invited: false })],
      [manifestRow()],
    ])
  );
  assert.deepEqual(view.manifest.items[0].installability, {
    status: "metadata_only",
    reason: "source_unavailable",
  });
  assert.deepEqual(view.linkHints.get("item-id"), {
    catalogSkillId: null,
    githubUrl: null,
    isLocalOnly: true,
  });
  const serialized = JSON.stringify(view.manifest);
  for (const secret of ["secret/private-skills", "skills/review", "987654321"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("public manifest rejects private, disabled, missing, and unpublished-profile routes", async (t) => {
  for (const [label, rows] of [
    ["private", [[{ id: "group-id" }], [accessFacts({ visibility: "private", invited: false })]]],
    ["disabled", [[{ id: "group-id" }], [accessFacts({ visibility: "public", disabledAt: "2026-08-27" })]]],
    ["missing or unpublished", [[]]],
  ] as const) {
    await t.test(label, async () => {
      await assert.rejects(
        buildPublicGroupManifestByRoute("jon", "team-skills", sequenceClient(rows as any)),
        (error) => error instanceof Response && error.status === 404
      );
    });
  }
});

test("manifest preserves revision and stable item ordering while stale sources stay metadata-only", async () => {
  const view = await buildMemberGroupManifest(
    { id: "owner-id", email: "owner@example.com" },
    "group-id",
    sequenceClient([
      [accessFacts()],
      [
        manifestRow({
          itemId: "first",
          itemPosition: 0,
          itemName: "First",
          sourceTombstonedAt: "2026-08-27T00:00:00.000Z",
        }),
        manifestRow({
          itemId: "second",
          itemPosition: 1,
          itemName: "Second",
          sourceKind: "public_github",
          sourceRepositorySlug: "owner/public",
          sourceRepositoryId: "123",
          itemGithubUrl: null,
        }),
      ],
    ])
  );
  assert.equal(view.manifest.group.revision, 9);
  assert.deepEqual(view.manifest.items.map((item) => item.id), ["first", "second"]);
  assert.deepEqual(view.manifest.items[0].installability, {
    status: "metadata_only",
    reason: "source_unavailable",
  });
});

test("read-only manifest snapshot commits successes and rolls back failures", async (t) => {
  await t.test("commit", async () => {
    const calls: string[] = [];
    const client = {
      async query(text: string) { calls.push(text); return result([]); },
      release() { calls.push("release"); },
    } as unknown as PoolClient;
    const value = await withGroupManifestSnapshot(
      { async connect() { return client; } } as any,
      async () => "ok"
    );
    assert.equal(value, "ok");
    assert.deepEqual(calls, [
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "COMMIT",
      "release",
    ]);
  });

  await t.test("rollback", async () => {
    const calls: string[] = [];
    const client = {
      async query(text: string) { calls.push(text); return result([]); },
      release() { calls.push("release"); },
    } as unknown as PoolClient;
    await assert.rejects(
      withGroupManifestSnapshot(
        { async connect() { return client; } } as any,
        async () => { throw new Error("failed"); }
      ),
      /failed/
    );
    assert.deepEqual(calls, [
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "ROLLBACK",
      "release",
    ]);
  });
});

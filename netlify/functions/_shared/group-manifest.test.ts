import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupManifest,
  type GroupManifestInput,
  serializeGroupManifest
} from "./group-manifest.js";

const ids = {
  group: "10000000-0000-4000-8000-000000000001",
  catalogItem: "10000000-0000-4000-8000-000000000002",
  publicItem: "10000000-0000-4000-8000-000000000003",
  privateItem: "10000000-0000-4000-8000-000000000004",
  catalogSource: "20000000-0000-4000-8000-000000000001",
  publicSource: "20000000-0000-4000-8000-000000000002",
  privateSource: "20000000-0000-4000-8000-000000000003",
  catalogRelease: "30000000-0000-4000-8000-000000000001",
  publicRelease: "30000000-0000-4000-8000-000000000002",
  privateRelease: "30000000-0000-4000-8000-000000000003"
};

const sha = {
  commit: "1111111111111111111111111111111111111111",
  tree: "2222222222222222222222222222222222222222",
  skill: "3333333333333333333333333333333333333333"
};

function baseInput(items: GroupManifestInput["items"]): GroupManifestInput {
  return {
    group: {
      id: ids.group,
      name: "Team skills",
      description: "Reviewed skills",
      slug: "team-skills",
      revision: 7
    },
    items
  };
}

function release(id: string, sourceId: string) {
  return {
    id,
    sourceId,
    commitSha: sha.commit,
    treeSha: sha.tree,
    skillMdSha: sha.skill
  };
}

function manifestRelease(id: string) {
  return {
    id,
    commitSha: sha.commit,
    treeSha: sha.tree,
    skillMdSha: sha.skill
  };
}

test("normalizes complete catalog and public GitHub releases deterministically", () => {
  const catalogItem: GroupManifestInput["items"][number] = {
    id: ids.catalogItem,
    kind: "catalog",
    position: 0,
    name: "Code review",
    catalogSkillId: "openai/codex:code-review",
    source: {
      id: ids.catalogSource,
      kind: "catalog",
      normalizedRoot: "skills/code-review",
      catalogSkillId: "openai/codex:code-review"
    },
    release: release(ids.catalogRelease, ids.catalogSource)
  };
  const publicItem: GroupManifestInput["items"][number] = {
    id: ids.publicItem,
    kind: "github",
    position: 1,
    name: "Public skill",
    description: "A complete public package",
    source: {
      id: ids.publicSource,
      kind: "public_github",
      normalizedRoot: "skills/public-skill",
      repositoryId: "900719925474099312345",
      repositorySlug: "owner/public-skills"
    },
    release: release(ids.publicRelease, ids.publicSource)
  };

  const first = buildGroupManifest(baseInput([publicItem, catalogItem]));
  const second = serializeGroupManifest(baseInput([catalogItem, publicItem]));
  assert.equal(first.type, "omgskills.skill_group");
  assert.equal(first.version, 2);
  assert.equal(first.group.revision, 7);
  assert.deepEqual(first.items.map((item) => item.id), [ids.catalogItem, ids.publicItem]);
  assert.deepEqual(first.items.map((item) => item.position), [0, 1]);
  assert.deepEqual(first.items[0].installability, {
    status: "installable",
    source: {
      id: ids.catalogSource,
      kind: "catalog",
      catalogSkillId: "openai/codex:code-review",
      normalizedRoot: "skills/code-review"
    },
    release: manifestRelease(ids.catalogRelease)
  });
  assert.deepEqual(first.items[1].installability, {
    status: "installable",
    source: {
      id: ids.publicSource,
      kind: "public_github",
      repositoryId: "900719925474099312345",
      repositorySlug: "owner/public-skills",
      normalizedRoot: "skills/public-skill"
    },
    release: manifestRelease(ids.publicRelease)
  });
  assert.equal(second, `${JSON.stringify(first, null, 2)}\n`);
});

test("private releases expose only opaque source and release integrity fields", () => {
  const input = baseInput([{
    id: ids.privateItem,
    kind: "github",
    position: 0,
    name: "Private review",
    source: {
      id: ids.privateSource,
      kind: "private_github",
      normalizedRoot: "skills/private-review",
      repositoryId: "987654321",
      repositorySlug: "secret/private-skills",
      ownerUserId: "secret-owner-id",
      brokerInstallationId: "secret-installation-id"
    } as GroupManifestInput["items"][number]["source"] & Record<string, string>,
    release: release(ids.privateRelease, ids.privateSource),
    ownerEmail: "owner@example.com",
    syncedSkillId: "raw-inventory-id"
  } as GroupManifestInput["items"][number] & Record<string, unknown>]);

  const manifest = buildGroupManifest(input);
  assert.deepEqual(manifest.items[0].installability, {
    status: "installable",
    source: { id: ids.privateSource, kind: "private_github" },
    release: manifestRelease(ids.privateRelease)
  });
  const serialized = JSON.stringify(manifest);
  for (const secret of [
    "secret/private-skills",
    "skills/private-review",
    "secret-owner-id",
    "secret-installation-id",
    "owner@example.com",
    "raw-inventory-id"
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("private releases require complete source coordinates without exposing them", () => {
  const manifest = buildGroupManifest(baseInput([{
    id: ids.privateItem,
    kind: "github",
    position: 0,
    name: "Incomplete private review",
    source: {
      id: ids.privateSource,
      kind: "private_github",
      normalizedRoot: "skills/private-review"
    },
    release: release(ids.privateRelease, ids.privateSource)
  }]));

  assert.deepEqual(manifest.items[0].installability, {
    status: "metadata_only",
    reason: "source_mismatch"
  });
});

test("normalizes unresolved legacy and synced items to stable metadata-only reasons", () => {
  const cases: Array<{
    name: string;
    item: GroupManifestInput["items"][number];
    reason: string;
  }> = [
    {
      name: "catalog",
      item: {
        id: "legacy-catalog",
        kind: "catalog",
        position: 0,
        name: "Legacy catalog",
        catalogSkillId: "owner/repo:skill"
      },
      reason: "release_unavailable"
    },
    {
      name: "public GitHub",
      item: {
        id: "legacy-github",
        kind: "github",
        position: 0,
        name: "Legacy GitHub"
      },
      reason: "release_unavailable"
    },
    {
      name: "missing synced row",
      item: {
        id: "synced-missing",
        kind: "synced",
        position: 0,
        name: "Missing synced"
      },
      reason: "synced_missing"
    },
    {
      name: "local-only synced row",
      item: {
        id: "synced-local",
        kind: "synced",
        position: 0,
        name: "Local synced",
        syncedIdentity: { identityStatus: "localOnly", isCurrent: true }
      },
      reason: "synced_local_only"
    },
    {
      name: "ambiguous synced row",
      item: {
        id: "synced-ambiguous",
        kind: "synced",
        position: 0,
        name: "Ambiguous synced",
        syncedIdentity: { identityStatus: "ambiguous", isCurrent: true }
      },
      reason: "synced_ambiguous"
    },
    {
      name: "resolved synced row without release",
      item: {
        id: "synced-resolved",
        kind: "synced",
        position: 0,
        name: "Resolved synced",
        syncedIdentity: {
          identityStatus: "resolved",
          catalogSkillId: "owner/repo:skill",
          isCurrent: true
        }
      },
      reason: "release_unavailable"
    }
  ];

  for (const fixture of cases) {
    const item = buildGroupManifest(baseInput([fixture.item])).items[0];
    assert.deepEqual(
      item.installability,
      { status: "metadata_only", reason: fixture.reason },
      fixture.name
    );
  }
});

test("never promotes blob-only, malformed, stale, or mismatched coordinates", () => {
  const source = {
    id: ids.catalogSource,
    kind: "catalog" as const,
    normalizedRoot: "skills/code-review",
    catalogSkillId: "openai/codex:code-review"
  };
  const item = (overrides: Partial<GroupManifestInput["items"][number]>) => ({
    id: ids.catalogItem,
    kind: "catalog" as const,
    position: 0,
    name: "Code review",
    catalogSkillId: "openai/codex:code-review",
    source,
    ...overrides
  });
  const fixtures: Array<[GroupManifestInput["items"][number], string]> = [
    [item({ release: { id: ids.catalogRelease, sourceId: ids.catalogSource, skillMdSha: sha.skill } }), "incomplete_release"],
    [item({ release: { ...release(ids.catalogRelease, ids.catalogSource), treeSha: "not-a-sha" } }), "invalid_release"],
    [item({ source: { ...source, tombstonedAt: "2026-08-27T00:00:00Z" }, release: release(ids.catalogRelease, ids.catalogSource) }), "source_unavailable"],
    [item({ release: release(ids.catalogRelease, ids.publicSource) }), "release_source_mismatch"],
    [item({ catalogSkillId: "other/repo:skill", release: release(ids.catalogRelease, ids.catalogSource) }), "source_mismatch"]
  ];

  for (const [fixture, reason] of fixtures) {
    assert.deepEqual(
      buildGroupManifest(baseInput([fixture])).items[0].installability,
      { status: "metadata_only", reason }
    );
  }
});

test("rejects invalid group revisions and item positions", () => {
  assert.throws(
    () => buildGroupManifest({ ...baseInput([]), group: { ...baseInput([]).group, revision: 0 } }),
    /positive integer/
  );
  assert.throws(
    () => buildGroupManifest(baseInput([{
      id: "bad-position",
      kind: "catalog",
      position: -1,
      name: "Bad position"
    }])),
    /non-negative integer/
  );
  assert.throws(
    () => buildGroupManifest(baseInput([{
      id: "bad-kind",
      kind: "unknown",
      position: 0,
      name: "Bad kind"
    } as unknown as GroupManifestInput["items"][number]])),
    /item kind/
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareSyncedGroupPublication,
  sameSyncedGroupPublicationIdentity,
} from "./synced-group-publication.js";

const base = {
  id: "skill-id",
  catalogSkillId: null,
  skillMdSha: "a".repeat(40),
};

test("keeps unresolved synced identities explicitly metadata-only", async () => {
  assert.deepEqual(
    await prepareSyncedGroupPublication({ ...base, identityStatus: "localOnly" }),
    { kind: "metadata_only", reason: "synced_local_only" },
  );
  assert.deepEqual(
    await prepareSyncedGroupPublication({ ...base, identityStatus: "ambiguous" }),
    { kind: "metadata_only", reason: "synced_ambiguous" },
  );
});

test("resolved synced identity materializes through the catalog without exposing local identity", async () => {
  const publication = await prepareSyncedGroupPublication({
    ...base,
    identityStatus: "resolved",
    catalogSkillId: "owner/repo",
  }, {
    loadSkills: async () => [{
      id: "owner/repo",
      github_url: "https://github.com/owner/repo",
      skill_md_sha: "d".repeat(40),
    }],
    fetcher: (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/owner/repo") {
        return Response.json({ id: 123, full_name: "owner/repo", default_branch: "main" });
      }
      if (path === "/repos/owner/repo/commits/main") {
        return Response.json({
          sha: "b".repeat(40),
          commit: { tree: { sha: "c".repeat(40) } },
        });
      }
      return Response.json({
        sha: "c".repeat(40),
        tree: [{ path: "SKILL.md", mode: "100644", type: "blob", sha: "d".repeat(40) }],
      });
    }) as typeof fetch,
  });

  assert.equal(publication.kind, "release");
  if (publication.kind === "release") {
    assert.deepEqual(publication.source, {
      kind: "catalog",
      normalizedRoot: ".",
      catalogSkillId: "owner/repo",
    });
  }
});

test("detects a synced identity change before publication", () => {
  const first = { ...base, identityStatus: "resolved", catalogSkillId: "owner/repo" };
  assert.equal(sameSyncedGroupPublicationIdentity(first, first), true);
  assert.equal(sameSyncedGroupPublicationIdentity(first, {
    ...first,
    skillMdSha: "f".repeat(40),
  }), false);
});

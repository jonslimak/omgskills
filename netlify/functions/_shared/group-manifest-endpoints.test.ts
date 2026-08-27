import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Context } from "@netlify/functions";
import { portalGroupManifest } from "../portal-group-manifest.mjs";
import { publicGroupManifest } from "../public-group-manifest.mjs";
import type { GroupManifestView } from "./group-manifest-adapters.js";

const context = { deploy: { context: "production" }, params: {} } as Context;

function view(): GroupManifestView {
  return {
    manifest: {
      type: "omgskills.skill_group",
      version: 2,
      group: {
        id: "group-id",
        name: "Team skills",
        description: null,
        slug: "team-skills",
        revision: 3,
      },
      items: [],
    },
    linkHints: new Map(),
  };
}

test("manifest endpoints delegate authorization and shaping to the shared adapters", async () => {
  for (const [file, expectedAdapter] of [
    ["portal-group-manifest.mts", "readMemberGroupManifest"],
    ["public-group-manifest.mts", "readPublicGroupManifestByRoute"],
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /group-manifest-adapters\.js/);
    assert.match(source, new RegExp(expectedAdapter));
    assert.equal(source.includes("FROM skill_groups"), false);
  }
});

test("member endpoint returns only the private no-store v2 manifest", async () => {
  const actor = { id: "owner-id", clerkUserId: "clerk-id", email: "owner@example.com", displayName: "Owner" };
  let receivedGroupId = "";
  const response = await portalGroupManifest(
    new Request("https://omgskills.com/api/portal/groups/group-id/manifest"),
    context,
    {
      async requirePortalUser() { return actor; },
      async readManifest(receivedActor, groupId) {
        assert.equal(receivedActor, actor);
        receivedGroupId = groupId;
        return view();
      },
    }
  );
  assert.equal(response.status, 200);
  assert.equal(receivedGroupId, "group-id");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), view().manifest);
});

test("public endpoint validates its route and publicly caches only the manifest", async () => {
  const response = await publicGroupManifest(
    new Request("https://omgskills.com/api/public/groups/Jon/Team-Skills/manifest"),
    context,
    {
      async readManifest(handle, groupSlug) {
        assert.equal(handle, "jon");
        assert.equal(groupSlug, "team-skills");
        return view();
      },
    }
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /^public/);
  assert.deepEqual(await response.json(), view().manifest);
});

test("manifest endpoints preserve generic not-found errors", async () => {
  const failure = async () => { throw new Response("Group not found", { status: 404 }); };
  const member = await portalGroupManifest(
    new Request("https://omgskills.com/api/portal/groups/group-id/manifest"),
    context,
    {
      async requirePortalUser() {
        return { id: "user", clerkUserId: "clerk", email: "user@example.com", displayName: null };
      },
      readManifest: failure,
    }
  );
  const publicResponse = await publicGroupManifest(
    new Request("https://omgskills.com/api/public/groups/jon/team-skills/manifest"),
    context,
    { readManifest: failure }
  );
  for (const response of [member, publicResponse]) {
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Group not found" });
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Context } from "@netlify/functions";
import { deviceGroupManifest } from "../device-group-manifest.mjs";
import { portalGroupManifest } from "../portal-group-manifest.mjs";
import { publicGroupManifest } from "../public-group-manifest.mjs";
import { DeviceAuthError } from "./device-auth.js";
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
    ["device-group-manifest.mts", "readDeviceGroupManifestByRoute"],
    ["portal-group-manifest.mts", "readMemberGroupManifest"],
    ["public-group-manifest.mts", "readPublicGroupManifestByRoute"],
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /group-manifest-adapters\.js/);
    assert.match(source, new RegExp(expectedAdapter));
    assert.equal(source.includes("FROM skill_groups"), false);
  }
});

test("device manifest transport requires the feature gate and content-read scope", async () => {
  const source = await readFile(new URL("../device-group-manifest.mts", import.meta.url), "utf8");
  assert.match(source, /requireSkillGroupsFeature/);
  assert.match(source, /authenticateDevice\(pool, req, "content:read"\)/);
});

test("device endpoint authenticates with the scoped actor and returns a private manifest", async () => {
  let featureChecked = false;
  const response = await deviceGroupManifest(
    new Request("https://omgskills.com/api/device/groups/Jon/Team-Skills/manifest"),
    context,
    {
      requireFeature() { featureChecked = true; },
      async requireDeviceActor() {
        assert.equal(featureChecked, true);
        return {
          userId: "member-id",
          email: "member@example.com",
          deviceId: "device-id",
        };
      },
      async readManifest(actor, handle, groupSlug) {
        assert.deepEqual(actor, { id: "member-id", email: "member@example.com" });
        assert.equal(handle, "jon");
        assert.equal(groupSlug, "team-skills");
        return view();
      },
    }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(await response.json(), view().manifest);
});

test("device endpoint feature gate fails before authentication", async () => {
  let authCalls = 0;
  const response = await deviceGroupManifest(
    new Request("https://omgskills.com/api/device/groups/jon/team-skills/manifest"),
    context,
    {
      requireFeature() {
        throw new Response("Skill Groups are temporarily unavailable", {
          status: 503,
          headers: { "Retry-After": "300" },
        });
      },
      async requireDeviceActor() {
        authCalls += 1;
        throw new Error("must not authenticate");
      },
      async readManifest() { throw new Error("must not read"); },
    }
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "300");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(authCalls, 0);
});

test("device endpoint returns the generic device-auth failure", async () => {
  const response = await deviceGroupManifest(
    new Request("https://omgskills.com/api/device/groups/jon/team-skills/manifest"),
    context,
    {
      requireFeature() {},
      async requireDeviceActor() { throw new DeviceAuthError(); },
      async readManifest() { throw new Error("must not read"); },
    }
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Device credential is invalid or expired",
  });
});

test("device endpoint rejects malformed routes and unsupported methods", async () => {
  const dependencies = {
    requireFeature() { throw new Error("must not check feature"); },
    async requireDeviceActor() { throw new Error("must not authenticate"); },
    async readManifest() { throw new Error("must not read"); },
  };
  const malformed = await deviceGroupManifest(
    new Request("https://omgskills.com/api/device/groups/jon/not_ok/manifest"),
    context,
    dependencies
  );
  const unsupported = await deviceGroupManifest(
    new Request("https://omgskills.com/api/device/groups/jon/team-skills/manifest", {
      method: "POST",
    }),
    context,
    dependencies
  );
  assert.equal(malformed.status, 404);
  assert.equal(unsupported.status, 405);
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
  const deviceResponse = await deviceGroupManifest(
    new Request("https://omgskills.com/api/device/groups/jon/team-skills/manifest"),
    context,
    {
      requireFeature() {},
      async requireDeviceActor() {
        return { userId: "user", email: "user@example.com", deviceId: "device" };
      },
      readManifest: failure,
    }
  );
  for (const response of [member, publicResponse, deviceResponse]) {
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Group not found" });
  }
});

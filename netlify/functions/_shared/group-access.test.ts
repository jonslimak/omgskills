import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decideGroupAccess,
  findIndexablePublicGroups,
  requireGroupAccess,
  type GroupAccessClient,
  type GroupAccessFacts,
} from "./group-access.js";

const owner = { id: "owner-id", email: "owner@example.com" };
const invited = { id: "invited-id", email: "invited@example.com" };
const outsider = { id: "outsider-id", email: "outsider@example.com" };

function group(overrides: Partial<GroupAccessFacts> = {}): GroupAccessFacts {
  return {
    id: "group-id",
    ownerUserId: owner.id,
    name: "Team skills",
    slug: "team-skills",
    visibility: "private",
    isFavorites: false,
    disabledAt: null,
    invited: false,
    ...overrides,
  };
}

test("grants owners read and management access, including disabled groups", () => {
  assert.equal(decideGroupAccess(group(), owner, "read"), "owner");
  assert.equal(decideGroupAccess(group(), owner, "manage"), "owner");
  assert.equal(decideGroupAccess(group({ disabledAt: "2026-08-26" }), owner, "read"), "owner");
});

test("grants active restricted groups only to invited members", () => {
  assert.equal(
    decideGroupAccess(group({ visibility: "restricted", invited: true }), invited, "read"),
    "invited"
  );
  assert.equal(decideGroupAccess(group({ visibility: "restricted" }), outsider, "read"), null);
  assert.equal(
    decideGroupAccess(
      group({ visibility: "restricted", invited: true, disabledAt: "2026-08-26" }),
      invited,
      "read"
    ),
    null
  );
});

test("grants active public groups to signed-in and anonymous readers", () => {
  const publicGroup = group({ visibility: "public" });
  assert.equal(decideGroupAccess(publicGroup, outsider, "read"), "public");
  assert.equal(decideGroupAccess(publicGroup, null, "read"), "public");
  assert.equal(decideGroupAccess(publicGroup, outsider, "public"), "public");
  assert.equal(decideGroupAccess(group(), owner, "public"), null);
});

test("rejects absent groups and non-owner management", () => {
  assert.equal(decideGroupAccess(null, owner, "read"), null);
  assert.equal(decideGroupAccess(group({ visibility: "public" }), outsider, "manage"), null);
  assert.equal(decideGroupAccess(group(), outsider, "read"), null);
});

test("uses the same generic response for absent and unauthorized groups", async () => {
  function clientFor(rows: GroupAccessFacts[]): GroupAccessClient {
    return {
      async query() {
        return { rows } as any;
      },
    };
  }

  for (const client of [clientFor([]), clientFor([group()])]) {
    const error = await requireGroupAccess(outsider, "group-id", "read", client).catch(
      (caught) => caught
    );
    assert.equal(error instanceof Response, true);
    assert.equal(error.status, 404);
    assert.equal(await error.text(), "Group not found");
  }
});

test("protected group endpoints delegate authorization to the shared policy", async () => {
  const endpointFiles = [
    "portal-group-allowed-emails.mts",
    "portal-group-detail.mts",
    "portal-group-duplicate.mts",
    "portal-group-export.mts",
    "portal-group-items.mts",
    "portal-group-moderation.mts",
    "portal-groups.mts",
    "portal-shared.mts",
    "public-skillgroup-page.mts",
  ];
  const forbiddenPolicyFragments = [
    "g.visibility = 'public'",
    "g.visibility = 'restricted'",
    "g.owner_user_id =",
    "g.disabled_at IS NULL",
    "a.email =",
  ];

  for (const file of endpointFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /group-access\.js/);
    assert.match(source, /requireGroupAccess/);
    for (const fragment of forbiddenPolicyFragments) {
      assert.equal(source.includes(fragment), false, `${file} owns access policy: ${fragment}`);
    }
  }
});

test("public discovery selects only published, active public groups", async () => {
  const client: GroupAccessClient = {
    async query(text) {
      assert.match(text, /u\.profile_published = true/);
      assert.match(text, /g\.visibility = 'public'/);
      assert.match(text, /g\.disabled_at IS NULL/);
      return {
        rows: [{ handle: "jon", groupSlug: "design" }],
        rowCount: 1,
      } as any;
    },
  };
  assert.deepEqual(await findIndexablePublicGroups(client), [
    { handle: "jon", groupSlug: "design" },
  ]);
});

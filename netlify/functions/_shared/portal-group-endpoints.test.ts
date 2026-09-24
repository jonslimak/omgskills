import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import type { Pool } from "pg";
import { portalGroupDetail } from "../portal-group-detail.mjs";
import { listGroupItems } from "../portal-group-items.mjs";
import { portalGroupAllowedEmails } from "../portal-group-allowed-emails.mjs";
import type { GroupAccess, GroupAccessActor, GroupAccessRole } from "./group-access.js";
import type { PortalGroupItemRow } from "./portal-group-item.js";

const context = {} as Context;
const user = { id: "owner", clerkUserId: "clerk", email: "owner@example.test", displayName: "Owner" };
const groupId = "00000000-0000-4000-8000-000000000001";
const emailId = "00000000-0000-4000-8000-000000000002";
const physicalId = "00000000-0000-4000-8000-000000000003";
const url = `https://omgskills.com/api/portal/groups/${groupId}`;
const row: PortalGroupItemRow = {
  id: "item", kind: "synced", syncedSkillId: physicalId,
  catalogSkillId: null, itemGithubUrl: null, snapshotName: "Snapshot",
  snapshotDescription: "Snapshot description", note: null, position: 0,
  skillName: "Live name", skillDescription: "Live description", githubUrl: null, source: "Claude",
};

function dependencies(role: GroupAccessRole, deny = false) {
  const queries: { sql: string; values: unknown[] }[] = [];
  let authorized = false;
  const pool = {
    async query(sql: string, values: unknown[]) {
      assert.equal(authorized, true, "authorize before reading or writing data");
      queries.push({ sql, values });
      if (sql.includes("FROM skill_groups g")) return { rows: [{
        id: groupId, name: "Set", slug: "set", ownerHandle: "owner",
        allowedEmails: [{ id: emailId, email: "member@example.test" }],
      }] };
      if (sql.includes("FROM skill_group_items i")) {
        assert.deepEqual(values, [groupId, role]);
        assert.match(sql, /CASE WHEN \$2 = 'owner' THEN i\.synced_skill_id ELSE NULL END/);
        // Deliberately return private values even for non-owners to test response redaction too.
        return { rows: [row, { ...row, id: "orphan", syncedSkillId: null, skillName: null, skillDescription: null },
          { ...row, id: "catalog", kind: "catalog", skillName: null },
          { ...row, id: "github", kind: "github", skillName: null }] };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Pool;
  return {
    queries,
    getPgPool: () => pool,
    requirePortalUser: async () => user,
    requireGroupAccess: async (actor: GroupAccessActor, id: string, capability: string) => {
      assert.equal(actor, user);
      assert.equal(id, groupId);
      if (deny || (capability === "manage" && role !== "owner")) throw new Response("Group not found", { status: 404 });
      authorized = true;
      return { id, accessRole: role } as GroupAccess;
    },
  };
}

for (const role of ["owner", "invited", "public"] as const) {
  test(`both item read responses protect physical IDs for ${role}`, async () => {
    const detail = await portalGroupDetail(new Request(url), context, dependencies(role));
    const items = await listGroupItems(new Request(`${url}/items`), groupId, dependencies(role));
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get("cache-control"), "no-store");
    assert.equal(items.headers.get("cache-control"), "no-store");
    const detailBody = await detail.json();
    const itemBody = await items.json();
    assert.deepEqual(detailBody.items, itemBody.items);
    assert.equal(detailBody.accessRole, role);
    assert.equal(detailBody.items[0].name, "Live name");
    assert.equal(detailBody.items[1].name, "Snapshot");
    assert.equal(detailBody.items[1].description, "Snapshot description");
    assert.deepEqual(detailBody.items.map((item: { id: string }) => item.id), ["item", "orphan", "catalog", "github"]);
    if (role === "owner") {
      assert.deepEqual(detailBody.items.map((item: { syncedSkillId: string | null }) => item.syncedSkillId), [physicalId, null, null, null]);
      assert.deepEqual(detailBody.group.allowedEmails, [{ id: emailId, email: "member@example.test" }]);
    } else {
      assert.ok(detailBody.items.every((item: object) => !Object.hasOwn(item, "syncedSkillId")));
      assert.deepEqual(detailBody.group.allowedEmails, []);
      assert.equal(JSON.stringify(detailBody).includes(physicalId), false);
      assert.equal(JSON.stringify(detailBody).includes(emailId), false);
    }
  });
}

test("inaccessible item reads do not query group contents", async () => {
  const deps = dependencies("invited", true);
  const detail = await portalGroupDetail(new Request(url), context, deps);
  assert.equal(detail.status, 404);
  await assert.rejects(listGroupItems(new Request(`${url}/items`), groupId, deps), (error: unknown) => error instanceof Response && error.status === 404);
  assert.equal(deps.queries.length, 0);
});

function emailRequest(method: string, body: unknown) {
  return new Request(`${url}/allowed-emails`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("owner can remove allowed email by record ID without an email address", async () => {
  const deps = dependencies("owner");
  const result = await portalGroupAllowedEmails(emailRequest("DELETE", { emailId }), context, deps);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { emailId });
  assert.equal(deps.queries.length, 1);
  assert.match(deps.queries[0].sql, /WHERE id = \$1 AND group_id = \$2/);
  assert.deepEqual(deps.queries[0].values, [emailId, groupId]);
});

test("email addition still normalizes and validates; deletion still requires its ID", async () => {
  const deps = dependencies("owner");
  const result = await portalGroupAllowedEmails(emailRequest("POST", { email: " Member@Example.Test " }), context, deps);
  assert.equal(result.status, 201);
  assert.deepEqual(deps.queries[0].values, [groupId, "member@example.test"]);
  for (const [method, body] of [["POST", {}], ["POST", { email: "invalid" }], ["DELETE", { email: "member@example.test" }], ["DELETE", null]] as const) {
    const invalid = dependencies("owner");
    assert.equal((await portalGroupAllowedEmails(emailRequest(method, body), context, invalid)).status, 400);
    assert.equal(invalid.queries.length, 0);
  }
});

test("shared viewers cannot add or remove allowed emails", async () => {
  for (const role of ["invited", "public"] as const) {
    for (const method of ["POST", "DELETE"]) {
      const deps = dependencies(role);
      const result = await portalGroupAllowedEmails(emailRequest(method, { emailId, email: "member@example.test" }), context, deps);
      assert.equal(result.status, 404);
      assert.equal(deps.queries.length, 0);
    }
  }
});

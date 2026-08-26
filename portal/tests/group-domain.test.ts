import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addGroupAllowedEmail,
  addSyncedSkillToGroup,
  createGroup,
  listOwnedGroups,
  listSharedGroups,
  loadGroupDetail,
  removeGroupAllowedEmail,
  updateGroupModeration,
  updateGroupVisibility,
} from "../src/groups/api.js";
import { groupVisibilityLabel } from "../src/groups/model.js";
import type { PortalApi } from "../src/portal-api.js";

type Call = { path: string; init: RequestInit | undefined };

function recordingApi(response: unknown, calls: Call[]): PortalApi {
  return async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return response as T;
  };
}

test("group list adapters preserve the owned and shared endpoints", async () => {
  const calls: Call[] = [];
  const api = recordingApi({ groups: [{ id: "group-id" }] }, calls);

  assert.deepEqual(await listOwnedGroups(api), [{ id: "group-id" }]);
  assert.deepEqual(await listSharedGroups(api), [{ id: "group-id" }]);
  assert.deepEqual(calls.map((call) => call.path), ["/api/portal/groups", "/api/portal/shared"]);
});

test("group mutation adapters preserve request methods and payloads", async () => {
  const calls: Call[] = [];
  const api = recordingApi({}, calls);

  await createGroup(api, "Review team");
  await updateGroupVisibility(api, "group-id", "public");
  await updateGroupModeration(api, "group-id", true);
  await addGroupAllowedEmail(api, "group-id", "member@example.com");
  await removeGroupAllowedEmail(api, "group-id", "email-id");
  await addSyncedSkillToGroup(api, "group-id", "skill-id");

  assert.deepEqual(
    calls.map(({ path, init }) => ({
      path,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })),
    [
      {
        path: "/api/portal/groups",
        method: "POST",
        body: { name: "Review team", visibility: "restricted", syncedSkillIds: [] },
      },
      {
        path: "/api/portal/groups/group-id",
        method: "PATCH",
        body: { visibility: "public" },
      },
      {
        path: "/api/portal/groups/group-id/moderation",
        method: "PATCH",
        body: { disabled: true },
      },
      {
        path: "/api/portal/groups/group-id/allowed-emails",
        method: "POST",
        body: { email: "member@example.com" },
      },
      {
        path: "/api/portal/groups/group-id/allowed-emails",
        method: "DELETE",
        body: { emailId: "email-id" },
      },
      {
        path: "/api/portal/groups/group-id/items",
        method: "POST",
        body: { kind: "synced", syncedSkillId: "skill-id" },
      },
    ]
  );
});

test("group detail adapter preserves public access roles", async () => {
  const calls: Call[] = [];
  const api = recordingApi(
    {
      group: { id: "group-id", name: "Public group" },
      items: [],
      accessRole: "public",
    },
    calls
  );

  const result = await loadGroupDetail(api, "group-id");

  assert.equal(result.group.accessRole, "public");
  assert.deepEqual(calls.map((call) => call.path), ["/api/portal/groups/group-id"]);
});

test("portal entry delegates detailed group behavior to the group domain", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

  assert.match(source, /from "@\/groups\/GroupsPanel"/);
  assert.match(source, /from "@\/groups\/GroupDetailPage"/);
  assert.match(source, /from "@\/groups\/SkillActions"/);
  assert.equal(source.includes("/api/portal/groups"), false);
  assert.equal(source.includes("function GroupsPanel"), false);
  assert.equal(source.includes("function GroupDetailPage"), false);
  assert.equal(source.includes("function SkillActions"), false);
});

test("extraction preserves the current visibility labels for L1.1", () => {
  assert.equal(groupVisibilityLabel("public"), "public");
  assert.equal(groupVisibilityLabel("restricted"), "private");
  assert.equal(groupVisibilityLabel("private"), "private");
});

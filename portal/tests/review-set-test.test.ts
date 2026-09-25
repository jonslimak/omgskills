import assert from "node:assert/strict";
import test from "node:test";
import { createReviewSetTest, reviewTestSetName } from "../src/review/set-test";
import type { PortalApi } from "../src/portal-api";

const id = "11111111-1111-4111-8111-111111111111";
const existing = "22222222-2222-4222-8222-222222222222";
const create = { method: "POST", body: JSON.stringify({ name: reviewTestSetName, visibility: "private", syncedSkillIds: [] }) };
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const calls: string[] = [];
  let allowed = true;
  const api = (async (path: string) => {
    calls.push(path);
    return path.endsWith("review-access") ? { allowed } : { groupId: id };
  }) as PortalApi;
  return { storage, api, calls, revoke: () => { allowed = false; } };
}

test("review test scopes writes to its own creation receipt, including after refresh", async () => {
  const { storage, api, calls } = setup();
  const session = createReviewSetTest(api, storage, "account-session");
  await assert.rejects(session.api(`/api/portal/groups/${existing}`, { method: "DELETE" }), /disposable/);
  assert.equal(calls.length, 0);
  await session.api("/api/portal/groups", create);
  assert.equal(session.ownsSet(id), true);
  assert.equal(session.ownsSet(existing), false);
  assert.deepEqual(calls, ["/api/portal/review-access", "/api/portal/groups"]);
  const refreshed = createReviewSetTest(api, storage, "account-session");
  assert.equal(refreshed.ownsSet(id), true);
  const otherAccount = createReviewSetTest(api, storage, "other-session");
  assert.equal(otherAccount.ownsSet(id), false);
  for (const [suffix, method, body] of [
    ["", "PATCH", { name: "Renamed", description: "Test" }],
    ["/items", "POST", { kind: "synced", syncedSkillId: "skill" }],
    ["/items", "DELETE", { itemId: "item" }],
  ] as const) {
    await refreshed.api(`/api/portal/groups/${id}${suffix}`, { method, body: JSON.stringify(body) });
    assert.equal(calls.at(-2), "/api/portal/review-access");
  }
  await refreshed.api(`/api/portal/groups/${id}`, { method: "DELETE" });
  assert.equal(refreshed.ownsSet(id), false);
  assert.equal(createReviewSetTest(api, storage, "account-session").ownsSet(id), false);
});

test("review test blocks existing sets, sharing, publication, favorites and unrelated mutations", async () => {
  const { storage, api, calls } = setup();
  const session = createReviewSetTest(api, storage, "account");
  await session.api("/api/portal/groups", create);
  const count = calls.length;
  for (const [path, method, body] of [
    [`/api/portal/groups/${existing}`, "PATCH", { name: "Changed" }],
    [`/api/portal/groups/${existing}/items`, "POST", { kind: "synced", syncedSkillId: "skill" }],
    [`/api/portal/groups/${id}`, "PATCH", { visibility: "public" }],
    [`/api/portal/groups/${id}/allowed-emails`, "POST", { email: "a@example.test" }],
    [`/api/portal/groups/${id}/moderation`, "PATCH", { disabled: true }],
    ["/api/portal/groups", "POST", { name: "Favorite Skills", visibility: "public", isFavorites: true }],
    ["/api/portal/profile", "PATCH", { published: true }],
    ["/api/portal/devices/test", "DELETE", {}],
    ["/api/portal/sync-pairing-code", "POST", {}],
    [`https://example.com/api/portal/groups/${id}`, "DELETE", {}],
  ] as const) await assert.rejects(session.api(path, { method, body: JSON.stringify(body) }), /disposable/);
  await assert.rejects(session.api("/api/portal/groups", create), /disposable/);
  assert.equal(calls.length, count);
});

test("review test fails closed on revoked access and unavailable receipt storage", async () => {
  const { storage, api, calls, revoke } = setup();
  const session = createReviewSetTest(api, storage, "account");
  await session.api("/api/portal/groups", create);
  revoke();
  await assert.rejects(session.api(`/api/portal/groups/${id}`, { method: "DELETE" }), /Review unavailable/);
  assert.equal(calls.length, 3);
  const broken = createReviewSetTest(api, { ...storage, setItem: () => { throw new Error("Storage blocked"); } }, "other");
  await assert.rejects(broken.api("/api/portal/groups", create), /Storage blocked/);
  assert.equal(calls.length, 3);
});

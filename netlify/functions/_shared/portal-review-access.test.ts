import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@netlify/functions";
import { portalReviewAccess } from "../portal-review-access.mjs";

const request = new Request("https://omgskills.com/api/portal/review-access");
const context = {} as Context;

function dependencies(value: string | undefined, userId = "user_owner123") {
  let calls = 0;
  return {
    calls: () => calls,
    getEnv: (key: string) => { assert.equal(key, "PORTAL_REVIEW_CLERK_USER_IDS"); return value; },
    isSkillGroupsWebEnabled: () => true,
    requireAuth: async () => { calls += 1; return { clerkUserId: userId }; },
  };
}

test("review gate defaults closed and never reconciles database identities", async () => {
  for (const value of [undefined, "", "*", "owner@example.com", "user_owner123,", "user_owner123,invalid"]) {
    const deps = dependencies(value);
    const response = await portalReviewAccess(request, context, deps);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(deps.calls(), 0);
  }
});

test("review gate only admits explicitly configured signed-in Clerk IDs", async () => {
  const allowed = await portalReviewAccess(request, context, dependencies(" user_owner123 "));
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { allowed: true });
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.equal((await portalReviewAccess(request, context, dependencies("user_other"))).status, 404);
  const denied = dependencies("user_owner123");
  assert.equal((await portalReviewAccess(request, context, {
    ...denied, requireAuth: async () => { throw new Response("private", { status: 401 }); },
  })).status, 401);
  const failed = await portalReviewAccess(request, context, {
    ...denied, requireAuth: async () => { throw new Error("secret"); },
  });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes("secret"), false);
});

test("review gate rejects mutations and obeys the existing web feature gate", async () => {
  const deps = dependencies("user_owner123");
  for (const method of ["POST", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal((await portalReviewAccess(new Request(request.url, { method }), context, deps)).status, 405);
  }
  assert.equal((await portalReviewAccess(request, context, { ...deps, isSkillGroupsWebEnabled: () => false })).status, 404);
  assert.equal(deps.calls(), 0);
});

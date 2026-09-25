import assert from "node:assert/strict";
import test from "node:test";
import { isReviewRoute, parseRoute } from "../src/app/routes";
import { accountCacheKey } from "../src/integration/account-session";
import { reviewReadApi } from "../src/review/policy";
import type { PortalApi } from "../src/portal-api";
import { PortalApiError } from "../src/api-error";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePage } from "../src/app/AccountPages";
import { DevicesPanel } from "../src/integration/DevicesPanel";
import { emptyAccount } from "../src/integration/data";
import type { PortalActions } from "../src/app/model";

test("review route is separate from the normal portal, local fixtures and pairing", () => {
  for (const path of ["/app/review", "/app/review/", "/app/review/sets", "/app/review/groups/test"]) {
    assert.equal(isReviewRoute(path), true);
  }
  for (const path of ["/app/", "/app/sets", "/app/connect", "/connect", "/app/reviews", "/app/preview/", "/app/integration/"]) {
    assert.equal(isReviewRoute(path), false);
  }
  assert.equal(parseRoute("/app/review/sets", "", "/app/review/").page, "sets");
  assert.equal(parseRoute("/app/review/groups/test", "", "/app/review/").groupId, "test");
  assert.notEqual(accountCacheKey("key", "user", "session", "review"), accountCacheKey("key", "user", "session", "app"));
});

test("review transport checks access before each read and fails closed", async () => {
  const calls: string[] = [];
  let allowed = true;
  const api = (async (path: string) => {
    calls.push(path);
    return path.endsWith("review-access") ? { allowed } : { skills: [] };
  }) as PortalApi;
  const review = reviewReadApi(api);
  assert.deepEqual(await review("/api/portal/synced-skills"), { skills: [] });
  assert.deepEqual(calls, ["/api/portal/review-access", "/api/portal/synced-skills"]);
  allowed = false;
  await assert.rejects(review("/api/portal/profile"), /Review unavailable/);
  assert.equal(calls.at(-1), "/api/portal/review-access");
  assert.equal(calls.length, 3);
  const failed = reviewReadApi(async () => { throw new Error("offline"); });
  await assert.rejects(failed("/api/portal/groups"), /offline/);
  const revoked = reviewReadApi(async () => { throw new PortalApiError("Review unavailable", 404); });
  await assert.rejects(revoked("/api/portal/profile"), (error: unknown) => error instanceof PortalApiError && error.status === 403);
});

test("read-only review disables account editing and device pairing while retaining sign-out", () => {
  const fail = () => { assert.fail("Rendering cannot perform actions"); };
  const html = renderToStaticMarkup(createElement(HomePage, {
    data: emptyAccount({ name: "Reviewer", email: "reviewer@example.test" }),
    actions: {} as PortalActions, editProfile: fail, unavailable: fail, copy: fail, readOnly: true,
    accountControls: { settings: fail, settingsDisabled: true, signOut: fail, busy: false },
  }));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Account settings<\/button>/);
  const signOut = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Sign out<\/button>/)?.[0];
  assert.ok(signOut);
  assert.doesNotMatch(signOut, /\sdisabled=""/);
  const devices = renderToStaticMarkup(createElement(DevicesPanel, {
    api: async () => { assert.fail("Rendering cannot request data"); }, denied: fail, local: false, readOnly: true,
  }));
  assert.match(devices, /<button[^>]*disabled=""[^>]*>Connect app<\/button>/);
});

test("review transport blocks every write and external path before any network request", async () => {
  const review = reviewReadApi(async () => { assert.fail("Must not send a request"); });
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    await assert.rejects(review("/api/portal/groups", { method }), /read-only/);
  }
  await assert.rejects(review("/api/portal/profile", { body: "data" }), /read-only/);
  await assert.rejects(review("https://example.com/api/portal/groups"), /read-only/);
  await assert.rejects(review("/api/portal/sync-pairing-code"), /read-only/);
});

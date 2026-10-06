import test from "node:test";
import assert from "node:assert/strict";
import { allowedRequest, allowedManagementBody, allowedSetMutation, backendOrigin, frontendOrigin, clerkFrontend, connectionString, socket, database, cleanEnvironment, verifyClerk } from "../testing/local-environment.mjs";

const host = new URL(backendOrigin).host;
test("local access writes require ownership, active sets and appropriate visibility", () => {
  const set = { visibility: "restricted", isFavorites: false, disabledAt: null };
  for (const role of ["invited", "public"]) {
    for (const route of ["detail", "items", "emails"]) assert.equal(allowedSetMutation(set, role, route, "POST"), false);
  }
  assert.equal(allowedSetMutation(set, "owner", "emails", "POST"), true);
  for (const visibility of ["private", "public"]) {
    assert.equal(allowedSetMutation({ ...set, visibility }, "owner", "emails", "POST"), false);
    assert.equal(allowedSetMutation({ ...set, visibility }, "owner", "emails", "DELETE"), true);
    assert.equal(allowedSetMutation({ ...set, visibility }, "owner", "detail", "PATCH"), true);
  }
  assert.equal(allowedSetMutation({ ...set, disabledAt: "today" }, "owner", "detail", "PATCH"), false);
  assert.equal(allowedSetMutation({ ...set, isFavorites: true }, "owner", "emails", "POST"), false);
  assert.equal(allowedSetMutation({ ...set, isFavorites: true }, "owner", "detail", "PATCH"), false);
});
test("local environment uses only its named Unix-socket database", () => {
  const url = new URL(connectionString());
  assert.equal(url.hostname, "");
  assert.equal(url.pathname, `/${database}`);
  assert.equal(url.searchParams.get("host"), socket);
  assert.deepEqual(Object.keys(cleanEnvironment()).sort(), ["HOME", "LC_ALL", "PATH", "TMPDIR", "USER"]);
});
test("local read harness blocks writes, unknown paths, bodies, queries and foreign origins", () => {
  const route = "/api/portal/synced-skills";
  assert.equal(allowedRequest(route, "GET", { host, origin: frontendOrigin }), true);
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) assert.equal(allowedRequest(route, method, { host }), false);
  for (const path of ["/api/portal/sync-token", "/api/portal/private-sources", `${route}?x=1`, "//api/portal/synced-skills"]) assert.equal(allowedRequest(path, "GET", { host }), false);
  for (const extra of [{ host: "evil.test" }, { origin: "https://omgskills.com" }, { "sec-fetch-site": "cross-site" }, { "content-length": "1" }, { "transfer-encoding": "chunked" }]) assert.equal(allowedRequest(route, "GET", { host, ...extra }), false);
});
test("Clerk must be a development instance, not production or an arbitrary URL", () => {
  const encode = (host: string) => `pk_test_${Buffer.from(host).toString("base64")}`;
  assert.equal(clerkFrontend(encode("example.clerk.accounts.dev$")), "https://example.clerk.accounts.dev");
  for (const key of ["pk_live_anything", "", encode("evil.test$"), encode("foo.clerk.accounts.dev.evil.test$"), encode("foo.clerk.accounts.dev/path$")]) assert.throws(() => clerkFrontend(key));
});

test("local management must opt in; access is narrow and bulk and unrelated writes stay blocked", () => {
  const headers = { host, origin: frontendOrigin, "content-type": "application/json", "content-length": "32" };
  const groups = "/api/portal/groups";
  assert.equal(allowedRequest(groups, "POST", headers), false);
  assert.equal(allowedRequest(groups, "POST", headers, true), true);
  for (const [path, method] of [["/api/portal/profile", "PATCH"], [`${groups}/one`, "DELETE"], [`${groups}/one/items`, "PATCH"]]) {
    assert.equal(allowedRequest(path, method, headers, true), false);
  }
  assert.equal(allowedRequest(groups, "POST", { ...headers, origin: "https://omgskills.com" }, true), false);
  assert.equal(allowedRequest(groups, "POST", { ...headers, "content-length": "99999" }, true), false);
  assert.equal(allowedManagementBody(groups, "POST", { name: "Test", visibility: "private", syncedSkillIds: [] }), true);
  assert.equal(allowedManagementBody(groups, "POST", { name: "Test", visibility: "public" }), false);
  assert.equal(allowedManagementBody(groups, "POST", { name: "Favorites", visibility: "public", isFavorites: true, syncedSkillIds: ["one"] }), true);
  assert.equal(allowedManagementBody(groups, "POST", { name: "Test", syncedSkillIds: ["one", "two"] }), false);
  assert.equal(allowedManagementBody(`${groups}/one`, "PATCH", { name: "Renamed" }), true);
  assert.equal(allowedManagementBody(`${groups}/one`, "PATCH", { name: "Renamed", visibility: "public" }), true);
  assert.equal(allowedManagementBody(`${groups}/one`, "PATCH", { visibility: "restricted" }), true);
  for (const body of [{}, { visibility: "unknown" }, { visibility: "public", owner: "other" }]) {
    assert.equal(allowedManagementBody(`${groups}/one`, "PATCH", body), false);
  }
  const access = `${groups}/one/allowed-emails`;
  assert.equal(allowedRequest(access, "POST", headers), false);
  assert.equal(allowedRequest(access, "POST", headers, true), true);
  assert.equal(allowedManagementBody(access, "POST", { email: "test@example.test" }), true);
  assert.equal(allowedManagementBody(access, "POST", { email: "invalid" }), false);
  assert.equal(allowedManagementBody(access, "POST", { email: "test@example.test", role: "owner" }), false);
  assert.equal(allowedManagementBody(access, "DELETE", { emailId: "one" }), true);
  assert.equal(allowedManagementBody(`${groups}/one/items`, "POST", { kind: "synced", syncedSkillId: "one" }), true);
  assert.equal(allowedManagementBody(`${groups}/one/items`, "POST", { kind: "catalog", catalogSkillId: "one" }), false);
  assert.equal(allowedManagementBody(`${groups}/one/items`, "DELETE", { itemId: "one" }), true);
});
test("Clerk verification rejects keys from different instances and upstream failures", async () => {
  const original = globalThis.fetch;
  const keys = { publicKey: "unused", secretKey: "test-only", frontend: "https://example.clerk.accounts.dev" };
  try {
    globalThis.fetch = async (url) => Response.json({ keys: [{ kid: "same-id", n: String(url).includes("api.clerk.com") ? "server" : "browser", e: "AQAB" }] });
    await assert.rejects(verifyClerk(keys), /same development instance/);
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(verifyClerk(keys), /verification failed/);
    globalThis.fetch = async () => Response.json({ keys: [{ kid: "same-id", n: "same-key", e: "AQAB" }] });
    await verifyClerk(keys);
  } finally { globalThis.fetch = original; }
});

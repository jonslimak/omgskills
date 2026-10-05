import test from "node:test";
import assert from "node:assert/strict";
import { allowedRequest, backendOrigin, frontendOrigin, clerkFrontend, connectionString, socket, database, cleanEnvironment, verifyClerk } from "../testing/local-environment.mjs";

const host = new URL(backendOrigin).host;
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

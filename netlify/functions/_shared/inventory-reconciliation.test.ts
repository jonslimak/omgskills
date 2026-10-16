import assert from "node:assert/strict";
import test from "node:test";
import { parseReconciliationFields, requireLocalInventoryReconciliation } from "./inventory-reconciliation.js";

const roots = ["claude", "codex", "agents"].map(source => ({ source, state: "complete" }));
const env = {
  OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "1", OMGSKILLS_CONNECTED_INVENTORY_TEST: "1",
  PORTAL_TEST_ENVIRONMENT_VERIFIED: "1", CONTEXT: "dev", NODE_ENV: "test",
  PORTAL_TEST_API_ORIGIN: "http://127.0.0.1:8888"
};
const request = new Request("http://127.0.0.1:8888/api/portal/sync-upload?reportVersion=3");
function rejects(run: () => unknown, status: number) {
  assert.throws(run, (error: unknown) => error instanceof Response && error.status === status);
}

test("reconciliation coverage is closed, complete and preserves explicit revision semantics", () => {
  assert.deepEqual(parseReconciliationFields({ baseRevision: null, roots }), { baseRevision: null, roots });
  const revision = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
  assert.equal(parseReconciliationFields({ baseRevision: revision, roots }).baseRevision, revision.toLowerCase());
  for (const [state, reasons] of Object.entries({ incomplete: ["changed", "invalid-entry", "invalid-metadata"],
    unavailable: ["missing", "unreadable", "redirected"] })) {
    for (const reason of reasons) assert.equal(parseReconciliationFields({ baseRevision: null,
      roots: [{ source: "claude", state, reason }, ...roots.slice(1)] }).roots[0].reason, reason);
  }
  for (const bad of [
    {}, { baseRevision: undefined, roots }, { baseRevision: "bad", roots }, { baseRevision: 1, roots },
    { baseRevision: null, roots: [] }, { baseRevision: null, roots: [...roots, roots[0]] },
    { baseRevision: null, roots: [roots[0], roots[0], roots[2]] },
    ...[{ source: "other", state: "complete" }, { source: "Claude", state: "complete" },
      { source: "claude", state: "complete", reason: null },
      { source: "claude", state: "complete", reason: "missing" },
      { source: "claude", state: "incomplete", reason: "missing" },
      { source: "claude", state: "unavailable", reason: "changed" },
      { source: "claude", state: "unknown" }, { source: "claude", state: "incomplete" },
      { source: "claude", state: "complete", path: "/Users/private" }, null, []]
      .map(root => ({ baseRevision: null, roots: [root, ...roots.slice(1)] }))
  ]) rejects(() => parseReconciliationFields(bad), 400);
});

test("reconciliation remains dormant except for exact verified development loopback configuration", () => {
  requireLocalInventoryReconciliation(request, env, "dev");
  for (const key of Object.keys(env)) rejects(() => requireLocalInventoryReconciliation(request, { ...env, [key]: undefined }), 503);
  for (const change of [
    { OMGSKILLS_INVENTORY_RECONCILIATION_TEST: "true" }, { CONTEXT: "production" }, { CONTEXT: "deploy-preview" },
    { NODE_ENV: "production" }, { PORTAL_TEST_ENVIRONMENT_VERIFIED: "0" },
    ...["https://example.com", "http://127.0.0.1", "http://user:secret@127.0.0.1:8888", "http://127.0.0.1:8888/path",
      "http://127.0.0.1:8888/?query=1", "http://127.0.0.1:8888/#fragment", "http://127.0.0.1:9999"]
      .map(PORTAL_TEST_API_ORIGIN => ({ PORTAL_TEST_API_ORIGIN }))
  ]) rejects(() => requireLocalInventoryReconciliation(request, { ...env, ...change }), 503);
  for (const context of ["production", "deploy-preview"]) rejects(() => requireLocalInventoryReconciliation(request, env, context), 503);
  for (const url of ["https://example.com/api/portal/sync-upload", "http://127.0.0.1:8888/api/other"])
    rejects(() => requireLocalInventoryReconciliation(new Request(url), env), 503);
});

test("the local gate requires an explicit allowlisted endpoint and never broadens the upload default", () => {
  const read = new Request("http://127.0.0.1:8888/api/portal/synced-skills?version=3");
  rejects(() => requireLocalInventoryReconciliation(read, env, "dev"), 503);
  requireLocalInventoryReconciliation(read, env, "dev", "/api/portal/synced-skills");
  rejects(() => requireLocalInventoryReconciliation(request, env, "dev", "/api/portal/synced-skills"), 503);
  rejects(() => requireLocalInventoryReconciliation(read, env, "dev", "/api/portal/profile" as never), 503);
  for (const key of Object.keys(env)) {
    rejects(() => requireLocalInventoryReconciliation(read, { ...env, [key]: undefined }, "dev", "/api/portal/synced-skills"), 503);
  }
  for (const context of ["production", "deploy-preview"]) {
    rejects(() => requireLocalInventoryReconciliation(read, env, context, "/api/portal/synced-skills"), 503);
  }
  for (const url of ["https://example.test/api/portal/synced-skills?version=3",
    "http://127.0.0.1:9999/api/portal/synced-skills?version=3",
    "http://127.0.0.1:8888/api/portal/shared?version=3"]) {
    rejects(() => requireLocalInventoryReconciliation(new Request(url), env, "dev", "/api/portal/synced-skills"), 503);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialNavigation, navigationSearch } from "../src/app/unified/model";
import { accountNavigation, publicNavigation } from "../src/integration/unified/policy";
import { readOnlyApi } from "../src/integration/data";
import { createAccountSession } from "../src/integration/account-session";
import type { PortalApi } from "../src/portal-api";

test("private navigation is cleared on logout, public selection survives", () => {
  const privateNav = { ...initialNavigation, query: "private project", selected: "synced:private", source: "Claude" };
  assert.deepEqual(accountNavigation(privateNav, false), { ...initialNavigation, view: "discover" });
  const publicNav = { ...initialNavigation, view: "discover" as const, selected: "catalog:public", query: "design" };
  assert.deepEqual(accountNavigation(publicNav, false), publicNav);
  assert.equal(accountNavigation({ ...publicNav, selected: "synced:private" }, false).selected, "");
});
test("unsupported account destinations never render fake devices or incomplete sets", () => {
  for (const view of ["set", "sets", "favorites", "devices", "github", "mcp"] as const) {
    assert.deepEqual(accountNavigation({ ...initialNavigation, view, id: "private-id" }, true), initialNavigation);
  }
});
test("private search and identifiers cannot reach the public catalog hook", () => {
  const privateNav = { ...initialNavigation, query: "confidential", id: "private-id", selected: "synced:secret" };
  assert.deepEqual(publicNavigation(privateNav), initialNavigation);
  assert.equal(navigationSearch(publicNavigation(privateNav)), "");
  const discovery = { ...initialNavigation, view: "discover" as const, query: "React" };
  assert.deepEqual(publicNavigation(discovery), discovery);
});
test("authenticated controller receives a read-only transport even for accidental edits", async () => {
  const requests: string[] = [];
  const api: PortalApi = async <T>(path: string) => {
    requests.push(path);
    return (path.endsWith("synced-skills") ? { skills: [] } : path.endsWith("profile")
      ? { profile: { handle: null, profilePublished: false, publicUrl: null } } : { groups: [] }) as T;
  };
  const session = createAccountSession({ api: readOnlyApi(api), identity: { name: "Test", email: "test@example.test" }, cacheKey: "isolated-account", changed: () => {} });
  await session.refresh();
  assert.equal(session.getSnapshot().data?.skills.length, 0);
  await assert.rejects(session.saveProfile({ handle: "not-allowed" }));
  assert.equal(requests.length, 4);
  session.dispose();
});
test("unified authenticated entry remains inside the local integration guard and has no fixtures", () => {
  const bootstrap = readFileSync(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
  assert.ok(bootstrap.indexOf("isLocalIntegration({") < bootstrap.indexOf('import("./integration/unified/main")'));
  for (const file of ["main.tsx", "Session.tsx", "useAccount.ts"]) {
    const source = readFileSync(new URL(`../src/integration/unified/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /makeFixtures|preview\/fixtures|sessionStorage|localStorage/);
  }
});

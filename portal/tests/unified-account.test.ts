import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialNavigation, navigationSearch, openSkillNavigation, setAccessSummary, setSkillDisplays, skillDisplays } from "../src/app/unified/model";
import { accountNavigation, publicNavigation } from "../src/integration/unified/policy";
import { readOnlyApi } from "../src/integration/data";
import { createAccountSession } from "../src/integration/account-session";
import type { PortalApi } from "../src/portal-api";
import { managementApi } from "../src/integration/unified/management-api";
import { makeFixtures } from "../src/preview/fixtures";
import { startSetRead } from "../src/integration/read-session";

test("private navigation is cleared on logout, public selection survives", () => {
  const privateNav = { ...initialNavigation, query: "private project", selected: "synced:private", source: "Claude" };
  assert.deepEqual(accountNavigation(privateNav, false), { ...initialNavigation, view: "discover" });
  const publicNav = { ...initialNavigation, view: "discover" as const, selected: "catalog:public", query: "design" };
  assert.deepEqual(accountNavigation(publicNav, false), publicNav);
  assert.equal(accountNavigation({ ...publicNav, selected: "synced:private" }, false).selected, "");
});
test("connected account destinations retain their route but clear unrelated private IDs", () => {
  for (const view of ["devices", "github", "mcp"] as const) {
    assert.deepEqual(accountNavigation({ ...initialNavigation, view, id: "private-id" }, true), { ...initialNavigation, view });
    assert.equal(accountNavigation({ ...initialNavigation, view }, false).view, "discover");
  }
});
test("set and Favorites routes survive sign-in, but clear private IDs on logout", () => {
  for (const view of ["sets", "set", "favorites"] as const) {
    const nav = { ...initialNavigation, view, id: view === "set" ? "test-set" : "", selected: view === "set" ? "set-item:123" : "" };
    assert.deepEqual(accountNavigation(nav, true), nav);
    assert.deepEqual(accountNavigation(nav, false), { ...initialNavigation, view: "discover" });
    assert.deepEqual(publicNavigation(nav), initialNavigation);
  }
  assert.equal(accountNavigation({ ...initialNavigation, view: "set", id: "../profile" }, true).view, "sets");
});
test("private search and identifiers cannot reach the public catalog hook", () => {
  const privateNav = { ...initialNavigation, query: "confidential", id: "private-id", selected: "synced:secret" };
  assert.deepEqual(publicNavigation(privateNav), initialNavigation);
  assert.equal(navigationSearch(publicNavigation(privateNav)), "");
  const discovery = { ...initialNavigation, view: "discover" as const, query: "React" };
  assert.deepEqual(publicNavigation(discovery), discovery);
});
test("related skills keep installed detail local and clear private context before public navigation", () => {
  const data = makeFixtures();
  const mine = skillDisplays(data, { skills: [], collections: [], creators: [], categories: [], trendingIds: [] }).mine;
  const skill = mine[0];
  const nav = { ...initialNavigation, view: "set" as const, id: "private-set", query: "confidential", source: "Claude" };
  const installed = openSkillNavigation(nav, { ...skill, key: "catalog:public" });
  assert.equal(installed.selected, skill.key);
  assert.deepEqual(accountNavigation(installed, true), installed);
  assert.deepEqual(publicNavigation(installed), initialNavigation);
  const publicSkill = { ...skill, key: "catalog:public", installed: undefined };
  const opened = openSkillNavigation(nav, publicSkill);
  assert.deepEqual(opened, { ...initialNavigation, view: "discover", selected: publicSkill.key });
  assert.deepEqual(accountNavigation(opened, true), opened);
  const discover = { ...initialNavigation, view: "creator" as const, id: "author", query: "React" };
  assert.deepEqual(openSkillNavigation(discover, publicSkill), { ...discover, selected: publicSkill.key });
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

test("management transport rejects unrelated writes without reaching the API", async () => {
  const calls: string[] = [];
  const api = managementApi(async <T>(path: string) => { calls.push(path); return {} as T; });
  for (const path of ["/api/portal/profile", "/api/portal/sync-token", "/api/portal/groups/test/moderation"]) {
    await assert.rejects(api(path, { method: "POST" }));
  }
  await assert.rejects(api("/api/portal/groups/test", { method: "DELETE" }));
  await assert.rejects(api("/api/portal/devices/test", { method: "DELETE" }));
  assert.deepEqual(calls, []);
  await api("/api/portal/groups/test", { method: "GET" });
  await api("/api/portal/groups", { method: "POST", body: JSON.stringify({ name: "Test" }) });
  assert.equal(calls.length, 2);
  await api("/api/portal/groups/test/allowed-emails", { method: "POST", body: JSON.stringify({ email: "test@example.test" }) });
  await api("/api/portal/groups/test/allowed-emails", { method: "DELETE", body: JSON.stringify({ emailId: "one" }) });
  assert.equal(calls.length, 4);
  for (const path of ["/api/portal/groups/test/items", "/api/portal/groups/test/moderation", "/api/portal/profile"]) await api(path, { method: "PATCH" });
  assert.equal(calls.length, 7);
});

test("set presentation preserves mixed items and order, without name-based install matching", () => {
  const data = makeFixtures();
  const mine = skillDisplays(data, { skills: [], collections: [], creators: [], categories: [], trendingIds: [] }).mine;
  const first = mine[0];
  const set = { ...data.sets[0], items: [
    { id: "github", name: first.name, description: "Same name, not installed", githubUrl: "https://github.com/example/repo", kind: "github" as const, syncedSkillId: null },
    { id: "catalog", name: "Catalog only", description: "Saved catalog row", githubUrl: null, kind: "catalog" as const, syncedSkillId: null },
    { id: "synced", name: first.name, description: "Installed", githubUrl: null, kind: "synced" as const, syncedSkillId: first.installed!.allSkillIds[0] },
  ] };
  const rows = setSkillDisplays(set, mine);
  assert.deepEqual(rows.map(row => row.setItemId), ["github", "catalog", "synced"]);
  assert.equal(rows[0].installed, undefined);
  assert.equal(rows[1].installed, undefined);
  assert.equal(rows[2].installed?.id, first.installed?.id);
  assert.equal(rows[0].key, "set-item:github");
});

test("cancelled set reads cannot restore old-account detail", async () => {
  let finish!: (value: unknown) => void;
  let updated = false;
  let signal: AbortSignal | null | undefined;
  const api: PortalApi = <T>(_path: string, init?: RequestInit) => {
    signal = init?.signal;
    return new Promise<T>(resolve => { finish = resolve as typeof finish; });
  };
  const cancel = startSetRead(api, "test", () => { updated = true; }, () => { updated = true; });
  cancel();
  assert.equal(signal?.aborted, true);
  finish({ group: { id: "test", name: "Old", visibility: "private" }, items: [], accessRole: "owner" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updated, false);
});

test("set header distinguishes email access from confirmed members", () => {
  const set = { ...makeFixtures().sets[0], ownerName: "Owner", role: "owner" as const,
    visibility: "restricted" as const, allowedEmails: [{ id: "one", email: "person@example.test" }] };
  assert.deepEqual(setAccessSummary(set), { people: ["Owner", "person@example.test"], label: "1 email with access" });
  assert.deepEqual(setAccessSummary({ ...set, allowedEmails: [] }), { people: ["Owner"], label: "0 emails with access" });
  assert.equal(setAccessSummary({ ...set, allowedEmails: undefined }).label, "Invite only");
});

test("set header never shows inactive saved emails or owner-only access records to readers", () => {
  const set = { ...makeFixtures().sets[0], ownerName: "Owner", role: "owner" as const,
    allowedEmails: [{ id: "one", email: "person@example.test" }] };
  assert.deepEqual(setAccessSummary({ ...set, visibility: "private" }), { people: ["Owner"], label: "Only you" });
  assert.deepEqual(setAccessSummary({ ...set, visibility: "public" }), { people: ["Owner"], label: "Public access" });
  assert.deepEqual(setAccessSummary({ ...set, visibility: "restricted", role: "invited" }), { people: ["Owner"], label: "Invite only" });
});

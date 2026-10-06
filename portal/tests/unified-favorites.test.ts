import test from "node:test";
import assert from "node:assert/strict";
import { isFavorite, setSkillDisplays, skillDisplays, type SkillDisplay } from "../src/app/unified/model";
import { emptyAccount, loadAccountData } from "../src/integration/data";
import { createAccountSession } from "../src/integration/account-session";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { removeFavoriteMembership } from "../src/integration/membership-data";

const identity = { name: "Tester", email: "tester@example.test" };
const catalogId = "owner/repo:skill";
const skill: SkillDisplay = { key: `catalog:${catalogId}`, catalogId, name: "Skill", description: "", author: "owner", githubUrl: null, tags: [] };
const item = (id = "catalog-item", extra = {}) => ({ id, kind: "catalog", catalogSkillId: catalogId, name: "Skill", description: "", position: 0, githubUrl: null, ...extra });

function fixture(options: { role?: string; hidden?: boolean; isFavorites?: boolean; missingIdentity?: boolean; failDelete?: number; badDelete?: boolean; failRead?: number } = {}) {
  let items = [item()];
  const calls: { path: string; method: string; body: any }[] = [];
  const group = () => ({ id: "favorites", name: "Favorite Skills", visibility: "public", isFavorites: options.isFavorites ?? true,
    itemCount: items.length, syncedSkillIds: [], disabledAt: options.hidden ? "2026-10-06" : null });
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === "/api/portal/synced-skills") return { skills: [] } as T;
    if (path === "/api/portal/profile") return { profile: { handle: null, profilePublished: false, publicUrl: null } } as T;
    if (path === "/api/portal/shared") return { groups: [] } as T;
    if (path === "/api/portal/groups") return { groups: [group()] } as T;
    if (path === "/api/portal/groups/favorites" && method === "GET") {
      if (options.failRead) throw new PortalApiError("Read failed", options.failRead);
      return { group: group(), accessRole: options.role ?? "owner",
        items: items.map(value => options.missingIdentity ? { ...value, catalogSkillId: undefined } : value) } as T;
    }
    if (path === "/api/portal/groups/favorites/items" && method === "POST") {
      items.push(item("added", { catalogSkillId: body.catalogSkillId }));
      return { itemId: "added" } as T;
    }
    if (path === "/api/portal/groups/favorites/items" && method === "DELETE") {
      if (options.failDelete) throw new PortalApiError("Delete failed", options.failDelete);
      if (options.badDelete) return {} as T;
      items = items.filter(value => value.id !== body.itemId);
      return { itemId: body.itemId, deleted: true } as T;
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  return { api, calls, setItems: (next: ReturnType<typeof item>[]) => { items = next; } };
}

test("unified account loads owned Favorites items, while legacy summaries remain unchanged", async () => {
  const f = fixture();
  const legacy = await loadAccountData(f.api, identity);
  assert.equal(legacy.sets[0].items.length, 0);
  const data = await loadAccountData(f.api, identity, true);
  assert.equal(data.sets[0].items[0]?.catalogSkillId, catalogId);
  assert.equal(f.calls.filter(call => call.path === "/api/portal/groups/favorites").length, 1);
});

test("catalog Favorites are recognized by exact ID without an installation", async () => {
  const f = fixture();
  const data = await loadAccountData(f.api, identity, true);
  assert.equal(isFavorite(data, skill), true);
  assert.equal(isFavorite(data, { ...skill, catalogId: "other/repo:skill" }), false);
  assert.equal(isFavorite(emptyAccount(identity), skill), false);
  data.sets[0].role = "invited";
  assert.equal(isFavorite(data, skill), false);
});

test("catalog Favorite removal reads fresh item IDs and reconciles the heart after saving", async () => {
  const f = fixture();
  const session = createAccountSession({ api: f.api, identity, cacheKey: "test", includeFavoriteItems: true, changed: () => {} });
  await session.refresh();
  assert.equal(isFavorite(session.getSnapshot().data!, skill), true);
  f.setItems([item("fresh-item")]);
  const result = await session.saveMembership({ kind: "remove-favorite", catalogId });
  assert.equal(result.removed, 1);
  assert.equal(isFavorite(session.getSnapshot().data!, skill), false);
  assert.equal(session.getSnapshot().data!.sets[0].itemCount, 0);
  assert.deepEqual(f.calls.filter(call => call.method !== "GET"), [
    { path: "/api/portal/groups/favorites/items", method: "DELETE", body: { itemId: "fresh-item" } },
  ]);
  assert.equal((await session.saveMembership({ kind: "remove-favorite", catalogId })).unchanged, 1);
  session.dispose();
});

test("installed skill presentation recognizes an existing catalog Favorite", async () => {
  const data = await loadAccountData(fixture().api, identity, true);
  data.skills = [{ id: "installed", name: "Skill", description: "", source: "claude", catalogSkillId: catalogId, githubUrl: null }];
  const displayed = skillDisplays(data, { skills: [], collections: [], creators: [], categories: [], trendingIds: [] }).mine[0];
  assert.equal(isFavorite(data, displayed), true);
  assert.equal(setSkillDisplays(data.sets[0], [displayed])[0].installed?.id, displayed.installed?.id);
});

test("adding and reloading a catalog Favorite updates membership without installing it", async () => {
  const f = fixture(); f.setItems([]);
  const session = createAccountSession({ api: f.api, identity, cacheKey: "test", includeFavoriteItems: true, changed: () => {} });
  await session.refresh();
  assert.equal(isFavorite(session.getSnapshot().data!, skill), false);
  await session.saveMembership({ kind: "catalog", catalogId, favorite: true });
  assert.equal(isFavorite(session.getSnapshot().data!, skill), true);
  assert.equal(session.getSnapshot().data!.skills.length, 0);
  session.dispose();
  const reloaded = createAccountSession({ api: f.api, identity, cacheKey: "other-session", includeFavoriteItems: true, changed: () => {} });
  await reloaded.refresh();
  assert.equal(isFavorite(reloaded.getSnapshot().data!, skill), true);
  reloaded.dispose();
});

test("unfavorite removes matching catalog and synced representations, not similar names or URLs", async () => {
  const f = fixture();
  const data = await loadAccountData(f.api, identity, true);
  data.skills = [{ id: "installed", name: "Skill", description: "", source: "claude", catalogSkillId: catalogId, githubUrl: null }];
  const displayed = skillDisplays(data, { skills: [], collections: [], creators: [], categories: [], trendingIds: [] }).mine[0];
  f.setItems([
    item(), item("duplicate"),
    item("synced-item", { kind: "synced", syncedSkillId: "installed", catalogSkillId: undefined }),
    item("unrelated", { catalogSkillId: "other/repo:skill" }),
    item("github", { kind: "github", catalogSkillId: undefined }),
  ]);
  await removeFavoriteMembership(f.api, data.sets, catalogId, displayed.installed, new AbortController().signal);
  assert.deepEqual(f.calls.filter(call => call.method === "DELETE").map(call => call.body.itemId), ["catalog-item", "duplicate", "synced-item"]);
  const refreshed = await loadAccountData(f.api, identity, true);
  assert.equal(isFavorite(refreshed, skill), false);
  assert.equal(refreshed.sets[0].items.length, 2);
});

test("unfavorite protects ownership, hidden sets, Favorites identity, and missing item mappings", async () => {
  const sets = (await loadAccountData(fixture().api, identity, true)).sets;
  for (const options of [{ role: "invited" }, { role: "public" }, { hidden: true }, { isFavorites: false }, { missingIdentity: true }]) {
    const f = fixture(options);
    await assert.rejects(removeFavoriteMembership(f.api, sets, catalogId, undefined, new AbortController().signal));
    assert.ok(f.calls.every(call => call.method === "GET"));
  }
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(removeFavoriteMembership(f.api, sets, catalogId, undefined, controller.signal), { name: "AbortError" });
  assert.equal(f.calls.length, 0);
  const absent = await removeFavoriteMembership(f.api, [], catalogId, undefined, new AbortController().signal);
  assert.equal(absent.unchanged, 1);
  assert.equal(f.calls.length, 0);
});

test("uncertain deletions do not retry or clear the heart optimistically", async () => {
  for (const options of [{ failDelete: 500 }, { badDelete: true }]) {
    const f = fixture(options);
    const session = createAccountSession({ api: f.api, identity, cacheKey: "test", includeFavoriteItems: true, changed: () => {} });
    await session.refresh();
    await assert.rejects(session.saveMembership({ kind: "remove-favorite", catalogId }), /confirm/);
    assert.equal(isFavorite(session.getSnapshot().data!, skill), true);
    assert.match(session.getSnapshot().error, /confirm/);
    assert.equal(f.calls.filter(call => call.method === "DELETE").length, 1);
    await assert.rejects(session.saveMembership({ kind: "remove-favorite", catalogId }), /Refresh/);
    session.dispose();
  }
});

test("failed Favorites refresh retains last data but blocks further writes; access denial clears it", async () => {
  const options = { failRead: 0 };
  const f = fixture(options);
  const session = createAccountSession({ api: f.api, identity, cacheKey: "test", includeFavoriteItems: true, changed: () => {} });
  await session.refresh();
  options.failRead = 500;
  await session.refresh();
  assert.equal(isFavorite(session.getSnapshot().data!, skill), true);
  assert.match(session.getSnapshot().error, /refresh/);
  await assert.rejects(session.saveMembership({ kind: "remove-favorite", catalogId }), /Refresh/);
  options.failRead = 403;
  await session.refresh();
  assert.equal(session.getSnapshot().data, null);
  assert.equal(session.getSnapshot().accessDenied, true);
  session.dispose();
});

test("disposing an account during Favorites hydration ignores its late response", async () => {
  const f = fixture();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api: PortalApi = async (path, init) => {
    if (path === "/api/portal/groups/favorites") { started(); await gate; }
    return f.api(path, init);
  };
  const session = createAccountSession({ api, identity, cacheKey: "old-account", includeFavoriteItems: true, changed: () => {} });
  const refresh = session.refresh();
  await pending;
  session.dispose();
  release();
  await refresh;
  assert.equal(session.getSnapshot().data, null);
});

test("installed-only Favorites still use synced identity for the heart and removal", async () => {
  const f = fixture();
  f.setItems([item("synced-item", { kind: "synced", syncedSkillId: "installed", catalogSkillId: undefined })]);
  const data = await loadAccountData(f.api, identity, true);
  data.skills = [{ id: "installed", name: "Local skill", description: "", source: "claude", githubUrl: null }];
  const displayed = skillDisplays(data, { skills: [], collections: [], creators: [], categories: [], trendingIds: [] }).mine[0];
  assert.equal(isFavorite(data, displayed), true);
  await removeFavoriteMembership(f.api, data.sets, undefined, displayed.installed, new AbortController().signal);
  assert.deepEqual(f.calls.filter(call => call.method === "DELETE").map(call => call.body), [{ itemId: "synced-item" }]);
});

test("a failed deletion stops a multi-item removal without replaying the earlier delete", async () => {
  const f = fixture(); f.setItems([item("first"), item("second")]);
  let deletes = 0;
  const api: PortalApi = async (path, init) => {
    if (init?.method === "DELETE" && ++deletes === 2) throw new PortalApiError("Offline", 500);
    return f.api(path, init);
  };
  const session = createAccountSession({ api, identity, cacheKey: "test", includeFavoriteItems: true, changed: () => {} });
  await session.refresh();
  await assert.rejects(session.saveMembership({ kind: "remove-favorite", catalogId }), /confirm/);
  assert.equal(deletes, 2);
  assert.equal(isFavorite(session.getSnapshot().data!, skill), true);
  assert.deepEqual(session.getSnapshot().data!.sets[0].items.map(item => item.id), ["second"]);
  assert.match(session.getSnapshot().error, /confirm/);
  session.dispose();
});

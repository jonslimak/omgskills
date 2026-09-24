import test from "node:test";
import assert from "node:assert/strict";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { groupSyncedSkills, type SyncedSkill } from "../src/synced-skill-grouping";
import { changeMembership, changeFavorites, createSelectedSet, reorderMembership, removeMembershipItem } from "../src/integration/membership-data";
import { createAccountSession } from "../src/integration/account-session";
import { membershipStatus } from "../src/app/model";
import { setSummary } from "../src/integration/data";

const physical: SyncedSkill[] = ["codex", "claude", "second", "third"].map((id, index) => ({
  id, name: index < 2 ? "Pair" : id, description: index < 2 ? "Same skill" : id,
  catalogSkillId: index < 2 ? "owner/repo" : null, githubUrl: null, isLocalOnly: index > 1,
  source: id === "codex" ? "Codex" : "Claude", lastSeenAt: "2026-09-24T00:00:00Z",
}));
const skills = groupSyncedSkills(physical);
const pair = skills.find((skill) => skill.name === "Pair")!;
const second = skills.find((skill) => skill.id === "second")!;
const third = skills.find((skill) => skill.id === "third")!;
const signal = () => new AbortController().signal;
const item = (id: string, syncedSkillId: string | null, position = 0, kind = "synced") => ({ id, syncedSkillId, position, kind, name: id, description: "", githubUrl: null });
function fixture(initial = [] as ReturnType<typeof item>[]) {
  let items = [...initial];
  let role = "owner";
  const calls: { path: string; method: string; body: any }[] = [];
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ path, method, body });
    if (method === "GET") return { group: { id: "set", name: "Set", visibility: "private" }, accessRole: role, items } as T;
    if (method === "POST") { const id = `item-${body.syncedSkillId}`; items.push(item(id, body.syncedSkillId, items.length)); return { itemId: id } as T; }
    if (method === "DELETE") { items = items.filter((item) => item.id !== body.itemId); return { itemId: body.itemId, deleted: true } as T; }
    return { itemIds: body.itemIds } as T;
  };
  return { api, calls, items: () => items, role: (value: string) => { role = value; }, append: (value: ReturnType<typeof item>) => { items.push(value); } };
}

test("non-representative membership prevents duplicate adds; removal removes every match only", async () => {
  const f = fixture([item("claude-item", "claude"), item("catalog-item", null, 1, "catalog")]);
  const present = await changeMembership(f.api, "set", [pair], true, signal());
  assert.equal(present.unchanged, 1); assert.equal(f.calls.length, 1);
  f.append(item("codex-item", "codex", 2));
  const removed = await changeMembership(f.api, "set", [pair], false, signal());
  assert.deepEqual(removed.completedIds, ["codex"]);
  assert.deepEqual(f.calls.filter((call) => call.method === "DELETE").map((call) => call.body.itemId), ["claude-item", "codex-item"]);
  assert.deepEqual(f.items().map((item) => item.id), ["catalog-item"]);
});

test("new membership adds exactly the representative and validates returned IDs", async () => {
  const f = fixture();
  const result = await changeMembership(f.api, "set", [pair], true, signal());
  assert.equal(result.added, 1);
  assert.deepEqual(f.calls[1].body, { kind: "synced", syncedSkillId: "codex" });
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => init?.method === "POST" ? {} as T : f.api(path, init);
  const bad = await changeMembership(api, "set", [second, third], true, signal());
  assert.equal(bad.uncertain, true); assert.equal(bad.completedIds.length, 0); assert.equal(bad.failed.length, 2);
});

test("missing membership is unknown, never a guessed unchecked state", async () => {
  const summary = setSummary({ id: "set", name: "Set", slug: "set" }, true, "Owner");
  assert.equal(membershipStatus(summary, pair), null);
  assert.equal(membershipStatus({ ...summary, membershipSkillIds: [] }, pair), false);
  const f = fixture([item("legacy", null)]);
  for (const add of [true, false]) {
    const result = await changeMembership(f.api, "set", [pair], add, signal());
    assert.equal(result.failed.length, 1);
  }
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("bulk validation failure keeps only failed skills while later valid additions continue", async () => {
  const f = fixture();
  let inFlight = 0; let peak = 0;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    inFlight++; peak = Math.max(peak, inFlight);
    try {
      if (init?.method === "POST" && JSON.parse(init.body as string).syncedSkillId === "second") throw new PortalApiError("Skill changed", 409);
      return await f.api<T>(path, init);
    } finally { inFlight--; }
  };
  const result = await changeMembership(api, "set", [pair, second, third], true, signal());
  assert.equal(peak, 1); assert.equal(result.added, 2);
  assert.deepEqual(result.completedIds, [pair.id, third.id]);
  assert.deepEqual(result.failed.map((item) => item.id), [second.id]);
  assert.equal(result.uncertain, false);
});

test("an unknown write outcome stops remaining writes, with no automatic retry", async () => {
  const f = fixture(); let writes = 0;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") { writes++; throw new Error("Connection lost"); }
    return f.api<T>(path, init);
  };
  const result = await changeMembership(api, "set", [pair, second], true, signal());
  assert.equal(writes, 1); assert.equal(result.uncertain, true); assert.equal(result.failed.length, 2);
});

test("409 is already-included only when a fresh read confirms actual membership", async () => {
  const f = fixture();
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") { f.append(item("concurrent", "claude")); throw new PortalApiError("Conflict", 409); }
    return f.api<T>(path, init);
  };
  const result = await changeMembership(api, "set", [pair], true, signal());
  assert.equal(result.unchanged, 1); assert.equal(result.failed.length, 0);
});

test("shared viewers and aborted sessions cannot start membership writes", async () => {
  for (const role of ["invited", "public"]) {
    const f = fixture(); f.role(role);
    await assert.rejects(changeMembership(f.api, "set", [pair], true, signal()), /Only the owner/);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(changeMembership(f.api, "set", [pair], true, controller.signal), { name: "AbortError" });
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("Favorites creates once, preserves first success, and reports later failures", async () => {
  const f = fixture(); let creations = 0;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (path === "/api/portal/groups") {
      creations++;
      assert.deepEqual(JSON.parse(init!.body as string), { name: "Favorite Skills", isFavorites: true, visibility: "public", syncedSkillIds: ["codex"] });
      return { groupId: "set" } as T;
    }
    if (init?.method === "POST") throw new PortalApiError("Catalog unavailable", 409);
    return f.api<T>(path, init);
  };
  const result = await changeFavorites(api, [], [pair, second], true, signal());
  assert.equal(creations, 1); assert.equal(result.added, 1);
  assert.deepEqual(result.completedIds, [pair.id]); assert.deepEqual(result.failed.map((item) => item.id), [second.id]);
});

test("Favorites creation race reloads the owned set rather than treating every conflict as success", async () => {
  const f = fixture([item("existing", "claude")]);
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (path === "/api/portal/groups") {
      if (init?.method === "POST") throw new PortalApiError("Slug exists", 409);
      return { groups: [{ id: "set", isFavorites: true }] } as T;
    }
    return f.api<T>(path, init);
  };
  const result = await changeFavorites(api, [], [pair], true, signal());
  assert.equal(result.unchanged, 1);
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, 0);
});

test("selected creation passes all selected IDs in one private transaction request", async () => {
  let calls = 0;
  const api: PortalApi = async <T>(_path: string, init?: RequestInit) => {
    calls++; assert.deepEqual(JSON.parse(init!.body as string), { name: "Selected", visibility: "private", syncedSkillIds: ["codex", "second"] });
    return { groupId: "set" } as T;
  };
  const result = await createSelectedSet(api, "Selected", [pair, second], signal());
  assert.equal(calls, 1); assert.deepEqual(result.completedIds, ["codex", "second"]);
});

test("reorder includes mixed items, rejects stale/incomplete lists, and exact removal uses item identity", async () => {
  const f = fixture([item("a", "claude"), item("b", null, 1, "github"), item("c", null, 2, "catalog")]);
  await assert.rejects(reorderMembership(f.api, "set", ["a", "b"], signal()), /set changed/);
  await assert.rejects(reorderMembership(f.api, "set", ["a", "a", "b"], signal()), /set changed/);
  await reorderMembership(f.api, "set", ["c", "a", "b"], signal());
  assert.deepEqual(f.calls.find((call) => call.method === "PATCH")!.body.itemIds, ["c", "a", "b"]);
  await removeMembershipItem(f.api, "set", "b", signal());
  assert.deepEqual(f.items().map((item) => item.id), ["a", "c"]);
});

test("account controller locks writes and reconciles even partial batches", async () => {
  const f = fixture(); let release = () => {}; let delay = true;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (path.endsWith("/synced-skills")) return { skills: physical } as T;
    if (path.endsWith("/profile")) return { profile: { handle: null, profilePublished: false, publicUrl: null } } as T;
    if (path.endsWith("/shared")) return { groups: [] } as T;
    if (path.endsWith("/groups")) return { groups: [{ id: "set", name: "Set", slug: "set", syncedSkillIds: f.items().map((item) => item.syncedSkillId), itemCount: f.items().length }] } as T;
    if (init?.method === "POST" && delay) await new Promise<void>((resolve) => { release = resolve; });
    return f.api<T>(path, init);
  };
  const session = createAccountSession({ api, identity: { name: "Test", email: "test@example.test" }, cacheKey: "membership", changed: () => {} });
  await session.refresh();
  const save = session.saveMembership({ kind: "change", id: "set", skills: [pair], add: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(session.saveSet({ kind: "delete", id: "set" }), /already in progress/);
  await assert.rejects(session.saveProfile({ handle: "test" }), /already in progress/);
  delay = false; release();
  await save;
  assert.equal(session.getSnapshot().data?.sets[0].itemCount, 1);
  assert.equal(session.getSnapshot().setSaving, false);
  session.dispose();
});

function accountFixture(write: PortalApi) {
  let failReads = false;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") return write<T>(path, init);
    if (failReads) throw new Error("Read unavailable");
    if (path.endsWith("/synced-skills")) return { skills: physical } as T;
    if (path.endsWith("/profile")) return { profile: { handle: null, profilePublished: false, publicUrl: null } } as T;
    if (path.endsWith("/shared")) return { groups: [] } as T;
    if (path.endsWith("/groups")) return { groups: [{ id: "set", name: "Set", slug: "set", syncedSkillIds: [], itemCount: 0 }] } as T;
    return { group: { id: "set", name: "Set", visibility: "private" }, accessRole: "owner", items: [] } as T;
  };
  let emissions = 0;
  const cache = new Map<string, string>();
  const session = createAccountSession({ api, identity: { name: "Test", email: "test@example.test" }, cacheKey: "account",
    storage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => { cache.set(key, value); }, removeItem: (key) => { cache.delete(key); } },
    changed: () => { emissions++; } });
  return { session, cache, emissions: () => emissions, failReads: () => { failReads = true; } };
}

test("account disposal stops the remaining batch and suppresses late cache/state updates", async () => {
  let release = () => {}; let writes = 0;
  const f = accountFixture(async <T>() => {
    writes++;
    await new Promise<void>((resolve) => { release = resolve; });
    return { itemId: "saved" } as T;
  });
  await f.session.refresh();
  const save = f.session.saveMembership({ kind: "change", id: "set", skills: [pair, second], add: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.session.dispose();
  const count = f.emissions();
  const rejected = assert.rejects(save, { name: "AbortError" });
  release(); await rejected;
  assert.equal(writes, 1); assert.equal(f.emissions(), count); assert.equal(f.cache.size, 0);
});

test("membership access denial clears account data and cache", async () => {
  const f = accountFixture(async () => { throw new PortalApiError("Access denied", 403); });
  await f.session.refresh();
  await assert.rejects(f.session.saveMembership({ kind: "change", id: "set", skills: [pair], add: true }), /access is unavailable/);
  assert.equal(f.session.getSnapshot().data, null);
  assert.equal(f.session.getSnapshot().accessDenied, true);
  assert.equal(f.cache.size, 0); f.session.dispose();
});

test("confirmed creation survives failed refresh without replaying the write", async () => {
  let writes = 0;
  const f = accountFixture(async <T>() => { writes++; f.failReads(); return { groupId: "created" } as T; });
  await f.session.refresh();
  const result = await f.session.saveMembership({ kind: "create-selected", name: "Test", skills: [pair] });
  assert.equal(result.groupId, "created"); assert.equal(result.added, 1);
  assert.match(f.session.getSnapshot().error, /Could not refresh/);
  await assert.rejects(f.session.saveMembership({ kind: "create-selected", name: "Test", skills: [pair] }), /Refresh your account/);
  assert.equal(writes, 1); f.session.dispose();
});

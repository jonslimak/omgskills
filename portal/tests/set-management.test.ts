import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAccountSession } from "../src/integration/account-session";
import { saveSetData, type SetCommand } from "../src/integration/set-data";
import { SetControls } from "../src/integration/SetControls";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { makeFixtures } from "../src/preview/fixtures";

const identity = { name: "Tester", email: "tester@example.test" };
const group = { id: "test-set", name: "Test", description: null, visibility: "private", itemCount: 0 };
function read(path: string) {
  if (path.endsWith("/groups")) return { groups: [group] };
  if (path.endsWith("/profile")) return { profile: { handle: null, profilePublished: false, publicUrl: null } };
  if (path.endsWith("/synced-skills")) return { skills: [] };
  return { groups: [] };
}
const sessionFor = (api: PortalApi) => createAccountSession({ api, identity, cacheKey: "c2-test", changed: () => {} });

test("set commands use existing endpoints, an empty private create, and abort signals", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { groupId: "test-set", name: "Test", description: null, visibility: "private", deleted: true, disabled: true } as T;
  };
  const signal = new AbortController().signal;
  const commands: SetCommand[] = [
    { kind: "create", name: "Test" },
    { kind: "update", id: "test-set", changes: { description: "Text" } },
    { kind: "moderate", id: "test-set", hidden: true },
    { kind: "delete", id: "test-set" },
  ];
  for (const command of commands) await saveSetData(api, command, signal);
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), { name: "Test", visibility: "private", syncedSkillIds: [] });
  assert.deepEqual(calls.map(({ init }) => init!.method), ["POST", "PATCH", "PATCH", "DELETE"]);
  assert.equal(calls[2].path, "/api/portal/groups/test-set/moderation");
  assert.ok(calls.every(({ init }) => init!.signal === signal && init!.redirect === "error"));
  await assert.rejects(saveSetData(async <T>() => ({ groupId: "wrong-id", deleted: true } as T), commands[3], signal));
});

test("set saves reject double submits and profile races, then refresh counts", async () => {
  let release = () => {};
  let writes = 0;
  const api: PortalApi = <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") { writes++; return new Promise<T>((resolve) => { release = () => resolve({ groupId: "test-set" } as T); }); }
    return Promise.resolve(read(path) as T);
  };
  const session = sessionFor(api);
  await session.refresh();
  const save = session.saveSet({ kind: "create", name: "Test" });
  await assert.rejects(session.saveSet({ kind: "create", name: "Test" }), /already in progress/);
  await assert.rejects(session.saveProfile({ handle: "test" }), /already in progress/);
  const focus = session.refresh(true);
  release();
  assert.deepEqual(await save, { groupId: "test-set", refreshed: true });
  await focus;
  assert.equal(writes, 1);
  assert.equal(session.getSnapshot().data?.sets.length, 1);
  assert.equal(session.getSnapshot().setSaving, false);
  session.dispose();
});

test("confirmed delete survives refresh failure without offering mutation retry", async () => {
  let written = false;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { written = true; return { groupId: "test-set", deleted: true } as T; }
    if (written) throw new Error("Offline");
    return read(path) as T;
  };
  const session = sessionFor(api);
  await session.refresh();
  assert.equal((await session.saveSet({ kind: "delete", id: "test-set" })).refreshed, false);
  assert.equal(session.getSnapshot().data?.sets.length, 0);
  assert.match(session.getSnapshot().error, /^Saved, but/);
  await assert.rejects(session.saveSet({ kind: "create", name: "Another" }), /Refresh/);
  session.dispose();
});

test("confirmed create followed by failed refresh returns its ID and never repeats the POST", async () => {
  let writes = 0;
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") { writes++; return { groupId: "created" } as T; }
    if (writes) throw new Error("Offline");
    return read(path) as T;
  };
  const session = sessionFor(api);
  await session.refresh();
  assert.deepEqual(await session.saveSet({ kind: "create", name: "Created" }), { groupId: "created", refreshed: false });
  await session.refresh();
  assert.equal(writes, 1);
  session.dispose();
});

test("old reads cannot overwrite a confirmed edit and moderation keeps visibility", async () => {
  let delay = false;
  let changed = false;
  const releases: (() => void)[] = [];
  const api: PortalApi = <T>(path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      changed = true;
      return Promise.resolve({ groupId: "test-set", disabled: true } as T);
    }
    if (delay && !changed) return new Promise<T>((resolve) => releases.push(() => resolve(read(path) as T)));
    return Promise.resolve((changed && path.endsWith("/groups") ? {
      groups: [{ ...group, disabledAt: "2026-09-24T00:00:00Z" }],
    } : read(path)) as T);
  };
  const session = sessionFor(api);
  await session.refresh();
  delay = true;
  const old = session.refresh();
  await session.saveSet({ kind: "moderate", id: "test-set", hidden: true });
  releases.forEach((release) => release());
  await old;
  assert.equal(session.getSnapshot().data?.sets[0].hidden, true);
  assert.equal(session.getSnapshot().data?.sets[0].visibility, "private");
  session.dispose();
});

test("validation retains data, uncertain writes require refresh, auth failures clear data", async () => {
  for (const status of [400, 401, 403, 404, 409, 500]) {
    const api: PortalApi = async <T>(path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") throw new PortalApiError("Rejected", status);
      return read(path) as T;
    };
    const session = sessionFor(api);
    await session.refresh();
    await assert.rejects(session.saveSet({ kind: "update", id: "test-set", changes: { name: "Changed" } }));
    assert.equal(session.getSnapshot().setSaving, false);
    if ([401, 403].includes(status)) assert.equal(session.getSnapshot().data, null);
    else assert.equal(session.getSnapshot().data?.sets[0].name, "Test");
    if (status === 500) assert.match(session.getSnapshot().error, /Could not confirm/);
    session.dispose();
  }
});

test("late set save after disposal cannot update data or start reconciliation", async () => {
  let release = () => {};
  let reads = 0;
  let signal: AbortSignal | null | undefined;
  const api: PortalApi = <T>(path: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Promise<T>((resolve) => {
      signal = init.signal; release = () => resolve({ groupId: "test-set" } as T);
    });
    reads++; return Promise.resolve(read(path) as T);
  };
  const session = sessionFor(api);
  await session.refresh();
  const save = session.saveSet({ kind: "create", name: "Test" });
  session.dispose();
  assert.equal(signal?.aborted, true);
  release();
  await assert.rejects(save, { name: "AbortError" });
  assert.equal(reads, 4);
});

test("shared and unloaded detail expose no set actions; Favorites cannot change visibility", () => {
  const set = makeFixtures().sets[0];
  const render = (value: typeof set | null) => renderToStaticMarkup(createElement(SetControls, {
    page: "detail", set: value, blocked: false, saving: false,
    save: async () => ({ groupId: "test", refreshed: true }), navigate: () => {}, notify: () => {},
  }));
  assert.equal(render(null), "");
  assert.equal(render({ ...set, role: "invited" }), "");
  assert.equal(render({ ...set, role: "public" }), "");
  assert.doesNotMatch(render({ ...set, role: "owner", isFavorites: true }), /Set visibility/);
  assert.match(render({ ...set, role: "owner", isFavorites: false }), /Set visibility/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { accountCacheKey, createAccountSession, type AccountSnapshot } from "../src/integration/account-session";
import { emptyAccount } from "../src/integration/data";

const identity = { name: "Local tester", email: "tester@example.test" };
const key = accountCacheKey("test-instance", "user-a", "session-a");
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
function response(path: string) {
  if (path.endsWith("synced-skills")) return { skills: [] };
  if (path.endsWith("profile")) return { profile: { handle: "tester", profilePublished: false, publicUrl: "http://localhost/u/tester" } };
  return { groups: [] };
}
const api: PortalApi = async <T>(path: string) => response(path) as T;
const noOp = () => {};

test("account cache keys isolate instance, user and session", () => {
  assert.notEqual(key, accountCacheKey("other-instance", "user-a", "session-a"));
  assert.notEqual(key, accountCacheKey("test-instance", "user-b", "session-a"));
  assert.notEqual(key, accountCacheKey("test-instance", "user-a", "session-b"));
});

test("refresh deduplicates concurrent requests and throttles focus bursts, not manual refresh", async () => {
  let calls = 0;
  let time = 10000;
  const releases: (() => void)[] = [];
  const delayed: PortalApi = <T>(path: string) => { calls++; return new Promise<T>((resolve) => releases.push(() => resolve(response(path) as T))); };
  const session = createAccountSession({ api: delayed, identity, cacheKey: key, changed: noOp, now: () => time });
  const first = session.refresh();
  assert.equal(session.refresh(), first);
  assert.equal(session.refresh(true), first);
  assert.equal(calls, 4);
  releases.splice(0).forEach((release) => release());
  await first;
  await session.refresh(true);
  assert.equal(calls, 4);
  const manual = session.refresh();
  assert.equal(calls, 8);
  releases.splice(0).forEach((release) => release());
  await manual;
  time += 5000;
  const focus = session.refresh(true);
  assert.equal(calls, 12);
  releases.splice(0).forEach((release) => release());
  await focus;
  session.dispose();
});

test("reload uses a valid same-session cache; failures preserve usable data", async () => {
  const storage = memoryStorage();
  const first = createAccountSession({ api, identity, cacheKey: key, storage, changed: noOp });
  await first.refresh();
  first.dispose(false);
  const next = createAccountSession({ api: async () => { throw new Error("offline"); }, identity, cacheKey: key, storage, changed: noOp });
  assert.equal(next.getSnapshot().data?.profile.handle, "tester");
  await next.refresh();
  assert.equal(next.getSnapshot().data?.profile.handle, "tester");
  assert.match(next.getSnapshot().error, /last loaded data/);
  assert.equal(next.getSnapshot().refreshing, false);
  next.dispose();
  assert.equal(storage.getItem(key), null);
});

test("401 and 403 clear private state/cache; retry can recover", async () => {
  for (const status of [401, 403]) {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ at: Date.now(), data: emptyAccount(identity) }));
    let denied = true;
    const transport: PortalApi = async <T>(path: string) => {
      if (denied) throw new PortalApiError("Denied", status);
      return response(path) as T;
    };
    const session = createAccountSession({ api: transport, identity, cacheKey: key, storage, changed: noOp });
    await session.refresh();
    assert.equal(session.getSnapshot().data, null);
    assert.equal(session.getSnapshot().accessDenied, true);
    assert.equal(storage.getItem(key), null);
    denied = false;
    await session.refresh();
    assert.equal(session.getSnapshot().accessDenied, false);
    assert.equal(session.getSnapshot().data?.profile.handle, "tester");
    session.dispose();
  }
});

test("account disposal aborts reads, removes cache and ignores late results", async () => {
  const storage = memoryStorage();
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const states: AccountSnapshot[] = [];
  const delayed: PortalApi = <T>(path: string, init?: RequestInit) => new Promise<T>((resolve) => {
    signals.push(init!.signal!);
    releases.push(() => resolve(response(path) as T));
  });
  const session = createAccountSession({ api: delayed, identity, cacheKey: key, storage, changed: (state) => states.push(state) });
  const request = session.refresh();
  session.dispose();
  const count = states.length;
  assert.ok(signals.every((signal) => signal.aborted));
  releases.forEach((release) => release());
  await request;
  assert.equal(states.length, count);
  assert.equal(storage.getItem(key), null);
});

test("expired, malformed and other-session cache never renders", () => {
  const storage = memoryStorage();
  for (const value of ["{", JSON.stringify({ at: 1, data: emptyAccount(identity) }), JSON.stringify({ at: Date.now(), data: { skills: [null] } })]) {
    storage.setItem(key, value);
    const session = createAccountSession({ api, identity, cacheKey: key, storage, changed: noOp });
    assert.equal(session.getSnapshot().data, null);
    assert.equal(storage.getItem(key), null);
    session.dispose();
  }
  storage.setItem(key, JSON.stringify({ at: Date.now(), data: emptyAccount(identity) }));
  const other = createAccountSession({ api, identity, cacheKey: "other-account", storage, changed: noOp });
  assert.equal(other.getSnapshot().data, null);
  other.dispose();
});

test("unavailable browser storage does not block live reads", async () => {
  const fail = () => { throw new Error("Storage disabled"); };
  const session = createAccountSession({ api, identity, cacheKey: key, storage: { getItem: fail, setItem: fail, removeItem: fail }, changed: noOp });
  await session.refresh();
  assert.equal(session.getSnapshot().data?.profile.handle, "tester");
  session.dispose();
});

test("profile edits preserve publication, use returned canonical values and reject concurrent saves", async () => {
  const bodies: unknown[] = [];
  let release = () => {};
  const transport: PortalApi = <T>(path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      bodies.push(JSON.parse(init.body as string));
      return new Promise<T>((resolve) => { release = () => resolve({ profile: {
        handle: "normalized", profilePublished: true, publicUrl: "http://localhost/u/normalized",
      } } as T); });
    }
    return Promise.resolve((path.endsWith("profile") ? { profile: {
      handle: "original", profilePublished: true, publicUrl: "http://localhost/u/original",
    } } : response(path)) as T);
  };
  const session = createAccountSession({ api: transport, identity, cacheKey: key, changed: noOp });
  await session.refresh();
  const save = session.saveProfile({ handle: "Normalized" });
  await assert.rejects(session.saveProfile({ published: false }), /already in progress/);
  assert.deepEqual(bodies, [{ handle: "Normalized", profilePublished: true }]);
  assert.equal(session.getSnapshot().profileSaving, true);
  release();
  await save;
  assert.equal(session.getSnapshot().data?.profile.handle, "normalized");
  assert.equal(session.getSnapshot().data?.profile.publicUrl, "http://localhost/u/normalized");
  assert.equal(session.getSnapshot().profileSaving, false);
  session.dispose();
});

test("older refresh results cannot overwrite a profile save; focus does not race writes", async () => {
  let delay = false;
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const transport: PortalApi = <T>(path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return Promise.resolve({ profile: { handle: "new-handle", profilePublished: false, publicUrl: "http://localhost/u/new-handle" } } as T);
    if (delay) return new Promise<T>((resolve) => {
      signals.push(init!.signal!);
      releases.push(() => resolve(response(path) as T));
    });
    return Promise.resolve(response(path) as T);
  };
  const session = createAccountSession({ api: transport, identity, cacheKey: key, changed: noOp });
  await session.refresh();
  delay = true;
  const old = session.refresh();
  const save = session.saveProfile({ handle: "new-handle" });
  const focus = session.refresh(true);
  assert.equal(releases.length, 4);
  assert.ok(signals.every((signal) => signal.aborted));
  await save;
  await focus;
  releases.forEach((release) => release());
  await old;
  assert.equal(session.getSnapshot().data?.profile.handle, "new-handle");
  session.dispose();
});

test("validation failures keep saved values; authorization loss removes account data", async () => {
  for (const status of [400, 409, 401, 403, 500]) {
    const storage = memoryStorage();
    const transport: PortalApi = async <T>(path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") throw new PortalApiError(status === 409 ? "Handle is already taken" : "Handle is reserved", status);
      return response(path) as T;
    };
    const session = createAccountSession({ api: transport, identity, cacheKey: key, storage, changed: noOp });
    await session.refresh();
    await assert.rejects(session.saveProfile({ published: true }));
    assert.equal(session.getSnapshot().profileSaving, false);
    if ([401, 403].includes(status)) {
      assert.equal(session.getSnapshot().data, null);
      assert.equal(storage.getItem(key), null);
    } else {
      assert.equal(session.getSnapshot().data?.profile.published, false);
      assert.match(session.getSnapshot().profileError, status === 500 ? /Could not confirm/ : /Handle/);
    }
    session.dispose();
  }
});

test("save completion after account switch never updates state or cache", async () => {
  let release = () => {};
  const states: AccountSnapshot[] = [];
  const storage = memoryStorage();
  let signal: AbortSignal | null | undefined;
  const transport: PortalApi = <T>(path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return new Promise<T>((resolve) => {
      signal = init.signal;
      release = () => resolve({ profile: { handle: "late", profilePublished: true, publicUrl: null } } as T);
    });
    return Promise.resolve(response(path) as T);
  };
  const session = createAccountSession({ api: transport, identity, cacheKey: key, storage, changed: (state) => states.push(state) });
  await session.refresh();
  const save = session.saveProfile({ handle: "late" });
  session.dispose();
  const count = states.length;
  assert.equal(signal?.aborted, true);
  release();
  await assert.rejects(save, { name: "AbortError" });
  assert.equal(states.length, count);
  assert.equal(storage.getItem(key), null);
});

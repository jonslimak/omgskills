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

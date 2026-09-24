import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceSession, parseDevices, type Device } from "../src/integration/device-session";
import { createAccountSession } from "../src/integration/account-session";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { isIntegrationRequest, isIntegrationBody } from "../integration-config";

const device: Device = { id: "d1000000-0000-4000-8000-000000000001", deviceName: "Test Mac", status: "active",
  createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, revokedAt: null, expiresAt: "2027-01-01T00:00:00Z" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("device parsing preserves all server statuses and rejects malformed lists", () => {
  for (const status of ["active", "inactive", "expired", "revoked"]) assert.equal(parseDevices({ devices: [{ ...device, status }] })[0].status, status);
  for (const value of [null, {}, { devices: [device, device] }, ...[{ id: "wrong" }, { status: "online" }, { expiresAt: "bad" },
    { lastUsedAt: undefined }, { deviceName: "" }].map((change) => ({ devices: [{ ...device, ...change }] }))]) {
    assert.throws(() => parseDevices(value), /Invalid device response/);
  }
});
test("device guard enables only list and bodyless UUID revocation; exchange remains blocked", () => {
  const path = `/api/portal/devices/${device.id}`;
  assert.equal(isIntegrationRequest("/api/portal/devices"), true);
  assert.equal(isIntegrationBody(path, "DELETE", undefined), true);
  assert.equal(isIntegrationBody(path, "DELETE", {}), false);
  for (const [target, method] of [[path, "GET"], [path, "POST"], ["/api/portal/devices/bad", "DELETE"],
    ["/api/portal/device-exchange", "POST"], ["/api/portal/sync-upload", "POST"], ["/api/portal/device-revoke", "POST"]]) {
    assert.equal(isIntegrationRequest(target, method), false);
  }
});
test("refresh deduplicates, preserves stale devices on errors, and recovers", async () => {
  let release!: (value: unknown) => void;
  let calls = 0;
  const api: PortalApi = <T>() => { calls++; return new Promise((resolve) => { release = resolve as typeof release; }) as Promise<T>; };
  const session = createDeviceSession(api, () => {}, () => {});
  const first = session.refresh(); assert.equal(session.refresh(), first); assert.equal(calls, 1);
  release({ devices: [device] }); await first;
  const invalid = session.refresh(); release({ devices: [{}] }); await invalid;
  assert.equal(session.getSnapshot().devices?.[0].id, device.id); assert.match(session.getSnapshot().error, /last loaded/);
  const recovered = session.refresh(); release({ devices: [] }); await recovered;
  assert.deepEqual(session.getSnapshot().devices, []); assert.equal(session.getSnapshot().error, "");
  session.dispose();
});
test("confirmed revoke updates only its row and reports refresh failure without replay", async () => {
  let writes = 0;
  const api: PortalApi = async <T>(_path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { writes++; return { deviceId: device.id, revoked: true } as T; }
    if (writes) throw new Error("Offline");
    return { devices: [device, { ...device, id: "d1000000-0000-4000-8000-000000000002" }] } as T;
  };
  const session = createDeviceSession(api, () => {}, () => {});
  await session.refresh(); await session.revoke(device.id);
  assert.equal(session.getSnapshot().devices?.[0].status, "revoked");
  assert.equal(session.getSnapshot().devices?.[1].status, "active");
  assert.match(session.getSnapshot().error, /revoked, but/);
  await assert.rejects(session.revoke(device.id)); assert.equal(writes, 1); session.dispose();
});
test("unknown and mismatched revoke outcomes block writes until explicit refresh", async () => {
  for (const response of [null, { deviceId: "wrong", revoked: true }]) {
    let writes = 0;
    const api: PortalApi = async <T>(_path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") { writes++; if (!response) throw new Error("Lost"); return response as T; }
      return { devices: [device] } as T;
    };
    const session = createDeviceSession(api, () => {}, () => {});
    await session.refresh(); await session.revoke(device.id);
    assert.match(session.getSnapshot().error, /Could not confirm/);
    await assert.rejects(session.revoke(device.id)); assert.equal(writes, 1);
    await session.refresh(); assert.equal(session.getSnapshot().error, ""); session.dispose();
  }
});
test("revocation serializes requests and disposal aborts and ignores late completion", async () => {
  let release!: (value: unknown) => void;
  let signal: AbortSignal | null | undefined;
  let events = 0;
  const api: PortalApi = async <T>(_path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { signal = init.signal; return await new Promise((resolve) => { release = resolve as typeof release; }) as T; }
    return { devices: [device] } as T;
  };
  const session = createDeviceSession(api, () => { events++; }, () => {});
  await session.refresh(); const revoke = session.revoke(device.id);
  assert.equal(session.refresh(), revoke); await assert.rejects(session.revoke(device.id));
  session.dispose(); const before = events; assert.equal(signal?.aborted, true);
  release({ deviceId: device.id, revoked: true }); await revoke; assert.equal(events, before);
});
test("access denial clears devices and notifies the account for reads and writes", async () => {
  for (const status of [401, 403]) for (const writing of [false, true]) {
    let denied = 0;
    const api: PortalApi = async <T>(_path: string, init?: RequestInit) => {
      if (!writing || init?.method === "DELETE") throw new PortalApiError("Denied", status);
      return { devices: [device] } as T;
    };
    const session = createDeviceSession(api, () => {}, () => { denied++; });
    await session.refresh(); if (writing) await session.revoke(device.id);
    assert.equal(denied, 1); assert.equal(session.getSnapshot().devices, null); session.dispose();
  }
});
test("disposed device reads cannot populate a subsequent account", async () => {
  let release!: (value: unknown) => void;
  let events = 0;
  const api: PortalApi = <T>() => new Promise((resolve) => { release = resolve as typeof release; }) as Promise<T>;
  const session = createDeviceSession(api, () => { events++; }, () => {});
  const read = session.refresh(); session.dispose(); const before = events;
  release({ devices: [device] }); await read; assert.equal(events, before);
});
test("device access denial invalidates account cache and ignores earlier account reads", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let cleared = 0;
  const api: PortalApi = async <T>(path: string) => {
    await gate;
    return (path.endsWith("profile") ? { profile: { handle: null, profilePublished: false, publicUrl: null } }
      : path.endsWith("synced-skills") ? { skills: [] } : { groups: [] }) as T;
  };
  const session = createAccountSession({ api, identity: { name: "Test", email: "test@example.test" }, cacheKey: "d1",
    changed: () => {}, storage: { getItem: () => null, setItem: () => {}, removeItem: () => { cleared++; } } });
  const refresh = session.refresh(); const before = cleared;
  session.invalidateAccess(); release(); await refresh; await tick();
  assert.equal(session.getSnapshot().data, null); assert.equal(session.getSnapshot().accessDenied, true);
  assert.equal(cleared, before + 1); session.dispose();
});

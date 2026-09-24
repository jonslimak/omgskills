import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionSession } from "../src/integration/connection-session";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import { isIntegrationBody, isIntegrationRequest } from "../integration-config";

const secret = "a".repeat(43);
const time = Date.parse("2026-09-24T12:00:00Z");
const response = { pairingCode: `pair_${secret}`, token: secret, expiresAt: new Date(time + 600000).toISOString() };
test("generation guard permits only empty POST bodies and blocks exchange, scopes and callbacks", () => {
  for (const path of ["/api/portal/sync-pairing-code", "/api/portal/sync-token"]) {
    assert.equal(isIntegrationBody(path, "POST", {}), true);
    for (const body of [undefined, null, [], { scopes: ["content:read"] }, { state: "anything" }, { codeChallenge: secret }])
      assert.equal(isIntegrationBody(path, "POST", body), false);
    assert.equal(isIntegrationRequest(path, "GET"), false);
  }
  for (const path of ["/api/portal/device-exchange", "/api/portal/sync-upload", "/api/portal/private-sources"])
    assert.equal(isIntegrationRequest(path, "POST"), false);
});
test("generation is explicit, preserves endpoint contracts and does not regenerate a valid secret", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api: PortalApi = async <T>(path: string, init?: RequestInit) => { calls.push({ path, init }); return response as T; };
  const session = createConnectionSession(api, () => {}, () => {}, () => time);
  assert.equal(calls.length, 0);
  await session.generate(); await session.generate();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, "/api/portal/sync-pairing-code");
  assert.equal(calls[0].init?.body, "{}"); assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(calls[0].init?.redirect, "error");
  session.select("legacy"); assert.equal(session.getSnapshot().secret, "");
  await session.generate(); assert.equal(calls[1].path, "/api/portal/sync-token");
  assert.equal(session.getSnapshot().secret, secret); session.dispose();
});
test("duplicate clicks issue one request and switching modes rejects the late response", async () => {
  let release!: (value: unknown) => void; let calls = 0; let signal: AbortSignal | null | undefined;
  const api: PortalApi = <T>(_path: string, init?: RequestInit) => {
    calls++; signal = init?.signal; return new Promise((resolve) => { release = resolve as typeof release; }) as Promise<T>;
  };
  const session = createConnectionSession(api, () => {}, () => {}, () => time);
  const generating = session.generate(); await session.generate(); assert.equal(calls, 1);
  session.select("legacy"); assert.equal(signal?.aborted, true);
  release(response); await generating;
  assert.equal(session.getSnapshot().secret, ""); assert.equal(session.getSnapshot().mode, "legacy"); session.dispose();
});
test("close/account disposal clears secrets and ignores late generation", async () => {
  let release!: (value: unknown) => void; let changes = 0;
  const api: PortalApi = <T>() => new Promise((resolve) => { release = resolve as typeof release; }) as Promise<T>;
  const session = createConnectionSession(api, () => { changes++; }, () => {}, () => time);
  const generating = session.generate(); session.dispose(); const before = changes;
  release(response); await generating;
  assert.equal(session.getSnapshot().secret, ""); assert.equal(changes, before);
});
test("expiry uses server timestamp and rejects copy even after a suspended timer", async () => {
  let now = time; let copies = 0;
  const session = createConnectionSession(async <T>() => response as T, () => {}, () => {}, () => now);
  await session.generate(); now += 600000;
  await session.copy(async () => { copies++; });
  assert.equal(copies, 0); assert.equal(session.getSnapshot().secret, "");
  assert.match(session.getSnapshot().notice, /Expired/); session.dispose();
});
test("bad, expired and callback-only responses never expose a credential", async () => {
  for (const value of [null, {}, { ...response, pairingCode: "bad" }, { ...response, expiresAt: "bad" },
    { ...response, expiresAt: new Date(time).toISOString() }, { callbackUrl: "omgskills://sync" }]) {
    const session = createConnectionSession(async <T>() => value as T, () => {}, () => {}, () => time);
    await session.generate(); assert.equal(session.getSnapshot().secret, ""); assert.ok(session.getSnapshot().error); session.dispose();
  }
});
test("copy succeeds only after clipboard confirmation and failures keep the valid code", async () => {
  const session = createConnectionSession(async <T>() => response as T, () => {}, () => {}, () => time);
  await session.generate(); let copied = "";
  await session.copy(async (value) => { copied = value; });
  assert.equal(copied, response.pairingCode); assert.equal(session.getSnapshot().notice, "Copied.");
  await session.copy(async () => { throw new Error("clipboard rejected"); });
  assert.equal(session.getSnapshot().notice, ""); assert.match(session.getSnapshot().error, /Could not copy/);
  assert.equal(session.getSnapshot().secret, response.pairingCode); session.dispose();
});
test("late clipboard completion cannot report success after mode change, close or expiry", async () => {
  for (const end of ["mode", "close", "expiry"]) {
    let now = time; let release!: () => void;
    const session = createConnectionSession(async <T>() => response as T, () => {}, () => {}, () => now);
    await session.generate(); const copy = session.copy(() => new Promise<void>((resolve) => { release = resolve; }));
    if (end === "mode") session.select("legacy"); else if (end === "close") session.dispose(); else now += 600000;
    release(); await copy; assert.notEqual(session.getSnapshot().notice, "Copied.");
    assert.equal(session.getSnapshot().secret, ""); session.dispose();
  }
});
test("rate limits and uncertain errors do not auto retry or leak server messages", async () => {
  for (const error of [new PortalApiError("secret body", 429), new Error("secret body")]) {
    let calls = 0;
    const session = createConnectionSession(async () => { calls++; throw error; }, () => {}, () => {}, () => time);
    await session.generate(); assert.equal(calls, 1);
    assert.match(session.getSnapshot().error, error instanceof PortalApiError ? /Too many/ : /may have been issued/);
    assert.doesNotMatch(session.getSnapshot().error, /secret body/); session.dispose();
  }
});
test("authorization failures notify account and clear secret state", async () => {
  for (const status of [401,403]) {
    let denied = 0;
    const session = createConnectionSession(async () => { throw new PortalApiError("denied", status); }, () => {}, () => { denied++; }, () => time);
    await session.generate(); assert.equal(denied, 1); assert.equal(session.getSnapshot().secret, ""); session.dispose();
  }
});

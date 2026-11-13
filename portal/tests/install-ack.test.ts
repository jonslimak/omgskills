import assert from "node:assert/strict";
import test from "node:test";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import {
  checkInstallAck, INSTALL_ACK_POLL_FOR_MS, INSTALL_ACK_POLL_MS, installAckPath, openingStatus,
  pollInstallAck, type InstallAckCheck, type InstallAckRequest
} from "../src/app/unified/install-ack";

const flush = async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); };

/** Manual clock: tick() fires the pending timer after its delay. */
function fakeTimers(start = Date.parse("2026-11-12T12:00:00.000Z")) {
  let now = start;
  let pending: { run: () => void; at: number } | null = null;
  return {
    timers: {
      now: () => now,
      setTimeout(run: () => void, ms: number) { assert.equal(pending, null, "one request at a time"); pending = { run, at: now + ms }; return pending; },
      clearTimeout(handle: unknown) { if (handle === pending) pending = null; }
    },
    get pending() { return pending; },
    async tick() {
      const next = pending;
      assert.ok(next, "a poll is scheduled");
      now = next.at; pending = null; next.run();
      await flush();
    }
  };
}

// The server's clock, far from the browser's: the poller must only use this one.
const serverNow = "2026-11-12T09:00:00.000Z";

test("the pop-over says Approve once the Mac acks, and keeps today's words when it never does", () => {
  assert.equal(openingStatus(false, false), "Opening omgskills...");
  assert.equal(openingStatus(false, true), "Didn't open? Open omgskills from Applications, then try again.");
  // The "Didn't open?" timer doesn't override an ack.
  assert.equal(openingStatus(true, true), "Approve it in omgskills.");
  assert.equal(openingStatus(true, false), "Approve it in omgskills.");
});

test("asks the server's time first, then polls every 2s since that time less 2s, and stops at the ack", async () => {
  const clock = fakeTimers();
  const asked: InstallAckRequest[] = [];
  const answers = [true, false, false, true];
  let acked = 0;
  const check: InstallAckCheck = async (request) => { asked.push(request); return { acked: answers.shift() ?? true, now: serverNow }; };
  pollInstallAck({ check, catalogId: "owner/repo", agent: "codex", onAck: () => { acked += 1; }, timers: clock.timers });
  await flush();
  // The first call has no since, so an earlier click's ack (answered true here) can't count.
  assert.deepEqual(asked, [{ catalogId: "owner/repo", agent: "codex", since: undefined }]);
  assert.equal(acked, 0);
  await clock.tick(); await clock.tick();
  assert.equal(acked, 0);
  await clock.tick();
  assert.equal(acked, 1);
  assert.equal(clock.pending, null);
  assert.equal(asked.length, 4);
  for (const request of asked.slice(1)) assert.equal(request.since, "2026-11-12T08:59:58.000Z");
});

test("gives up after about 2 minutes, ignores passing failures, and stops for refusals or when the pop-over moves on", async () => {
  const clock = fakeTimers();
  let calls = 0;
  pollInstallAck({ check: async () => { calls += 1; if (calls % 2) throw new Error("offline"); return { acked: false, now: serverNow }; },
    catalogId: "a", agent: "claude", onAck: () => assert.fail("never acked"), timers: clock.timers });
  await flush();
  while (clock.pending) await clock.tick();
  assert.equal(calls, 1 + INSTALL_ACK_POLL_FOR_MS / INSTALL_ACK_POLL_MS);

  for (const status of [401, 404]) {
    const refused = fakeTimers();
    let tries = 0;
    pollInstallAck({ check: async () => { tries += 1; throw new PortalApiError("no", status); },
      catalogId: "a", agent: "claude", onAck: () => assert.fail("never acked"), timers: refused.timers });
    await flush();
    assert.equal(tries, 1);
    assert.equal(refused.pending, null);
  }
  const busy = fakeTimers();
  pollInstallAck({ check: async () => { throw new PortalApiError("slow down", 429); },
    catalogId: "a", agent: "claude", onAck: () => assert.fail("never acked"), timers: busy.timers });
  await flush();
  assert.ok(busy.pending, "429 tries again");

  const moved = fakeTimers();
  let signal: AbortSignal | null = null;
  let finish: (value: { acked: boolean; now: string }) => void = () => {};
  const stop = pollInstallAck({ check: (_request, given) => { signal = given; return new Promise(resolve => { finish = resolve; }); },
    catalogId: "a", agent: "claude", onAck: () => assert.fail("stopped before the answer"), timers: moved.timers });
  stop();
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  finish({ acked: true, now: serverNow });
  await flush();
  assert.equal(moved.pending, null);
});

test("asks the signed-in API with an encoded query and needs the server's time", async () => {
  const request = { catalogId: "owner/repo with space", agent: "claude" as const, since: "2026-11-12T12:00:00.000Z" };
  assert.equal(installAckPath(request),
    "/api/portal/install-ack?catalogId=owner%2Frepo+with+space&agent=claude&since=2026-11-12T12%3A00%3A00.000Z");
  assert.equal(installAckPath({ catalogId: "a", agent: "codex" }), "/api/portal/install-ack?catalogId=a&agent=codex");
  for (const [body, expected] of [[{ acked: true, now: serverNow }, true], [{ acked: "true", now: serverNow }, false],
    [{ now: serverNow }, false]] as const) {
    let seen: { path: string; init?: RequestInit } | null = null;
    const api = (async (path: string, init?: RequestInit) => { seen = { path, init }; return body; }) as PortalApi;
    const signal = new AbortController().signal;
    assert.deepEqual(await checkInstallAck(api)(request, signal), { acked: expected, now: serverNow });
    assert.equal(seen!.path, installAckPath(request));
    assert.equal(seen!.init?.signal, signal);
    assert.equal(seen!.init?.cache, "no-store");
  }
  for (const body of [{ acked: true }, { acked: true, now: "soon" }, null]) {
    await assert.rejects(checkInstallAck((async () => body) as PortalApi)(request, new AbortController().signal));
  }
});

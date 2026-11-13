import assert from "node:assert/strict";
import test from "node:test";
import { PortalApiError } from "../src/api-error";
import type { PortalApi } from "../src/portal-api";
import {
  checkInstallAck, INSTALL_ACK_CLOCK_SLACK_MS, INSTALL_ACK_POLL_FOR_MS, INSTALL_ACK_POLL_MS, installAckPath, openingStatus,
  pollInstallAck, type InstallAckCheck, type InstallAckRequest
} from "../src/app/unified/install-ack";

/** Manual clock: run() fires the pending timer after its delay. */
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
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    }
  };
}

test("the pop-over says Approve once the Mac acks, and keeps today's words when it never does", () => {
  assert.equal(openingStatus(false, false), "Opening omgskills...");
  assert.equal(openingStatus(false, true), "Didn't open? Open omgskills from Applications, then try again.");
  // The "Didn't open?" timer doesn't override an ack.
  assert.equal(openingStatus(true, true), "Approve it in omgskills.");
  assert.equal(openingStatus(true, false), "Approve it in omgskills.");
});

test("polls every 1.5s from a little before opening, and stops at the ack", async () => {
  const clock = fakeTimers();
  const asked: InstallAckRequest[] = [];
  let answers = [false, false, true];
  let acked = 0;
  const check: InstallAckCheck = async (request) => { asked.push(request); return answers.shift() ?? true; };
  pollInstallAck({ check, catalogId: "owner/repo", agent: "codex", onAck: () => { acked += 1; }, timers: clock.timers });
  assert.equal(asked.length, 0);
  await clock.tick(); await clock.tick();
  assert.equal(acked, 0);
  await clock.tick();
  assert.equal(acked, 1);
  assert.equal(clock.pending, null);
  assert.equal(asked.length, 3);
  assert.deepEqual(asked[0], { catalogId: "owner/repo", agent: "codex",
    since: new Date(Date.parse("2026-11-12T12:00:00.000Z") - INSTALL_ACK_CLOCK_SLACK_MS).toISOString() });
  answers = [];
});

test("gives up after about 2 minutes, ignores passing failures, and stops for refusals or when the pop-over moves on", async () => {
  const clock = fakeTimers();
  let calls = 0;
  pollInstallAck({ check: async () => { calls += 1; if (calls % 2) throw new Error("offline"); return false; },
    catalogId: "a", agent: "claude", onAck: () => assert.fail("never acked"), timers: clock.timers });
  while (clock.pending) await clock.tick();
  assert.equal(calls, INSTALL_ACK_POLL_FOR_MS / INSTALL_ACK_POLL_MS);

  for (const status of [401, 404]) {
    const refused = fakeTimers();
    let tries = 0;
    pollInstallAck({ check: async () => { tries += 1; throw new PortalApiError("no", status); },
      catalogId: "a", agent: "claude", onAck: () => assert.fail("never acked"), timers: refused.timers });
    await refused.tick();
    assert.equal(tries, 1);
    assert.equal(refused.pending, null);
  }
  const busy = fakeTimers();
  pollInstallAck({ check: async () => { throw new PortalApiError("slow down", 429); },
    catalogId: "a", agent: "claude", onAck: () => assert.fail("never acked"), timers: busy.timers });
  await busy.tick();
  assert.ok(busy.pending, "429 tries again");

  const moved = fakeTimers();
  let signal: AbortSignal | null = null;
  let finish: (value: boolean) => void = () => {};
  const stop = pollInstallAck({ check: (_request, given) => { signal = given; return new Promise(resolve => { finish = resolve; }); },
    catalogId: "a", agent: "claude", onAck: () => assert.fail("stopped before the answer"), timers: moved.timers });
  await moved.tick();
  stop();
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  finish(true);
  await Promise.resolve();
  assert.equal(moved.pending, null);

  const early = fakeTimers();
  pollInstallAck({ check: async () => assert.fail("stopped before asking"), catalogId: "a", agent: "claude",
    onAck: () => {}, timers: early.timers })();
  assert.equal(early.pending, null);
});

test("asks the signed-in API with an encoded query and reads only a true acked", async () => {
  const request = { catalogId: "owner/repo with space", agent: "claude" as const, since: "2026-11-12T12:00:00.000Z" };
  assert.equal(installAckPath(request),
    "/api/portal/install-ack?catalogId=owner%2Frepo+with+space&agent=claude&since=2026-11-12T12%3A00%3A00.000Z");
  for (const [body, expected] of [[{ acked: true }, true], [{ acked: "true" }, false], [{}, false], [null, false]] as const) {
    let seen: { path: string; init?: RequestInit } | null = null;
    const api = (async (path: string, init?: RequestInit) => { seen = { path, init }; return body; }) as PortalApi;
    const signal = new AbortController().signal;
    assert.equal(await checkInstallAck(api)(request, signal), expected);
    assert.equal(seen!.path, installAckPath(request));
    assert.equal(seen!.init?.signal, signal);
    assert.equal(seen!.init?.cache, "no-store");
  }
});

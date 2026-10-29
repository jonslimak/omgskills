import assert from "node:assert/strict";
import test from "node:test";
import { consumeVerificationBody, fetchForVerification } from "./verification-fetch.mjs";

const url = "https://draft.example/page/";
const options = { sleep: async () => {}, onRetry: () => {} };

test("retries transport failures with fresh timeouts and bounded backoff", async () => {
  const signals = [];
  const delays = [];
  const logs = [];
  const result = await fetchForVerification(url, {}, {
    ...options,
    sleep: async delay => delays.push(delay),
    onRetry: message => logs.push(message),
    fetchImpl: async (_, request) => {
      signals.push(request.signal);
      if (signals.length < 3) throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      });
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(new Set(signals).size, 3);
  assert.deepEqual(delays, [500, 1000]);
  assert.equal(logs.length, 2);
  for (const log of logs) {
    assert.ok(log.includes(url));
    assert.match(log, /ECONNRESET.*connection reset/);
  }
});

test("exhausted requests identify URL and nested aggregate network causes", async () => {
  let calls = 0;
  await assert.rejects(fetchForVerification(url, {}, {
    ...options,
    fetchImpl: async () => {
      calls++;
      throw new TypeError("fetch failed", { cause: new AggregateError([
        Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" }),
        Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" }),
      ], "connection attempts failed") });
    },
  }), error => {
    assert.ok(error.message.includes(url));
    assert.match(error.message, /3 attempts/);
    assert.match(error.message, /ETIMEDOUT.*connect timed out/);
    assert.match(error.message, /ENOTFOUND.*DNS lookup failed/);
    return true;
  });
  assert.equal(calls, 3);
});

test("retries 5xx and consumes discarded bodies before the next attempt", async () => {
  let calls = 0;
  const responses = [];
  const result = await fetchForVerification(url, {}, {
    ...options,
    fetchImpl: async () => {
      if (calls) assert.equal(responses.at(-1).bodyUsed, true);
      const response = new Response("response", { status: ++calls < 3 ? 502 : 200 });
      responses.push(response);
      return response;
    },
  });
  assert.equal(calls, 3);
  assert.equal(await result.text(), "response");
});

test("returns final 5xx for strict status validation, without an unbounded retry", async () => {
  let calls = 0;
  const result = await fetchForVerification(url, {}, {
    ...options, fetchImpl: async () => { calls++; return new Response(null, { status: 503 }); },
  });
  assert.equal(result.status, 503);
  assert.equal(calls, 3);
});

test("does not retry wrong 2xx/3xx/4xx or explicitly expected 503 responses", async () => {
  for (const status of [204, 302, 401, 403, 404, 503]) {
    let calls = 0;
    const result = await fetchForVerification(url, {}, {
      ...options, expectedStatus: 503,
      fetchImpl: async () => { calls++; return new Response(null, { status }); },
    });
    assert.equal(result.status, status);
    assert.equal(calls, 1);
  }
});

test("preserves request options and caller cancellation without retry", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(fetchForVerification(url, { signal: controller.signal }, {
    ...options,
    fetchImpl: async () => { calls++; throw new Error("must not fetch"); },
  }), /aborted/i);
  assert.equal(calls, 0);
  await fetchForVerification(url, { method: "POST", redirect: "manual", body: "{}", headers: { accept: "application/json" } }, {
    ...options,
    fetchImpl: async (_, request) => {
      assert.equal(request.method, "POST");
      assert.equal(request.redirect, "manual");
      assert.equal(request.body, "{}");
      assert.deepEqual(request.headers, { accept: "application/json" });
      return new Response(null, { status: 200 });
    },
  });
});

test("consumes bodies without cancellation and reports interrupted body reads", async () => {
  let consumed = false;
  await consumeVerificationBody({ body: {
    async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); consumed = true; },
    cancel: () => assert.fail("must consume, not cancel"),
  } }, url);
  assert.equal(consumed, true);
  await consumeVerificationBody({ body: null }, url);
  await assert.rejects(consumeVerificationBody({ body: {
    async *[Symbol.asyncIterator]() { throw Object.assign(new Error("body reset"), { code: "ECONNRESET" }); },
  } }, url), error => error.message.includes(url) && /ECONNRESET/.test(error.message));
});

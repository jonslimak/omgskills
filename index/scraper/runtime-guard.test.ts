import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRuntimeProgress,
  formatRuntimeDuration,
  isGitHubRateLimitError,
  isRequestTimeoutError,
  parseOptionalPositiveDurationMs,
  runtimeBudgetExpired,
  shouldRetryGitHubRateLimit,
} from "./runtime-guard.js";

test("optional durations parse positive values and reject invalid configuration", () => {
  assert.equal(parseOptionalPositiveDurationMs("TEST", undefined, 60_000), null);
  assert.equal(parseOptionalPositiveDurationMs("TEST", "", 60_000), null);
  assert.equal(parseOptionalPositiveDurationMs("TEST", "5", 60_000), 300_000);
  assert.throws(() => parseOptionalPositiveDurationMs("TEST", "0", 1), /positive number/);
  assert.throws(() => parseOptionalPositiveDurationMs("TEST", "invalid", 1), /positive number/);
});

test("runtime budget expires only at or after the configured deadline", () => {
  assert.equal(runtimeBudgetExpired(1_000, null, 10_000), false);
  assert.equal(runtimeBudgetExpired(1_000, 5_000, 5_999), false);
  assert.equal(runtimeBudgetExpired(1_000, 5_000, 6_000), true);
});

test("runtime progress reports throughput and remaining time", () => {
  assert.deepEqual(calculateRuntimeProgress(60, 120, 60_000), {
    ratePerMinute: 60,
    estimatedRemainingMs: 60_000,
  });
  assert.deepEqual(calculateRuntimeProgress(0, 120, 0), {
    ratePerMinute: 0,
    estimatedRemainingMs: null,
  });
  assert.equal(formatRuntimeDuration(60_000), "1m");
  assert.equal(formatRuntimeDuration(3_660_000), "1h 1m");
});

test("request timeout detection handles direct and nested transport errors", () => {
  assert.equal(isRequestTimeoutError({ name: "TimeoutError" }), true);
  assert.equal(isRequestTimeoutError({ name: "AbortError" }), true);
  assert.equal(isRequestTimeoutError({ code: "ETIMEDOUT" }), true);
  assert.equal(isRequestTimeoutError({ cause: { code: "ETIMEDOUT" } }), true);
  assert.equal(isRequestTimeoutError(new Error("other failure")), false);
});

test("GitHub rate-limit detection distinguishes throttling from ordinary forbidden errors", () => {
  assert.equal(isGitHubRateLimitError({ status: 429 }), true);
  assert.equal(isGitHubRateLimitError({ status: 403, message: "secondary rate limit" }), true);
  assert.equal(isGitHubRateLimitError({
    status: 403,
    message: "forbidden",
    response: { headers: { "x-ratelimit-remaining": "0" } },
  }), true);
  assert.equal(isGitHubRateLimitError({ status: 403, message: "resource forbidden" }), false);
  assert.equal(isGitHubRateLimitError({ status: 500, message: "server error" }), false);
});

test("GitHub rate-limit retries are bounded by delay and attempt count", () => {
  assert.equal(shouldRetryGitHubRateLimit(120, 0, 120, false), true);
  assert.equal(shouldRetryGitHubRateLimit(121, 0, 120, false), false);
  assert.equal(shouldRetryGitHubRateLimit(30, 2, 120, false), false);
  assert.equal(shouldRetryGitHubRateLimit(30, 0, 120, true), false);
});

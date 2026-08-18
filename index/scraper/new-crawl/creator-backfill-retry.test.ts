import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientCreatorBackfillGitHubError,
  withCreatorBackfillGitHubRetry,
} from "./creator-backfill-retry.js";

test("GitHub retry recognizes temporary HTTP and network failures", () => {
  assert.equal(isTransientCreatorBackfillGitHubError({ status: 429 }), true);
  assert.equal(isTransientCreatorBackfillGitHubError({ status: 503 }), true);
  assert.equal(isTransientCreatorBackfillGitHubError({ code: "ETIMEDOUT" }), true);
  assert.equal(isTransientCreatorBackfillGitHubError({ status: 404 }), false);
});

test("GitHub retry succeeds after a temporary failure", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const result = await withCreatorBackfillGitHubRetry({
    label: "test",
    operation: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("temporary"), { status: 503 });
      return "ok";
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [500, 1000]);
});

test("GitHub retry fails after the bounded attempt count", async () => {
  let attempts = 0;
  await assert.rejects(() => withCreatorBackfillGitHubRetry({
    label: "test",
    operation: async () => {
      attempts += 1;
      throw Object.assign(new Error("temporary"), { status: 503 });
    },
    sleep: async () => undefined,
  }), /temporary/);
  assert.equal(attempts, 3);
});

test("GitHub retry does not retry stable failures", async () => {
  let attempts = 0;
  await assert.rejects(() => withCreatorBackfillGitHubRetry({
    label: "test",
    operation: async () => {
      attempts += 1;
      throw Object.assign(new Error("missing"), { status: 404 });
    },
    sleep: async () => undefined,
  }), /missing/);
  assert.equal(attempts, 1);
});

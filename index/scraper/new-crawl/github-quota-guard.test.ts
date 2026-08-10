import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGitHubCoreQuotaAvailable,
  assertGitHubQuotaAvailable,
  getGitHubCoreQuota,
  shouldCheckGitHubQuota,
} from "./github-quota-guard.js";

function client(remaining: number, reset = 1782164564) {
  return {
    rest: {
      rateLimit: {
        get: async () => ({
          data: {
            resources: {
              core: {
                remaining,
                reset,
              },
            },
          },
        }),
      },
    },
  };
}

test("combined cadence checks GitHub quota", () => {
  assert.equal(shouldCheckGitHubQuota("combined"), true);
  assert.equal(shouldCheckGitHubQuota("fast"), false);
  assert.equal(shouldCheckGitHubQuota("periodic"), false);
  assert.equal(shouldCheckGitHubQuota("background"), false);
});

test("combined quota guard passes when enough quota remains", async () => {
  await assertGitHubQuotaAvailable("combined", client(2000), 2000);
});

test("combined quota guard fails clearly when quota is too low", async () => {
  await assert.rejects(
    () => assertGitHubQuotaAvailable("combined", client(1999), 2000),
    /GitHub core quota too low for combined crawl: remaining=1999, required=2000, reset=2026-06-22T21:42:44.000Z/,
  );
});

test("non-combined quota guard does not call GitHub", async () => {
  const failingClient = {
    rest: {
      rateLimit: {
        get: async () => {
          throw new Error("should not be called");
        },
      },
    },
  };

  await assertGitHubQuotaAvailable("fast", failingClient, 2000);
});

test("generic quota guard supports operator-specific thresholds", async () => {
  assert.deepEqual(await getGitHubCoreQuota(client(4000)), { remaining: 4000, reset: 1782164564 });
  await assertGitHubCoreQuotaAvailable(3500, "creator backfill planning", client(3500));
  await assert.rejects(
    () => assertGitHubCoreQuotaAvailable(3500, "creator backfill planning", client(3499)),
    /GitHub core quota too low for creator backfill planning: remaining=3499, required=3500/,
  );
});

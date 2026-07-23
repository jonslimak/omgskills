import assert from "node:assert/strict";
import test from "node:test";
import {
  deployProduction,
  ROLLBACK_ISSUE_TITLE,
} from "./deploy-netlify-production.mjs";

const env = {
  NETLIFY_AUTH_TOKEN: "netlify-secret",
  NETLIFY_SITE_ID: "site-123",
  GITHUB_TOKEN: "github-secret",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_RUN_ID: "42",
  GITHUB_SERVER_URL: "https://github.com",
  NETLIFY_VERIFY_ATTEMPTS: "3",
  NETLIFY_VERIFY_RETRY_DELAY_MS: "0",
};

function createHarness({
  head = "commit-1",
  originMain = "commit-1",
  verificationFailures = 0,
  rollbackVerificationFailures = 0,
  liveAfterFailure = "candidate-2",
  openIssue = null,
} = {}) {
  const calls = [];
  const receipts = [];
  let verifyCalls = 0;
  let rollbackStarted = false;
  const run = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push({ type: "command", key });
    if (key === "git rev-parse HEAD") return { stdout: `${head}\n`, stderr: "" };
    if (key === "git rev-parse origin/main") return { stdout: `${originMain}\n`, stderr: "" };
    if (key.includes("netlify-cli deploy")) {
      return { stdout: JSON.stringify({ deploy_id: "candidate-2" }), stderr: "" };
    }
    if (args.some((arg) => arg.includes("verify-production-deploy.mjs"))) {
      verifyCalls += 1;
      const limit = rollbackStarted ? rollbackVerificationFailures : verificationFailures;
      if (verifyCalls <= limit) throw new Error(`verification failure ${verifyCalls}`);
    }
    return { stdout: "", stderr: "" };
  };

  let siteLookups = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ type: "fetch", path: parsed.pathname, method: options.method || "GET" });
    if (parsed.hostname === "api.github.com") {
      if (options.method === "POST" || options.method === "PATCH") {
        const body = JSON.parse(options.body);
        assert.equal(body.title, ROLLBACK_ISSUE_TITLE);
        return Response.json({ number: 99, ...body });
      }
      return Response.json(openIssue ? [openIssue] : []);
    }
    if (parsed.pathname.endsWith("/restore")) {
      rollbackStarted = true;
      verifyCalls = 0;
      return Response.json({});
    }
    siteLookups += 1;
    const id = siteLookups === 1 ? "previous-1" : liveAfterFailure;
    return Response.json({ published_deploy: { id } });
  };

  return {
    calls,
    receipts,
    run,
    fetchImpl,
    writeReceipt: async (_path, receipt) => {
      const serialized = JSON.stringify(receipt);
      assert.doesNotMatch(serialized, /netlify-secret|github-secret/);
      receipts.push(structuredClone(receipt));
    },
  };
}

test("blocks a stale checkout before deploying", async () => {
  const harness = createHarness({ head: "old", originMain: "new" });
  await assert.rejects(
    deployProduction({ env, ...harness, sleep: async () => {} }),
    /HEAD == origin\/main/,
  );
  assert.equal(harness.receipts.at(-1).status, "blocked-by-stale-checkout");
  assert.equal(
    harness.calls.some((call) => call.key?.includes("netlify-cli deploy")),
    false,
  );
});

test("accepts the workflow's pushed commit and records a verified receipt", async () => {
  const harness = createHarness();
  const receipt = await deployProduction({ env, ...harness, sleep: async () => {} });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.previousDeployId, "previous-1");
  assert.equal(receipt.candidateDeployId, "candidate-2");
  assert.equal(receipt.sourceCommit, "commit-1");
  assert.equal(receipt.verificationAttempts, 1);
  assert.match(receipt.manualRestoreCommand, /restoreSiteDeploy/);
  assert.equal(
    harness.calls
      .filter((call) => call.key?.includes("verify-live-manifest.mjs"))
      .map((call) => call.key).length,
    3,
  );
});

test("retries transient verification failures", async () => {
  const harness = createHarness({ verificationFailures: 2 });
  const receipt = await deployProduction({ env, ...harness, sleep: async () => {} });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.verificationAttempts, 3);
});

test("restores the previous deploy once and opens the circuit-breaker issue", async () => {
  const harness = createHarness({ verificationFailures: 3 });
  await assert.rejects(
    deployProduction({ env, ...harness, sleep: async () => {} }),
    /restored deploy previous-1/,
  );
  const receipt = harness.receipts.at(-1);
  assert.equal(receipt.status, "rolled-back");
  assert.equal(
    harness.calls.filter((call) => call.path?.endsWith("/restore")).length,
    1,
  );
  assert.equal(
    harness.calls.some(
      (call) => call.type === "fetch" && call.method === "POST" && call.path.endsWith("/issues"),
    ),
    true,
  );
  assert.equal(
    harness.calls.some((call) => /database|migration|sql/i.test(call.key || call.path || "")),
    false,
  );
});

test("does not restore a candidate that is no longer live", async () => {
  const harness = createHarness({
    verificationFailures: 3,
    liveAfterFailure: "newer-candidate",
  });
  await assert.rejects(
    deployProduction({ env, ...harness, sleep: async () => {} }),
    /no restore attempted/,
  );
  assert.equal(harness.receipts.at(-1).status, "superseded");
  assert.equal(
    harness.calls.some((call) => call.path?.endsWith("/restore")),
    false,
  );
});

test("an open rollback issue blocks later deploys", async () => {
  const harness = createHarness({
    openIssue: { number: 7, title: ROLLBACK_ISSUE_TITLE },
  });
  await assert.rejects(
    deployProduction({ env, ...harness, sleep: async () => {} }),
    /blocked by open issue #7/,
  );
  assert.equal(harness.receipts.at(-1).status, "blocked-by-open-rollback-issue");
  assert.equal(
    harness.calls.some((call) => call.key?.includes("netlify-cli deploy")),
    false,
  );
});

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
  NETLIFY_PREVIEW_VERIFY_ATTEMPTS: "3",
  NETLIFY_PREVIEW_VERIFY_RETRY_DELAY_MS: "0",
  NETLIFY_PRODUCTION_STABILIZATION_DELAY_MS: "0",
};

function createHarness({
  head = "commit-1",
  originMain = "commit-1",
  previewVerificationFailures = 0,
  verificationFailures = 0,
  rollbackVerificationFailures = 0,
  liveAfterFailure = "candidate-2",
  openIssue = null,
} = {}) {
  const calls = [];
  const receipts = [];
  let previewVerifyCalls = 0;
  let productionVerifyCalls = 0;
  let rollbackStarted = false;
  const run = async (command, args, options = {}) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push({ type: "command", key, env: options.env });
    if (key === "git rev-parse HEAD") return { stdout: `${head}\n`, stderr: "" };
    if (key === "git rev-parse origin/main") return { stdout: `${originMain}\n`, stderr: "" };
    if (key.includes("netlify-cli deploy")) {
      if (args.includes("--prod")) {
        return { stdout: JSON.stringify({ deploy_id: "candidate-2" }), stderr: "" };
      }
      return {
        stdout: JSON.stringify({
          deploy_id: "preview-1",
          deploy_url: "https://preview-1--example.netlify.app",
        }),
        stderr: "",
      };
    }
    if (args.some((arg) => arg.includes("verify-production-deploy.mjs"))) {
      if (options.env.PRODUCTION_ORIGIN === "https://preview-1--example.netlify.app") {
        previewVerifyCalls += 1;
        if (previewVerifyCalls <= previewVerificationFailures) {
          throw new Error(`preview verification failure ${previewVerifyCalls}`);
        }
        return { stdout: "", stderr: "" };
      }
      productionVerifyCalls += 1;
      const limit = rollbackStarted ? rollbackVerificationFailures : verificationFailures;
      if (productionVerifyCalls <= limit) {
        throw new Error(`verification failure ${productionVerifyCalls}`);
      }
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
      productionVerifyCalls = 0;
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
    sleep: async (milliseconds) => {
      calls.push({ type: "sleep", milliseconds });
    },
  };
}

test("blocks a stale checkout before deploying", async () => {
  const harness = createHarness({ head: "old", originMain: "new" });
  await assert.rejects(
    deployProduction({ env, ...harness }),
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
  const receipt = await deployProduction({ env, ...harness });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.previousDeployId, "previous-1");
  assert.equal(receipt.previewDeployId, "preview-1");
  assert.equal(receipt.previewDeployUrl, "https://preview-1--example.netlify.app");
  assert.equal(receipt.candidateDeployId, "candidate-2");
  assert.equal(receipt.sourceCommit, "commit-1");
  assert.equal(receipt.previewVerificationAttempts, 1);
  assert.equal(receipt.verificationAttempts, 1);
  assert.match(receipt.manualRestoreCommand, /restoreSiteDeploy/);
  const deployCalls = harness.calls.filter((call) => call.key?.includes("netlify-cli deploy"));
  assert.equal(deployCalls.length, 2);
  assert.equal(deployCalls[0].key.includes("--prod"), false);
  assert.equal(deployCalls[0].key.includes("--no-build"), true);
  assert.equal(deployCalls[1].key.includes("--prod"), true);
  assert.equal(deployCalls[1].key.includes("--no-build"), false);
  const previewCheck = harness.calls.find(
    (call) => call.key?.includes("verify-production-deploy.mjs")
      && call.env.PRODUCTION_ORIGIN === "https://preview-1--example.netlify.app",
  );
  assert.equal(previewCheck.env.PUBLIC_ORIGIN, "https://omgskills.com");
  assert.equal(previewCheck.env.VERIFY_CANDIDATE_FEATURES, "0");
  assert.equal(
    harness.calls
      .filter((call) => call.key?.includes("verify-live-manifest.mjs"))
      .map((call) => call.key).length,
    6,
  );
});

test("draft verification failure stops before production changes", async () => {
  const harness = createHarness({ previewVerificationFailures: 3 });
  await assert.rejects(
    deployProduction({ env, ...harness }),
    /Draft verification failed; production was not changed/,
  );
  assert.equal(harness.receipts.at(-1).status, "preview-verification-failed");
  const deployCalls = harness.calls.filter((call) => call.key?.includes("netlify-cli deploy"));
  assert.equal(deployCalls.length, 1);
  assert.equal(deployCalls[0].key.includes("--prod"), false);
  assert.equal(
    harness.calls.some((call) => call.path?.endsWith("/restore")),
    false,
  );
});

test("waits for production alias stabilization before verification", async () => {
  const harness = createHarness();
  await deployProduction({
    env: { ...env, NETLIFY_PRODUCTION_STABILIZATION_DELAY_MS: "25000" },
    ...harness,
  });
  const productionDeployIndex = harness.calls.findIndex(
    (call) => call.key?.includes("netlify-cli deploy") && call.key.includes("--prod"),
  );
  const stabilizationIndex = harness.calls.findIndex(
    (call) => call.type === "sleep" && call.milliseconds === 25000,
  );
  const productionVerifyIndex = harness.calls.findIndex(
    (call) => call.key?.includes("verify-production-deploy.mjs")
      && call.env.PRODUCTION_ORIGIN === "https://omgskills.com"
      && call.env.VERIFY_CANDIDATE_FEATURES === "1",
  );
  assert.ok(productionDeployIndex < stabilizationIndex);
  assert.ok(stabilizationIndex < productionVerifyIndex);
});

test("retries transient verification failures", async () => {
  const harness = createHarness({ verificationFailures: 2 });
  const receipt = await deployProduction({ env, ...harness });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.verificationAttempts, 3);
});

test("restores the previous deploy once and opens the circuit-breaker issue", async () => {
  const harness = createHarness({ verificationFailures: 3 });
  await assert.rejects(
    deployProduction({ env, ...harness }),
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
  const productionChecks = harness.calls.filter(
    (call) => call.key?.includes("verify-production-deploy.mjs")
      && call.env.PRODUCTION_ORIGIN === "https://omgskills.com",
  );
  assert.equal(productionChecks.at(0).env.VERIFY_CANDIDATE_FEATURES, "1");
  assert.equal(productionChecks.at(-1).env.VERIFY_CANDIDATE_FEATURES, "0");
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
    deployProduction({ env, ...harness }),
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
    deployProduction({ env, ...harness }),
    /blocked by open issue #7/,
  );
  assert.equal(harness.receipts.at(-1).status, "blocked-by-open-rollback-issue");
  assert.equal(
    harness.calls.some((call) => call.key?.includes("netlify-cli deploy")),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  deployProduction,
  runCommand,
  ROLLBACK_ISSUE_TITLE,
} from "./deploy-netlify-production.mjs";

test("verification failures retain the last ten progress lines and network errors", async () => {
  const code = 'for(let i=0;i<15;i++) console.log("links " + i); console.error("ETIMEDOUT draft.example"); process.exitCode=1;';
  await assert.rejects(runCommand(process.execPath, ["-e", code], { includeFailureStdout: true }), error => {
    assert.match(error.message, /links 5\nlinks 6/);
    assert.match(error.message, /links 14\nETIMEDOUT draft\.example/);
    assert.doesNotMatch(error.message, /links 0\n/);
    return true;
  });
});

test("other command failures do not expose stdout when stderr is available", async () => {
  await assert.rejects(runCommand(process.execPath, ["-e", 'console.log("private-result"); console.error("command failed"); process.exitCode=1;']), error => {
    assert.match(error.message, /failed: command failed$/);
    assert.doesNotMatch(error.message.split("failed: ")[1], /private-result/);
    return true;
  });
});

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

const migrationNames = Array.from({ length: 13 }, (_, i) => `migration-${i}`);
const migrationEntries = migrationNames.map((name, version) => ({ name, version }));
const productionHistory = {
  applied: migrationEntries.slice(0, 9),
  pending: migrationEntries.slice(9),
  missingOnDisk: [],
  outOfOrder: [],
};
const previewHistory = {
  applied: migrationEntries,
  pending: [],
  missingOnDisk: [],
  outOfOrder: [],
};

function createHarness({
  head = "commit-1",
  originMain = "commit-1",
  previewVerificationFailures = 0,
  verificationFailures = 0,
  liveAfterFailure = "candidate-2",
  openIssue = null,
  helperAssetError = null,
  previewMigrationCount = 4,
  previewDatabaseBranchId = "preview-database-1",
  productionStatus = productionHistory,
  previewStatus = previewHistory,
} = {}) {
  const calls = [];
  const receipts = [];
  let previewVerifyCalls = 0;
  let productionVerifyCalls = 0;
  const run = async (command, args, options = {}) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push({ type: "command", key, env: options.env, includeFailureStdout: options.includeFailureStdout });
    if (key === "git rev-parse HEAD") return { stdout: `${head}\n`, stderr: "" };
    if (key === "git rev-parse origin/main") return { stdout: `${originMain}\n`, stderr: "" };
    if (key.includes("netlify-cli database status")) {
      const status = args[args.indexOf("--branch") + 1] === "production"
        ? productionStatus : previewStatus;
      return { stdout: JSON.stringify({ ...status, connectionString: "database-secret" }), stderr: "" };
    }
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
      if (productionVerifyCalls <= verificationFailures) {
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
        assert.match(body.body, /No previous deployment was restored. Fix forward/);
        assert.doesNotMatch(body.body, /restoreSiteDeploy|Manual restore/);
        return Response.json({ number: 99, ...body });
      }
      return Response.json(openIssue ? [openIssue] : []);
    }
    if (parsed.pathname.endsWith("/restore")) {
      assert.fail("Deployment verification must never restore an older whole-site deploy");
    }
    if (parsed.pathname === "/api/v1/deploys/preview-1") {
      return Response.json({
        site_id: "site-123",
        database_branch_id: previewDatabaseBranchId,
        database_migrations: {
          files: migrationNames.slice(13 - previewMigrationCount).map((name) => ({ name, applied: true })),
        },
      });
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
    stageMigrations: async () => migrationNames,
    verifyHelperAssets: async () => {
      calls.push({ type: "helper-assets" });
      if (helperAssetError) throw helperAssetError;
    },
    writeReceipt: async (_path, receipt) => {
      const serialized = JSON.stringify(receipt);
      assert.doesNotMatch(serialized, /netlify-secret|github-secret|database-secret/);
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
  assert.equal(receipt.manualRestoreCommand, undefined);
  const deployCalls = harness.calls.filter((call) => call.key?.includes("netlify-cli deploy"));
  assert.equal(deployCalls.length, 2);
  for (const call of harness.calls.filter(call => call.type === "command")) {
    assert.equal(call.includeFailureStdout === true, /scripts\/verify-/.test(call.key),
      "failed progress output must be enabled only for verification commands");
  }
  const helperCheckIndex = harness.calls.findIndex((call) => call.type === "helper-assets");
  assert.ok(helperCheckIndex >= 0);
  assert.ok(helperCheckIndex < harness.calls.indexOf(deployCalls[0]));
  assert.equal(deployCalls[0].key.includes("--prod"), false);
  assert.equal(deployCalls[0].key.includes("--build"), true);
  assert.equal(deployCalls[0].key.includes("--context=deploy-preview"), true);
  assert.equal(deployCalls[1].key.includes("--prod"), true);
  assert.equal(deployCalls[1].key.includes("--build"), true);
  assert.equal(deployCalls[1].key.includes("--context=production"), true);
  assert.equal(receipt.previewMigrationCount, 13);
  assert.deepEqual(receipt.pendingProductionMigrations, migrationNames.slice(9));
  assert.equal(receipt.previewDatabaseBranchId, "preview-database-1");
  const previewCheck = harness.calls.find(
    (call) => call.key?.includes("verify-production-deploy.mjs")
      && call.env.PRODUCTION_ORIGIN === "https://preview-1--example.netlify.app",
  );
  assert.equal(previewCheck.env.PUBLIC_ORIGIN, "https://omgskills.com");
  assert.equal(previewCheck.env.VERIFY_CANDIDATE_FEATURES, "0");
  assert.equal(previewCheck.env.VERIFY_CATALOG_SEARCH, "1");
  const productionCheck = harness.calls.find(
    (call) => call.key?.includes("verify-production-deploy.mjs")
      && call.env.PRODUCTION_ORIGIN === "https://omgskills.com",
  );
  assert.equal(productionCheck.env.VERIFY_CATALOG_SEARCH, "1");
  assert.equal(
    harness.calls
      .filter((call) => call.key?.includes("verify-live-manifest.mjs"))
      .map((call) => call.key).length,
    6,
  );
});

test("already-migrated previews and production need no newly applied migrations", async () => {
  const harness = createHarness({ previewMigrationCount: 0, productionStatus: previewHistory });
  const receipt = await deployProduction({ env, ...harness });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.previewMigrationCount, 13);
  assert.deepEqual(receipt.pendingProductionMigrations, []);
});

test("incomplete, mismatched or unsafe database history blocks production", async (t) => {
  for (const options of [
    { previewStatus: { ...previewHistory, applied: migrationEntries.slice(0, 12) } },
    { previewStatus: { ...previewHistory, applied: [...migrationEntries.slice(0, 12), { name: "wrong" }] } },
    { previewStatus: { ...previewHistory, applied: [...migrationEntries.slice(0, 12), migrationEntries[0]] } },
    { previewStatus: { ...productionHistory } },
    { previewStatus: { ...previewHistory, missingOnDisk: [migrationEntries[0]] } },
    { previewStatus: { ...previewHistory, outOfOrder: [migrationEntries[0]] } },
    { previewStatus: { ...previewHistory, applied: null } },
    { productionStatus: { ...productionHistory, pending: [] } },
    { previewDatabaseBranchId: null },
    { previewDatabaseBranchId: "production" },
  ]) {
    await t.test(JSON.stringify(options), async () => {
      const harness = createHarness(options);
      await assert.rejects(deployProduction({ env, ...harness }), /Draft verification failed/);
      assert.equal(harness.receipts.at(-1).status, "preview-verification-failed");
      assert.equal(harness.calls.some((call) => call.key?.includes("netlify-cli deploy") && call.key.includes("--prod")), false);
    });
  }
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
  assert.equal(harness.calls.find((call) => call.key?.includes("verify-production-deploy.mjs")).env.VERIFY_CATALOG_SEARCH, "1");
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

test("blocks invalid helper assets before publishing or touching Netlify", async () => {
  const harness = createHarness({ helperAssetError: new Error("Helper release checksum mismatch") });
  await assert.rejects(deployProduction({ env, ...harness }), /checksum mismatch/);
  assert.equal(harness.receipts.at(-1).status, "blocked-by-helper-assets");
  assert.equal(harness.receipts.at(-1).verificationError, "Helper release checksum mismatch");
  assert.equal(harness.calls.some((call) => call.key?.includes("netlify-cli deploy")), false);
  assert.equal(harness.calls.some((call) => call.path?.startsWith("/api/v1/")), false);
});

test("retries transient verification failures", async () => {
  const harness = createHarness({ verificationFailures: 2 });
  const receipt = await deployProduction({ env, ...harness });
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.verificationAttempts, 3);
});

test("stops without restoring the previous deploy and opens the circuit-breaker issue", async () => {
  const harness = createHarness({ verificationFailures: 3 });
  await assert.rejects(
    deployProduction({ env, ...harness }),
    /no rollback attempted. Fix forward/,
  );
  const receipt = harness.receipts.at(-1);
  assert.equal(receipt.status, "verification-failed");
  assert.equal(receipt.manualRestoreCommand, undefined);
  assert.equal(
    harness.calls.filter((call) => call.path?.endsWith("/restore")).length,
    0,
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
  assert.equal(productionChecks.length, 3);
  assert.equal(productionChecks.at(-1).env.VERIFY_CANDIDATE_FEATURES, "1");
  assert.deepEqual(
    harness.calls.filter((call) => /database|migration|sql/i.test(call.key || call.path || "")).map((call) => call.key),
    [
      "npx netlify-cli database status --branch production --json",
      "npx netlify-cli database status --branch preview-database-1 --json",
    ],
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

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  EditoolStaleRevisionError,
  editoolFileRevision,
  recoverEditoolPolicyTransaction,
  runEditoolPolicyTransaction,
} from "./editool-policy-transaction.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "editool-transaction-"));
  const stateDir = join(root, "state");
  const first = join(root, "first.json");
  const second = join(root, "second.json");
  writeFileSync(first, "first-original\n");
  writeFileSync(second, "second-original\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, stateDir, first, second };
}

test("transaction commits every staged file", (t) => {
  const { stateDir, first, second } = fixture(t);
  runEditoolPolicyTransaction({
    stateDir,
    mutations: [
      { path: first, content: "first-new\n", expectedRevision: editoolFileRevision(first) },
      { path: second, content: "second-new\n", expectedRevision: editoolFileRevision(second) },
    ],
  });
  assert.equal(readFileSync(first, "utf8"), "first-new\n");
  assert.equal(readFileSync(second, "utf8"), "second-new\n");
  assert.equal(recoverEditoolPolicyTransaction(stateDir), "none");
});

test("stale revision rejects the transaction before writing", (t) => {
  const { stateDir, first, second } = fixture(t);
  const expected = editoolFileRevision(first);
  writeFileSync(first, "external-change\n");
  assert.throws(() => runEditoolPolicyTransaction({
    stateDir,
    mutations: [
      { path: first, content: "first-new\n", expectedRevision: expected },
      { path: second, content: "second-new\n", expectedRevision: editoolFileRevision(second) },
    ],
  }), EditoolStaleRevisionError);
  assert.equal(readFileSync(first, "utf8"), "external-change\n");
  assert.equal(readFileSync(second, "utf8"), "second-original\n");
});

test("write failure rolls every target back byte-for-byte", (t) => {
  const { stateDir, first, second } = fixture(t);
  assert.throws(() => runEditoolPolicyTransaction({
    stateDir,
    mutations: [
      { path: first, content: "first-new\n", expectedRevision: editoolFileRevision(first) },
      { path: second, content: "second-new\n", expectedRevision: editoolFileRevision(second) },
    ],
    failAfterAppliedFiles: 1,
  }), /injected Editool write failure/);
  assert.equal(readFileSync(first, "utf8"), "first-original\n");
  assert.equal(readFileSync(second, "utf8"), "second-original\n");
});

test("post-write verification failure rolls every target back byte-for-byte", (t) => {
  const { stateDir, first, second } = fixture(t);
  assert.throws(() => runEditoolPolicyTransaction({
    stateDir,
    mutations: [
      { path: first, content: "first-new\n", expectedRevision: editoolFileRevision(first) },
      { path: second, content: "second-new\n", expectedRevision: editoolFileRevision(second) },
    ],
    verifyAfterApply: () => {
      throw new Error("post-write verification failed");
    },
  }), /post-write verification failed/);
  assert.equal(readFileSync(first, "utf8"), "first-original\n");
  assert.equal(readFileSync(second, "utf8"), "second-original\n");
});

test("startup recovery rolls back an interrupted transaction", (t) => {
  const { stateDir, first, second } = fixture(t);
  assert.throws(() => runEditoolPolicyTransaction({
    stateDir,
    mutations: [
      { path: first, content: "first-new\n", expectedRevision: editoolFileRevision(first) },
      { path: second, content: "second-new\n", expectedRevision: editoolFileRevision(second) },
    ],
    simulateCrashAfterAppliedFiles: 1,
  }), /simulated process interruption/);
  assert.equal(readFileSync(first, "utf8"), "first-new\n");
  assert.equal(readFileSync(second, "utf8"), "second-original\n");
  assert.equal(recoverEditoolPolicyTransaction(stateDir), "rolled-back");
  assert.equal(readFileSync(first, "utf8"), "first-original\n");
  assert.equal(readFileSync(second, "utf8"), "second-original\n");
});

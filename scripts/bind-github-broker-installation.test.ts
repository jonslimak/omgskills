import assert from "node:assert/strict";
import test from "node:test";
import { parseBindingOptions } from "./bind-github-broker-installation.js";

test("binding command is dry-run by default and requires explicit owner identity", () => {
  assert.deepEqual(parseBindingOptions([
    "--installation-id", "456",
    "--expected-account", "owner",
    "--owner-email", "Owner@Example.com"
  ]), {
    installationId: "456",
    expectedAccount: "owner",
    ownerId: undefined,
    ownerEmail: "owner@example.com",
    apply: false
  });
  assert.equal(parseBindingOptions([
    "--installation-id", "456",
    "--expected-account", "owner",
    "--owner-id", "owner-id",
    "--apply"
  ]).apply, true);
});

test("binding command rejects missing or conflicting owner selectors", () => {
  assert.throws(() => parseBindingOptions([
    "--installation-id", "456",
    "--expected-account", "owner"
  ]), /exactly one/);
  assert.throws(() => parseBindingOptions([
    "--installation-id", "456",
    "--expected-account", "owner",
    "--owner-id", "owner-id",
    "--owner-email", "owner@example.com"
  ]), /exactly one/);
});

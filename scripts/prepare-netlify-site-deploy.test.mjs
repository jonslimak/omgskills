import assert from "node:assert/strict";
import test from "node:test";
import { runPreparationSequence } from "./prepare-netlify-site-deploy.mjs";

test("restores release assets before building and verifying web pages", async () => {
  const calls = [];
  const step = (name) => async () => {
    calls.push(name);
  };

  await runPreparationSequence({
    verifyPolicy: step("verify-policy"),
    verifyCollectionImages: step("verify-collection-images"),
    verifyCreatorHandleReservations: step("verify-creator-handles"),
    restoreRequiredAssets: step("restore-assets"),
    runWebLibraryBuild: step("build-web-library"),
    verifyWebLibraryBuild: step("verify-web-library"),
    verifyWebLibraryDeployArtifacts: step("verify-web-artifacts"),
    verifyReleaseDeployArtifacts: step("verify-release-artifacts"),
  });

  assert.deepEqual(calls, [
    "verify-policy",
    "verify-collection-images",
    "verify-creator-handles",
    "restore-assets",
    "build-web-library",
    "verify-web-library",
    "verify-web-artifacts",
    "verify-release-artifacts",
  ]);
});
